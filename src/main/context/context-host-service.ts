import type { MessageRow } from '../../preload/db-types.ts'
import type { AgentRunProjection } from '@shared/agent-runtime'
import type { PendingQuestion, QuestionToolResult } from '@shared/question-tool'
import type { PendingQuestionnaire, QuestionnaireAnswerPayload } from '@shared/questionnaire-tool'
import { ContextCaptureService } from './context-capture-service.ts'
import { ContextConfigService } from './context-config-service.ts'
import { ContextModelClient } from './context-model-client.ts'
import { ContextMaterializer } from './context-materializer.ts'
import { ContextStore } from './context-store.ts'
import type { ContextModelSeed, ModelSeedSnapshot } from './context-types.ts'
import { SummaryPromptBuilder } from './summary-prompt-builder.ts'
import type { ContextEngine } from './engines/context-engine.ts'
import { NoopContextEngine } from './engines/noop-engine.ts'
import { SummaryCompressorEngine } from './engines/summary-compressor-engine.ts'
import type { ContextPressureEstimate } from './context-types.ts'

export class ContextHostService {
  private readonly store: ContextStore
  private readonly configService: ContextConfigService
  private readonly materializer: ContextMaterializer
  private readonly captureService: ContextCaptureService
  private readonly promptBuilder: SummaryPromptBuilder
  private readonly modelClient: ContextModelClient

  constructor(
    store: ContextStore,
    configService: ContextConfigService,
    materializer: ContextMaterializer,
    captureService: ContextCaptureService,
    promptBuilder = new SummaryPromptBuilder(),
    modelClient = new ContextModelClient()
  ) {
    this.store = store
    this.configService = configService
    this.materializer = materializer
    this.captureService = captureService
    this.promptBuilder = promptBuilder
    this.modelClient = modelClient
  }

  getConfig() {
    return this.configService.getConfig()
  }

  recordContextUsage(threadId: string, usage: unknown): void {
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return
    const record = usage as Record<string, unknown>
    const tokens = typeof record.tokens === 'number' && Number.isFinite(record.tokens) ? record.tokens : 0
    const contextWindow =
      typeof record.contextWindow === 'number' && Number.isFinite(record.contextWindow)
        ? record.contextWindow
        : 0
    if (tokens <= 0 || contextWindow <= 0) return
    this.ensureThreadState(threadId)
    this.store.saveContextUsage(threadId, { tokens, contextWindow })
  }

  ensureThreadState(threadId: string): void {
    const config = this.configService.getConfig()
    const engineName = config.engine || 'noop'
    const head = this.store.getThreadHead(threadId)
    if (!head) {
      this.store.ensureThreadHead(threadId, engineName)
      return
    }
    if (head.engineName !== engineName) {
      this.store.upsertThreadHead({
        threadId,
        engineName,
        activeSummaryEntryId: head.activeSummaryEntryId,
        compactedUntilSeq: head.compactedUntilSeq,
        revision: head.revision
      })
    }
  }

  async buildSeedMessages(threadId: string, model: ContextModelSeed): Promise<ModelSeedSnapshot> {
    this.ensureThreadState(threadId)
    return await this.materializer.materialize(threadId, model)
  }

  pruneThreadAfter(threadId: string, cutoffCreatedAt: string): number {
    this.ensureThreadState(threadId)
    return this.store.pruneThreadAfter(threadId, cutoffCreatedAt)
  }

  deleteThread(threadId: string): boolean {
    return this.store.deleteThread(threadId)
  }

  async compactManual(threadId: string, modelKey: string) {
    this.ensureThreadState(threadId)
    const engine = this.resolveEngine()
    return await engine.compact({
      threadId,
      modelKey,
      reason: 'manual'
    })
  }

