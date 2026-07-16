import type {
  AgentSubmittedQueueItem,
  AgentThreadProjection,
  AgentThreadWindowAroundTarget,
  AgentThreadWindowCursor,
  AgentThreadWindowPage
} from '../../shared/agent-runtime.ts'
import type { ChatImageBlock } from '../../shared/chat-content.ts'
import type { ConversationEventRow, ThreadRow } from '../../preload/db-types.ts'
import type {
  ContextDebugStatePreview,
  ContextThreadDebugSnapshot
} from '../../shared/context-engine.ts'
import { ensureDefaultAgentProfile } from '../core-v2/default-agent-profile.ts'
import type {
  Conversation,
  ConversationBindingMatch,
  ConversationExecutionOverride,
  ConversationMessage,
  CoreCommandService,
  CoreQueryService,
  ExecutionPolicy,
  ReasoningLevel
} from '../core-v2/domain.ts'
import { mergeExecutionPolicy } from '../core-v2/domain.ts'
import { parseLocalThreadMessageMeta } from '../core-v2/local-thread-message-payload.ts'
import {
  getLocalConversationByThreadIdFromService,
  getLocalThreadRowFromService
} from '../core-v2/local-thread-query.ts'
import { getLocalThreadHostService } from '../core-v2/local-thread-host.ts'
import {
  buildLocalThreadProjectionFromCoreV2,
  buildLocalThreadWindowFromCoreV2,
  listLocalRuntimeEventsFromCoreV2
} from '../core-v2/local-thread-read-model.ts'
import { getCoreV2Service } from '../core-v2/sqlite-db.ts'
import {
  listProviderModels,
  getProviderByRuntimeProvider,
  updateProviderModelCapabilities
} from '../db/config-db.ts'
import { planSummaryCompaction } from '../context/engines/summary-compressor-engine.ts'
import { getRuntimeContextServices } from '../context/runtime-context-services.ts'
import { estimateContextDebugPressure } from '../context/context-pressure-estimator.ts'
import { ensureSkillsDir } from '../skills/skills-root-service.ts'
import { getDefaultSkillsDir } from '../paths.ts'
import { AgentInstanceManager } from './agent-instance-manager.ts'
import { CodingAgentRuntimeBridge } from './coding-agent-runtime-bridge.ts'
import { RunScheduler } from './run-scheduler.ts'
import {
  emitGatewayAgentDebugEvent,
  emitGatewayAgentEvent,
  emitGatewayQuestionEvent,
  emitGatewayQuestionnaireEvent,
  emitGatewaySecretEvent,
  emitGatewayThreadPlanEvent
} from './runtime-event-bus.ts'
import { resolveRuntimeThreadSourceKind } from './runtime-thread-source-kind.ts'

type ThinkingConfigResponse =
  | {
      success: true
      currentLevel: ReasoningLevel
      availableLevels: ReasoningLevel[]
      supportsThinking: boolean
    }
  | { success: false; error: string }

type ReloadRuntimeResult =
  | {
      success: true
      chatThreadId: string | null
      reloaded: boolean
      deferred: boolean
      reason?: 'no-target' | 'not-initialized'
    }
  | { success: false; chatThreadId: string | null; error: string }

const parseRuntimeModelKey = (
  value?: string | null
): { providerId: string; modelId: string } | null => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const separator = raw.indexOf('::')
  if (separator < 0) {
    return {
      providerId: 'google',
      modelId: raw
    }
  }
  const providerId = raw.slice(0, separator).trim()
  const modelId = raw.slice(separator + 2).trim()
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}

const createLegacyThreadExecutionOverride = (
  model?: string | null
): ConversationExecutionOverride | null => {
  const parsed = parseRuntimeModelKey(model)
  if (!parsed) return null
  return {
    model: {
      providerId: parsed.providerId,
      modelId: parsed.modelId
    }
  }
}

export const withThinkingLevelExecutionOverride = (
  override: ConversationExecutionOverride | null | undefined,
  reasoningLevel: ReasoningLevel
): ConversationExecutionOverride => ({
  ...(override ?? {}),
  model: {
    ...(override?.model ?? {}),
    reasoningLevel
  }
})

