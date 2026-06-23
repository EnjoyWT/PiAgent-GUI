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

  async compactPreflight(threadId: string, modelKey: string, estimate: ContextPressureEstimate) {
    this.ensureThreadState(threadId)
    const config = this.configService.getConfig()
    if (config.mode !== 'auto') {
      return {
        attempted: false,
        compacted: false,
        result: null
      }
    }

    const engine = this.resolveEngine()
    if (!engine.shouldCompact({ estimate })) {
      return {
        attempted: false,
        compacted: false,
        result: null
      }
    }

    const result = await engine.compact({
      threadId,
      modelKey,
      reason: 'preflight'
    })
    return {
      attempted: true,
      compacted: result.changed,
      result
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