  async compactPreflight(
    threadId: string,
    modelKey: string,
    estimate: ContextPressureEstimate,
    options?: {
      /** Fired only after the threshold check passes, before summary generation. */
      onBeforeCompact?: (effectiveEstimate: ContextPressureEstimate) => void
    }
  ) {
    this.ensureThreadState(threadId)
    const config = this.configService.getConfig()
    if (config.mode !== 'auto') {
      return {
        attempted: false,
        compacted: false,
        result: null,
        estimate
      }
    }

    const head = this.store.getThreadHead(threadId) ?? this.store.ensureThreadHead(threadId, config.engine || 'noop')
    const persistedTokens = head.contextUsageTokens
    const persistedWindow = head?.contextUsageWindow
    const persistedIsCurrent =
      persistedTokens != null &&
      persistedWindow != null &&
      head.contextUsageRevision === head.revision
    const effectiveEstimate =
      persistedIsCurrent && estimate.estimateMode === 'heuristic_only'
        ? {
            ...estimate,
            contextWindow: persistedWindow,
            estimatedPromptTokens: Math.max(estimate.estimatedPromptTokens, persistedTokens),
            thresholdTokens: Math.max(
              1,
              Math.min(
                Math.floor(persistedWindow * config.trigger.thresholdPercent),
                Math.max(1, persistedWindow - config.trigger.reserveOutputTokens)
              )
            ),
            estimateMode: 'usage_backed' as const,
            currentContextTokens: Math.max(estimate.estimatedPromptTokens, persistedTokens)
          }
        : estimate

    const engine = this.resolveEngine()
    if (!engine.shouldCompact({ estimate: effectiveEstimate })) {
      return {
        attempted: false,
        compacted: false,
        result: null,
        estimate: effectiveEstimate
      }
    }

    // Notify UI before the (potentially slow) summary model call.
    options?.onBeforeCompact?.(effectiveEstimate)

    const result = await engine.compact({
      threadId,
      modelKey,
      reason: 'preflight'
    })
    return {
      attempted: true,
      compacted: result.changed,
      result,
      estimate: effectiveEstimate
    }
  }

  async compactAfterRun(threadId: string, modelKey: string): Promise<void> {
    const config = this.configService.getConfig()
    if (config.mode !== 'auto') return

    const head = this.store.getThreadHead(threadId)
    if (!head) return

    const persistedTokens = head.contextUsageTokens
    const persistedWindow = head.contextUsageWindow
    if (persistedTokens == null || persistedWindow == null) return

    // Build a conservative estimate from the persisted usage data recorded
    // by recordContextUsage immediately before onRunFinalized.
    const estimate: ContextPressureEstimate = {
      contextWindow: persistedWindow,
      estimatedPromptTokens: Math.max(persistedTokens, 0),
      thresholdTokens: Math.max(
        1,
        Math.min(
          Math.floor(persistedWindow * config.trigger.thresholdPercent),
          Math.max(1, persistedWindow - config.trigger.reserveOutputTokens)
        )
      ),
      estimateMode: 'usage_backed',
      currentContextTokens: persistedTokens,
      warningLevel: 'normal'
    }

    const engine = this.resolveEngine()
    if (!engine.shouldCompact({ estimate })) return

    try {
      await engine.compact({ threadId, modelKey, reason: 'after_run' })
    } catch {
      // Post-run compaction is opportunistic; never crash run finalization.
    }
  }

  async onConsumedUserMessage(message: MessageRow): Promise<void> {
    this.ensureThreadState(message.thread_id)
    await this.captureService.captureConsumedUserMessage({ message })
  }

  async onRunFinalized(threadId: string, run: AgentRunProjection): Promise<void> {
    this.ensureThreadState(threadId)
    await this.captureService.captureFinalizedRun({ threadId, run })
  }

  async onQuestionPrompt(pending: PendingQuestion): Promise<void> {
    this.ensureThreadState(pending.threadId)
    await this.captureService.captureQuestionPrompt(pending)
  }

  async onQuestionAnswer(
    threadId: string,
    pending: PendingQuestion,
    result: QuestionToolResult
  ): Promise<void> {
    this.ensureThreadState(threadId)
    await this.captureService.captureQuestionAnswer({ threadId, pending, result })
  }

  async onQuestionnairePrompt(pending: PendingQuestionnaire): Promise<void> {
    this.ensureThreadState(pending.threadId)
    await this.captureService.captureQuestionnairePrompt(pending)
  }

  async onQuestionnaireAnswer(
    threadId: string,
    pending: PendingQuestionnaire,
    payload: QuestionnaireAnswerPayload
  ): Promise<void> {
    this.ensureThreadState(threadId)
    await this.captureService.captureQuestionnaireAnswer({ threadId, pending, payload })
  }

  private resolveEngine(): ContextEngine {
    const config = this.configService.getConfig()
    if (config.mode === 'off') return new NoopContextEngine()
    if (config.engine === 'summary-compressor') {
      return new SummaryCompressorEngine({
        store: this.store,
        config,
        promptBuilder: this.promptBuilder,
        modelClient: this.modelClient
      })
    }
    return new NoopContextEngine()
  }
}