const safeJsonParse = (value: string | null | undefined): unknown => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const extractMessageImages = (
  message: ConversationMessage | null | undefined
): ChatImageBlock[] => {
  const content = parseLocalThreadMessageMeta(message).content
  return (content?.blocks ?? []).filter((block): block is ChatImageBlock => block.type === 'image')
}

const normalizeContextDetailText = (value: string | null | undefined): string =>
  String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()

const previewContextText = (value: string | null | undefined, maxLength = 120): string => {
  const normalized = normalizeContextDetailText(value).replace(/\s+/g, ' ')
  if (!normalized) return ''
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}...`
}

const parseContextStatePreview = (
  stateJson: string | null | undefined
): ContextDebugStatePreview | null => {
  const parsed = safeJsonParse(stateJson)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  return {
    previousSummaryPreview:
      previewContextText(
        typeof record.previousSummary === 'string' ? record.previousSummary : null,
        180
      ) || null,
    failureCount:
      typeof record.failureCount === 'number' && Number.isFinite(record.failureCount)
        ? Math.max(0, Math.trunc(record.failureCount))
        : 0,
    lastFailureAt:
      typeof record.lastFailureAt === 'string' && record.lastFailureAt.trim()
        ? record.lastFailureAt.trim()
        : null,
    cooldownUntil:
      typeof record.cooldownUntil === 'string' && record.cooldownUntil.trim()
        ? record.cooldownUntil.trim()
        : null
  }
}

const asContextUsage = (
  value: unknown
): { tokens: number | null; contextWindow: number; percent: number | null } | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.contextWindow !== 'number' || !Number.isFinite(record.contextWindow))
    return undefined
  return {
    tokens:
      typeof record.tokens === 'number' && Number.isFinite(record.tokens) ? record.tokens : null,
    contextWindow: Math.max(0, Math.trunc(record.contextWindow)),
    percent:
      typeof record.percent === 'number' && Number.isFinite(record.percent) ? record.percent : null
  }
}

const resolvePolicyContextWindow = (policy: ExecutionPolicy | null): number | null => {
  if (!policy) return null
  const provider = getProviderByRuntimeProvider(policy.model.providerId)
  if (!provider) return null
  const model = listProviderModels(provider.id).find(
    (item) => item.modelId === policy.model.modelId
  )
  const contextWindow = model?.contextWindowTokens
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null
  }
  return Math.trunc(contextWindow)
}

export class LocalRuntimeHostService {
  private readonly core: CoreCommandService & CoreQueryService
  private readonly runtimeBridge: CodingAgentRuntimeBridge
  private readonly instanceManager: AgentInstanceManager
  private readonly runScheduler: RunScheduler
  private activeThreadId: string | null = null

  constructor(core: CoreCommandService & CoreQueryService) {
    this.core = core
    const contextServices = getRuntimeContextServices()

    ensureSkillsDir(getDefaultSkillsDir())
    this.instanceManager = new AgentInstanceManager({ core })
    this.runScheduler = new RunScheduler({ instanceManager: this.instanceManager })
    this.runtimeBridge = new CodingAgentRuntimeBridge({
      core,
      contextHostService: contextServices.hostService,
      promptBudgetService: contextServices.promptBudgetService,
      emitAppEvent: emitGatewayAgentEvent,
      emitDebugEvent: emitGatewayAgentDebugEvent,
      emitQuestionEvent: emitGatewayQuestionEvent,
      emitQuestionnaireEvent: emitGatewayQuestionnaireEvent,
      emitSecretEvent: emitGatewaySecretEvent,
      emitPlanEvent: emitGatewayThreadPlanEvent
    })
  }

  getRunExecutor(): CodingAgentRuntimeBridge {
    return this.runtimeBridge
  }

  getRunScheduler(): RunScheduler {
    return this.runScheduler
  }

  setActiveThread(threadId?: string | null): { success: true } {
    this.activeThreadId = String(threadId ?? '').trim() || null
    return { success: true }
  }

  async prepareThread(threadId: string): Promise<{ success: true; chatThreadId: string }> {
    const { conversation, policy } = this.requireConversationContext(threadId)
    await this.runtimeBridge.prepareConversation({
      conversationId: conversation.id,
      executionPolicy: policy
    })
    return {
      success: true,
      chatThreadId: String(threadId ?? '').trim()
    }
  }

  async abortThread(threadId: string): Promise<{ success: true }> {
    const match = this.tryResolveConversation(threadId)
    if (!match) return { success: true }
    await this.runtimeBridge.abortConversation(match.conversation.id)
    this.runScheduler.stopConversation(match.conversation.id)
    return { success: true }
  }

  async disposeThread(threadId: string): Promise<{ success: true }> {
    const match = this.tryResolveConversation(threadId)
    if (!match) return { success: true }
    await this.runtimeBridge.stopConversation(match.conversation.id)
    if (this.activeThreadId === String(threadId ?? '').trim()) this.activeThreadId = null
    return { success: true }
  }

  async invalidateProvider(
    providerId: string
  ): Promise<{ success: true; affectedConversationIds: string[] }> {
    return await this.runtimeBridge.invalidateProvider(providerId)
  }

  async reload(threadId?: string | null): Promise<ReloadRuntimeResult> {
    const targetThreadId = String(threadId ?? '').trim() || this.activeThreadId
    if (!targetThreadId) {
      return {
        success: true,
        chatThreadId: null,
        reloaded: false,
        deferred: false,
        reason: 'no-target'
      }
    }

    const match = this.tryResolveConversation(targetThreadId)
    if (!match) {
      return {
        success: true,
        chatThreadId: targetThreadId,
        reloaded: false,
        deferred: false,
        reason: 'not-initialized'
      }
    }

    try {
      const result = await this.runtimeBridge.reloadConversation(match.conversation.id)
      return {
        success: true,
        chatThreadId: targetThreadId,
        reloaded: result.reloaded,
        deferred: result.deferred,
        reason: result.reason
      }
    } catch (error) {
      return {
        success: false,
        chatThreadId: targetThreadId,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async getThreadProjection(threadId: string): Promise<AgentThreadProjection> {
    const match = this.tryResolveConversation(threadId)
    const liveSnapshot = match ? this.runtimeBridge.getLiveSnapshot(match.conversation.id) : null
    return await buildLocalThreadProjectionFromCoreV2(threadId, liveSnapshot)
  }

  async getThreadWindow(
    threadId: string,
    options?: {
      limit?: number
      beforeCursor?: AgentThreadWindowCursor | null
      around?: AgentThreadWindowAroundTarget | null
    }
  ): Promise<AgentThreadWindowPage> {
    const match = this.tryResolveConversation(threadId)
    const liveSnapshot = match ? this.runtimeBridge.getLiveSnapshot(match.conversation.id) : null
    return await buildLocalThreadWindowFromCoreV2(threadId, liveSnapshot, {
      limit: options?.limit,
      beforeCursor: options?.beforeCursor ?? null,
      around: options?.around ?? null,
      includeLiveRunSnapshot: !options?.beforeCursor && !options?.around
    })
  }

  async listRuntimeEvents(
    threadId: string,
    agentRunId?: string | null
  ): Promise<ConversationEventRow[]> {
    return await listLocalRuntimeEventsFromCoreV2(threadId, agentRunId ?? null)
  }

  async recordRendererDebugEvent(threadId: string, event: ConversationEventRow): Promise<void> {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) return
    if (resolveRuntimeThreadSourceKind(this.core, normalizedThreadId) === 'im') return
    ;(await getLocalThreadHostService()).persistRuntimeEvents(normalizedThreadId, [event])
  }

  async getThinkingConfig(threadId: string): Promise<ThinkingConfigResponse> {
    const { conversation } = this.requireConversationContext(threadId)
    await this.prepareThread(threadId)
    const result = this.runtimeBridge.getThinkingConfig(conversation.id)
    if (result.success) {
      this.persistVerifiedThinkingCapabilities(
        conversation,
        result.availableLevels,
        result.supportsThinking
      )
    }
    return result
  }

  async setThinkingLevel(threadId: string, level: ReasoningLevel): Promise<ThinkingConfigResponse> {
    const { conversation } = this.requireConversationContext(threadId)
    await this.prepareThread(threadId)
    const result = this.runtimeBridge.setThinkingLevel(conversation.id, level)
    if (result.success) {
      this.core.updateConversation({
        conversationId: conversation.id,
        executionOverride: withThinkingLevelExecutionOverride(conversation.executionOverride, level)
      })
      this.persistVerifiedThinkingCapabilities(
        conversation,
        result.availableLevels,
        result.supportsThinking
      )
    }
    return result
  }

  async getUserMessagesForForking(
    threadId: string
  ): Promise<Array<{ entryId: string; text: string }>> {
    const { conversation } = this.requireConversationContext(threadId)
    await this.prepareThread(threadId)
    return await this.runtimeBridge.getUserMessagesForForking(conversation.id)
  }

  async navigateTree(
    threadId: string,
    targetId: string,
    options?: {
      summarize?: boolean
      customInstructions?: string
      replaceInstructions?: boolean
      label?: string
    }
  ): Promise<{ cancelled: boolean; editorText?: string; aborted?: boolean }> {
    const { conversation } = this.requireConversationContext(threadId)
    await this.prepareThread(threadId)
    return await this.runtimeBridge.navigateConversationTree(conversation.id, targetId, options)
  }

  async getQueuedMessages(threadId: string): Promise<AgentSubmittedQueueItem[]> {
    const match = this.tryResolveConversation(threadId)
    if (!match) return []

    const queuedRuns = this.runScheduler.listQueuedRuns(match.conversation.id)
    const conversationMessages = this.core
      .getConversationMessages(match.conversation.id)
      .filter((message) => message.role === 'user')

    return queuedRuns.map((run, index) => {
      const message =
        conversationMessages.find(
          (item) => item.externalMessageId === run.traceId || item.id === run.traceId
        ) ??
        conversationMessages[conversationMessages.length - 1] ??
        null
      return {
        id: run.id,
        threadId,
        delivery: index === 0 ? 'steer' : 'followUp',
        text: message?.text?.trim() || '',
        createdAt: Date.parse(run.startedAt) || Date.now(),
        submittedAt: Date.parse(run.startedAt) || Date.now(),
        images: extractMessageImages(message)
      }
    })
  }

  async compactContext(threadId: string): Promise<
    | {
        success: true
        changed: boolean
        revision: number
        summaryEntryId?: string | null
      }
    | { success: false; error: string }
  > {
    const { conversation } = this.requireConversationContext(threadId)
    const contextServices = getRuntimeContextServices()
    const runtime = this.runtimeBridge.getContextRuntimeState(conversation.id)
    const waitingForInput = this.runtimeBridge.getInteractionState(conversation.id)
    if (runtime.isStreaming) {
      return {
        success: false,
        error: 'Cannot compact context while the thread is streaming'
      }
    }
    if (waitingForInput.question || waitingForInput.questionnaire) {
      return {
        success: false,
        error: 'Cannot compact context while waiting for user input'
      }
    }

    try {
      this.emitDebugEvent(threadId, 'context.compaction.started', {
        engine: contextServices.hostService.getConfig().engine,
        mode: contextServices.hostService.getConfig().mode,
        hasManagedThread: runtime.initialized
      })
      const compactResult = await contextServices.hostService.compactManual(
        threadId,
        runtime.modelKey ?? ''
      )
      if (!compactResult.changed) {
        this.emitDebugEvent(threadId, 'context.compaction.skipped', {
          revision: compactResult.revision,
          hasManagedThread: runtime.initialized
        })
        return {
          success: true,
          changed: false,
          revision: compactResult.revision,
          summaryEntryId: compactResult.summaryEntryId ?? null
        }
      }

      if (runtime.initialized) {
        await this.runtimeBridge.stopConversation(conversation.id)
        await this.prepareThread(threadId)
      }

      emitGatewayAgentEvent(threadId, {
        id: crypto.randomUUID(),
        type: 'agent.thread.compacted',
        timestamp: Date.now(),
        threadId,
        agentRunId: null,
        agentTurnId: null,
        traceId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        causationId: null,
        parentEventId: null,
        sequence: Date.now()
      })

      this.emitDebugEvent(threadId, 'context.compaction.completed', {
        revision: compactResult.revision,
        summaryEntryId: compactResult.summaryEntryId ?? null,
        recreatedSession: runtime.initialized
      })
      return {
        success: true,
        changed: true,
        revision: compactResult.revision,
        summaryEntryId: compactResult.summaryEntryId ?? null
      }
    } catch (error) {
      this.emitDebugEvent(threadId, 'context.compaction.failed', {
        error: error instanceof Error ? error.message : String(error)
      })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  getContextConfig(): { path: string; config: ContextThreadDebugSnapshot['config'] } {
    const contextServices = getRuntimeContextServices()
    return {
      path: contextServices.configService.getPath(),
      config: contextServices.hostService.getConfig()
    }
  }

  setContextConfig(config: ContextThreadDebugSnapshot['config']): {
    path: string
    config: ContextThreadDebugSnapshot['config']
  } {
    const contextServices = getRuntimeContextServices()
    contextServices.configService.writeConfig(config)
    return {
      path: contextServices.configService.getPath(),
      config: contextServices.hostService.getConfig()
    }
  }

  getContextThreadDebug(threadId: string): ContextThreadDebugSnapshot {
    const normalizedThreadId = String(threadId ?? '').trim() || 'default'
    const contextServices = getRuntimeContextServices()
    contextServices.hostService.ensureThreadState(normalizedThreadId)

    const config = contextServices.hostService.getConfig()
    const head = contextServices.store.getThreadHead(normalizedThreadId)
    const match = this.tryResolveConversation(normalizedThreadId)
    const thread = match ? getLocalThreadRowFromService(this.core, normalizedThreadId) : null
    const policy = match
      ? mergeExecutionPolicy(
          ensureDefaultAgentProfile(this.core).defaultExecutionPolicy,
          match.conversation.executionOverride ??
            createLegacyThreadExecutionOverride(thread?.model),
          null
        )
      : null
    const runtime = match
      ? this.runtimeBridge.getContextRuntimeState(match.conversation.id)
      : {
          initialized: false,
          modelKey: null,
          contextWindow: null,
          isStreaming: false,
          currentMessages: [],
          systemPrompt: '',
          contextUsage: undefined
        }
    const waitingForInput = match
      ? this.runtimeBridge.getInteractionState(match.conversation.id)
      : {
          question: false,
          questionnaire: false
        }
    const allEntries = contextServices.store.listEntries(normalizedThreadId)
    const activeEntries = contextServices.store.listActiveEntries(normalizedThreadId)
    const fallbackContextWindow = resolvePolicyContextWindow(policy)
    const pressure = estimateContextDebugPressure({
      config,
      promptBudgetService: contextServices.promptBudgetService,
      runtime: {
        initialized: runtime.initialized,
        contextWindow: runtime.contextWindow,
        currentMessages: runtime.currentMessages,
        systemPrompt: runtime.systemPrompt,
        contextUsage: asContextUsage(runtime.contextUsage)
      },
      activeEntries,
      fallbackContextWindow,
      persistedContextUsage: head
        ? {
            tokens: head.contextUsageTokens ?? null,
            contextWindow: head.contextUsageWindow ?? 0,
            revision: head.contextUsageRevision ?? null,
            currentRevision: head.revision
          }
        : undefined
    })
    const engineName = head?.engineName ?? config.engine ?? 'noop'
    const engineState = parseContextStatePreview(
      contextServices.store.getEngineState(normalizedThreadId, engineName)?.stateJson ?? null
    )
    const manualCompaction = (() => {
      const modelKeys = [config.summaryModel, config.summaryFallbackModel, runtime.modelKey ?? '']
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)

      if (config.mode === 'off') {
        return {
          available: false,
          reasonCode: 'mode_off' as const,
          reasonText: '当前未启用上下文压缩。',
          activeEntryCount: activeEntries.length,
          nonSummaryActiveEntryCount: 0,
          protectedHeadCount: 0,
          protectedTailCount: 0,
          summarizableCount: 0,
          protectFirstEntries: config.limits.protectFirstEntries,
          protectLastEntries: config.limits.protectLastEntries,
          hasActiveSummary: false
        }
      }

      if (engineName !== 'summary-compressor') {
        return {
          available: false,
          reasonCode: 'unsupported_engine' as const,
          reasonText: `当前压缩引擎为 ${engineName}，不支持这类摘要压缩。`,
          activeEntryCount: activeEntries.length,
          nonSummaryActiveEntryCount: 0,
          protectedHeadCount: 0,
          protectedTailCount: 0,
          summarizableCount: 0,
          protectFirstEntries: config.limits.protectFirstEntries,
          protectLastEntries: config.limits.protectLastEntries,
          hasActiveSummary: false
        }
      }

      const plan = planSummaryCompaction({
        allEntries,
        activeEntries,
        activeSummaryEntryId: head?.activeSummaryEntryId ?? null,
        protectFirstEntries: config.limits.protectFirstEntries,
        protectLastEntries: config.limits.protectLastEntries
      })

      if (modelKeys.length === 0) {
        return {
          available: false,
          reasonCode: 'missing_summary_model' as const,
          reasonText: '当前没有可用的摘要模型，请先配置 summary model 或初始化 runtime session。',
          activeEntryCount: activeEntries.length,
          nonSummaryActiveEntryCount: plan.nonSummaryActiveEntries.length,
          protectedHeadCount: plan.protectedHeadEntries.length,
          protectedTailCount: plan.protectedTailEntries.length,
          summarizableCount: plan.summarizableEntries.length,
          protectFirstEntries: config.limits.protectFirstEntries,
          protectLastEntries: config.limits.protectLastEntries,
          hasActiveSummary: Boolean(plan.existingSummary)
        }
      }

      if (plan.nonSummaryActiveEntries.length === 0) {
        return {
          available: false,
          reasonCode: 'no_active_entries' as const,
          reasonText: '当前没有可参与压缩的上下文条目。',
          activeEntryCount: activeEntries.length,
          nonSummaryActiveEntryCount: 0,
          protectedHeadCount: plan.protectedHeadEntries.length,
          protectedTailCount: plan.protectedTailEntries.length,
          summarizableCount: 0,
          protectFirstEntries: config.limits.protectFirstEntries,
          protectLastEntries: config.limits.protectLastEntries,
          hasActiveSummary: Boolean(plan.existingSummary)
        }
      }

      if (plan.summarizableEntries.length === 0) {
        return {
          available: false,
          reasonCode: 'no_compactable_entries' as const,
          reasonText: `这次手动压缩会被跳过。当前有 ${plan.nonSummaryActiveEntries.length} 条活动上下文，但在头部保护 ${config.limits.protectFirstEntries} 条、尾部保护 ${config.limits.protectLastEntries} 条后，没有剩余可压缩内容。`,
          activeEntryCount: activeEntries.length,
          nonSummaryActiveEntryCount: plan.nonSummaryActiveEntries.length,
          protectedHeadCount: plan.protectedHeadEntries.length,
          protectedTailCount: plan.protectedTailEntries.length,
          summarizableCount: 0,
          protectFirstEntries: config.limits.protectFirstEntries,
          protectLastEntries: config.limits.protectLastEntries,
          hasActiveSummary: Boolean(plan.existingSummary)
        }
      }

      return {
        available: true,
        reasonCode: 'ready' as const,
        reasonText: `当前可以执行手动压缩，预计会压缩 ${plan.summarizableEntries.length} 条上下文。`,
        activeEntryCount: activeEntries.length,
        nonSummaryActiveEntryCount: plan.nonSummaryActiveEntries.length,
        protectedHeadCount: plan.protectedHeadEntries.length,
        protectedTailCount: plan.protectedTailEntries.length,
        summarizableCount: plan.summarizableEntries.length,
        protectFirstEntries: config.limits.protectFirstEntries,
        protectLastEntries: config.limits.protectLastEntries,
        hasActiveSummary: Boolean(plan.existingSummary)
      }
    })()

    return {
      threadId: normalizedThreadId,
      configPath: contextServices.configService.getPath(),
      config,
      managedThread: {
        initialized: runtime.initialized,
        modelKey: runtime.modelKey,
        contextWindow: runtime.contextWindow ?? fallbackContextWindow,
        isStreaming: runtime.isStreaming
      },
      waitingForInput: {
        question: waitingForInput.question,
        questionnaire: waitingForInput.questionnaire
      },
      head: head
        ? {
            engineName: head.engineName,
            activeSummaryEntryId: head.activeSummaryEntryId ?? null,
            compactedUntilSeq: head.compactedUntilSeq ?? null,
            revision: head.revision,
            updatedAt: head.updatedAt
          }
        : null,
      pressure,
      entries: {
        total: allEntries.length,
        active: activeEntries.length,
        summaries: allEntries.filter((entry) => entry.semanticKind === 'thread_summary').length
      },
      engineState,
      manualCompaction,
      recentCompactions: contextServices.store
        .listCompactions(normalizedThreadId, 6)
        .map((row) => ({
          id: row.id,
          engineName: row.engineName,
          reason: row.reason,
          compactedUntilSeq: row.compactedUntilSeq,
          protectedTailStartSeq: row.protectedTailStartSeq ?? null,
          estimatedInputTokens: row.estimatedInputTokens ?? null,
          estimatedOutputTokens: row.estimatedOutputTokens ?? null,
          createdAt: row.createdAt
        })),
      activeEntriesPreview: activeEntries.slice(0, 12).map((entry) => {
        const fullText = normalizeContextDetailText(entry.contentText)
        return {
          id: entry.id,
          seq: entry.seq,
          role: entry.role,
          semanticKind: entry.semanticKind,
          compactPolicy: entry.compactPolicy,
          includeInModelContext: entry.includeInModelContext,
          includeInMemory: entry.includeInMemory,
          createdAt: entry.createdAt,
          preview: previewContextText(fullText, 140),
          fullText
        }
      })
    }
  }

  private tryResolveConversation(threadId: string): ConversationBindingMatch | null {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) return null
    return getLocalConversationByThreadIdFromService(this.core, normalizedThreadId)
  }

  private requireConversationContext(threadId: string): {
    thread: ThreadRow
    conversation: Conversation
    policy: ExecutionPolicy
  } {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) throw new Error('chatThreadId is required')
    const thread = getLocalThreadRowFromService(this.core, normalizedThreadId)
    if (!thread) throw new Error(`Unknown local thread: ${normalizedThreadId}`)
    const match = this.tryResolveConversation(normalizedThreadId)
    if (!match)
      throw new Error(`Local conversation is not initialized for thread=${normalizedThreadId}`)

    const profile = ensureDefaultAgentProfile(this.core)
    const policy = mergeExecutionPolicy(
      profile.defaultExecutionPolicy,
      match.conversation.executionOverride ?? createLegacyThreadExecutionOverride(thread.model),
      null
    )

    return {
      thread,
      conversation: match.conversation,
      policy
    }
  }

  private persistVerifiedThinkingCapabilities(
    conversation: Conversation,
    availableLevels: ReasoningLevel[],
    supportsThinking: boolean
  ): void {
    if (!supportsThinking || availableLevels.length === 0) return
    const providerId =
      conversation.executionOverride?.model?.providerId ??
      ensureDefaultAgentProfile(this.core).defaultExecutionPolicy.model.providerId
    const modelId =
      conversation.executionOverride?.model?.modelId ??
      ensureDefaultAgentProfile(this.core).defaultExecutionPolicy.model.modelId
    const provider = getProviderByRuntimeProvider(providerId)
    if (!provider) return
    const targetModel = listProviderModels(provider.id).find((model) => model.modelId === modelId)
    if (!targetModel) return

    try {
      const capabilities = targetModel.capabilitiesJson
        ? JSON.parse(targetModel.capabilitiesJson)
        : {}
      const current = Array.isArray(capabilities.thinkingLevels) ? capabilities.thinkingLevels : []
      if (JSON.stringify(current) === JSON.stringify(availableLevels)) return
      capabilities.thinkingLevels = availableLevels
      updateProviderModelCapabilities(provider.id, modelId, JSON.stringify(capabilities))
    } catch (error) {
      console.error('Failed to update model capabilities in DB:', error)
    }
  }

  private emitDebugEvent(threadId: string, eventType: string, payload: unknown): void {
    emitGatewayAgentDebugEvent(threadId, {
      id: crypto.randomUUID(),
      thread_id: threadId,
      agent_run_id: null,
      event_type: eventType,
      event_origin: 'debug',
      correlation_id: crypto.randomUUID(),
      payload_json: JSON.stringify(payload ?? null),
      raw_json: null,
      created_at: Date.now()
    })
  }
}

let localRuntimeHostSingleton: LocalRuntimeHostService | null = null

export const getLocalRuntimeHostService = async (): Promise<LocalRuntimeHostService> => {
  if (localRuntimeHostSingleton) return localRuntimeHostSingleton
  localRuntimeHostSingleton = new LocalRuntimeHostService(getCoreV2Service())
  return localRuntimeHostSingleton
}
