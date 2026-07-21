import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
  createAgentSession
} from '@earendil-works/pi-coding-agent'
import { getModels, type Api, type KnownProvider } from '@earendil-works/pi-ai/compat'
import type {
  AgentAppEvent,
  AgentRunProjection,
  AgentTurnProjection
} from '../../shared/agent-runtime.ts'
import type { ConversationEventRow } from '../../preload/db-types.ts'
import type { ChatImageBlock, ChatMessageContent } from '../../shared/chat-content.ts'
import type { PendingQuestionEvent, QuestionAnswerPayload } from '../../shared/question-tool.ts'
import type {
  PendingQuestionnaireEvent,
  QuestionnaireAnswerPayload
} from '../../shared/questionnaire-tool.ts'
import type { PendingSecretPromptEvent, SecretAnswerPayload } from '../../shared/secret-input.ts'
import type { ThreadPlanEvent } from '../../shared/thread-plan.ts'
import {
  buildOpenAICompatSettings,
  normalizeProviderSettings,
  parseProviderSettings,
  shouldRegisterDynamicProvider
} from '../../shared/provider-settings.ts'
import { getDefaultProviderDefinition } from '../../shared/providers/registry.ts'
import { resolveProviderModelBaseUrl } from '../../shared/providers/adapters/builtin.ts'
import type {
  AgentRun,
  Conversation,
  ConversationMessage,
  ConversationSourceKind,
  CoreCommandService,
  CoreQueryService,
  ExecutionPolicy,
  ReasoningLevel
} from '../core-v2/domain.ts'
import { createExecutionSnapshot, deriveConversationSourceKind } from '../core-v2/domain.ts'
import { getLocalThreadHostService } from '../core-v2/local-thread-host.ts'
import { parseLocalThreadMessageMeta } from '../core-v2/local-thread-message-payload.ts'
import {
  isSystemFollowupSyntheticPromptText,
  SYSTEM_FOLLOWUP_RUNTIME_PROMPT
} from '../core-v2/system-followup-synthetic-prompt.ts'
import { createPiAgentShellCommandPrefix } from '../cli/cli-bin-path.ts'
import {
  getProviderApiKeyByRuntimeProvider,
  getProviderByRuntimeProvider,
  getSetting,
  listProviderModels
} from '../db/config-db.ts'
import type { ContextHostService } from '../context/context-host-service.ts'
import type { PromptBudgetService } from '../context/prompt-budget-service.ts'
import { DeliveryCoordinator } from '../delivery/delivery-coordinator.ts'
import { LOCAL_HTTP_BASE_URL } from '../http/local-http-config.ts'
import { KnowledgeStore } from '../knowledge/knowledge-store.ts'
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval-service.ts'
import { OnnxEmbeddingEngine } from '../knowledge/embedding/onnx-embedding-engine.ts'
import { getKnowledgeSettings } from '../knowledge/knowledge-settings.ts'
import {
  InjectionScheduler,
  InjectionRenderer,
  KnowledgeInjectionService
} from '../knowledge/knowledge-injection-service.ts'
import { getDefaultSkillsDir, getPreferredAppConfigDir } from '../paths.ts'
import {
  resolveAgentPluginResources,
  type ResolvedAgentPluginResources
} from '../agent-plugins/agent-plugin-resource-resolver.ts'
import { resolveSkillSearchPaths } from '../skills/skill-path-service.ts'
import { getScheduledTaskService } from '../scheduled-tasks/scheduled-task-service.ts'
import {
  applyAgentSessionCompat,
  resolveProviderContextWindowTokens,
  resolveProviderMaxTokens
} from '../runtime/agent-session-compat.ts'
import { RuntimeAdapter } from '../runtime/runtime-adapter.ts'
import { ContextThreadFactory } from '../context/context-thread-factory.ts'
import { ensureSkillsDir } from '../skills/skills-root-service.ts'
import {
  materializeContentBlocksForRuntime,
  materializeImageBlockForRuntime
} from './chat-image-runtime.ts'
import { withTemporaryPromptAppend } from './runtime-system-prompt.ts'
import { RuntimeSurfaceHost } from './runtime-surface/runtime-surface-host.ts'
import type { RuntimeSurfacePlugin } from './runtime-surface/runtime-surface-types.ts'
import { BaseRuntimeToolLayer } from './runtime-tool-layer/base-runtime-tool-layer.ts'
import {
  buildRuntimeToolCatalog,
  type RuntimeToolCatalogEntry
} from './runtime-tool-layer/runtime-tool-catalog.ts'
import {
  buildRuntimeToolRegistry,
  type RuntimeToolRegistryEntry,
  type RuntimeToolsetId
} from './runtime-tool-layer/runtime-tool-registry.ts'
import {
  resolveRuntimeTools,
  type RuntimeToolResolution
} from './runtime-tool-layer/runtime-tool-resolver.ts'
import { createDiscoverBuiltinToolsTool } from '../tools/discover-builtin-tools-tool.ts'
import { createPlanTools } from '../tools/plan-tool.ts'
import {
  RuntimeUserInteractionController,
  type RuntimeInteractionAnswerResult
} from './user-interaction-controller.ts'
import { resolveRuntimeThreadSourceKind } from './runtime-thread-source-kind.ts'
import type { WorkerRuntimeModelConfig } from '../subagents/subagent-types.ts'

type RuntimeSession = Awaited<ReturnType<typeof createAgentSession>>['session']
type RuntimeModelDefinition = NonNullable<ReturnType<ModelRuntime['getModel']>>
type RuntimeProviderConfigInput = Parameters<ModelRuntime['registerProvider']>[1]
type RuntimeProviderModelInput = NonNullable<RuntimeProviderConfigInput['models']>[number]

type RuntimeToolState = {
  surface: ConversationSourceKind
  toolProfileId: string | null
  registry: RuntimeToolRegistryEntry[]
  catalog: RuntimeToolCatalogEntry[]
  enabledToolsets: RuntimeToolsetId[]
}

export type QueueStreamingPromptInput = {
  conversationId: string
  threadId: string
  text: string
  messageId?: string | null
  streamingBehavior: 'steer'
  images?: ChatImageBlock[]
}

type StreamingPromptSession = {
  isStreaming?: boolean
  prompt?: (text: string, options?: Record<string, unknown>) => Promise<void>
}

type HeadlessRuntimeSession = {
  conversationId: string
  interactionThreadId: string
  workspacePath: string
  policyKey: string
  toolContextKey: string
  providerId: string
  providerGeneration: number
  modelId: string
  modelContextWindow: number
  activeToolNames: string[]
  toolState: RuntimeToolState
  session: RuntimeSession
  runtimeAdapter: RuntimeAdapter
  unsubscribe: () => void
  reloadPending: boolean
  reloadInFlight: boolean
}

export type CodingAgentRuntimeBridgeDeps = {
  core: CoreCommandService & CoreQueryService
  contextHostService?: ContextHostService
  promptBudgetService?: PromptBudgetService
  emitAppEvent?: (threadId: string, event: AgentAppEvent) => void
  emitDebugEvent?: (threadId: string, event: ConversationEventRow) => void
  emitQuestionEvent?: (event: PendingQuestionEvent) => void
  emitQuestionnaireEvent?: (event: PendingQuestionnaireEvent) => void
  emitSecretEvent?: (event: PendingSecretPromptEvent) => void
  emitPlanEvent?: (event: ThreadPlanEvent) => void
  dispatchPendingDeliveries?: () => Promise<void>
}

type ThinkingConfigResponse =
  | {
      success: true
      currentLevel: ReasoningLevel
      availableLevels: ReasoningLevel[]
      supportsThinking: boolean
    }
  | { success: false; error: string }

const skillsDisabledKey = (): string => `skills_disabled`
const skillsExtraDirsKey = (): string => `skills_extra_dirs`
const legacySkillDoctorKey = ['diag', 'nostics'].join('')

const uniqueToolDefinitions = (tools: ToolDefinition[]): ToolDefinition[] => {
  const byName = new Map<string, ToolDefinition>()
  for (const tool of tools) {
    if (!byName.has(tool.name)) byName.set(tool.name, tool)
  }
  return [...byName.values()]
}

const buildActiveRuntimeToolCatalog = (
  resolution: RuntimeToolResolution
): RuntimeToolCatalogEntry[] =>
  buildRuntimeToolCatalog(resolution.entries.filter((entry) => entry.status === 'active'))

export const buildAgentSessionToolAllowlist = (
  resolution: Pick<RuntimeToolResolution, 'activeToolNames'>
): string[] =>
  Array.from(new Set(resolution.activeToolNames)).sort((left, right) => left.localeCompare(right))

const isToolDefinition = (value: unknown): value is ToolDefinition => {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.name === 'string' &&
    typeof record.label === 'string' &&
    typeof record.description === 'string' &&
    Boolean(record.parameters && typeof record.parameters === 'object') &&
    typeof record.execute === 'function'
  )
}

export const getAgentPluginExtensionTools = (loader: DefaultResourceLoader): ToolDefinition[] => {
  const result = loader.getExtensions()
  const tools: ToolDefinition[] = []
  for (const extension of result.extensions) {
    const registeredTools = Array.from(extension.tools.values())
    for (const registered of registeredTools) {
      if (isToolDefinition(registered.definition)) tools.push(registered.definition)
    }
  }
  return uniqueToolDefinitions(tools)
}

const readExtraDirs = (): string[] => {
  const raw = getSetting(skillsExtraDirsKey())
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return Array.from(
      new Set(
        parsed
          .filter((x) => typeof x === 'string')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => path.resolve(x))
          .filter((p) => existsSync(p))
      )
    )
  } catch {
    return []
  }
}

const parseModelCapabilitiesJson = (
  value: string | null | undefined
): { imageInput: boolean; reasoning: boolean } => {
  const raw = String(value ?? '').trim()
  if (!raw) return { imageInput: false, reasoning: false }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { imageInput: false, reasoning: false }
    return {
      imageInput: Boolean((parsed as Record<string, unknown>).imageInput),
      reasoning: Boolean((parsed as Record<string, unknown>).reasoning)
    }
  } catch {
    return { imageInput: false, reasoning: false }
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asApi = (value: unknown): Api | null =>
  typeof value === 'string' && value.trim() ? (value.trim() as Api) : null

const isXiaomiProviderId = (providerId: string): boolean => providerId === 'xiaomi'

type XiaomiApiSurface = 'openai' | 'anthropic'

const detectXiaomiApiSurfaceFromBaseUrl = (baseUrl?: string | null): XiaomiApiSurface | null => {
  const trimmed = String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/g, '')
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    const pathname = url.pathname.replace(/\/+$/g, '').toLowerCase()
    if (pathname.endsWith('/v1')) return 'openai'
    if (pathname.endsWith('/anthropic')) return 'anthropic'
  } catch {
    const normalized = trimmed.toLowerCase()
    if (normalized.endsWith('/v1')) return 'openai'
    if (normalized.endsWith('/anthropic')) return 'anthropic'
  }

  return null
}

const xiaomiApiForSurface = (surface: XiaomiApiSurface | null): Api | null =>
  surface === 'openai'
    ? 'openai-completions'
    : surface === 'anthropic'
      ? 'anthropic-messages'
      : null

const normalizeXiaomiOpenAIBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/g, '')
  if (!trimmed) return 'https://token-plan-ams.xiaomimimo.com/v1'

  try {
    const url = new URL(trimmed)
    const pathname = url.pathname.replace(/\/+$/g, '')
    if (/\/anthropic$/i.test(pathname)) {
      url.pathname = pathname.replace(/\/anthropic$/i, '/v1')
      url.search = ''
      url.hash = ''
      return url.toString().replace(/\/+$/g, '')
    }
  } catch {
    if (/\/anthropic$/i.test(trimmed)) return trimmed.replace(/\/anthropic$/i, '/v1')
  }

  return trimmed
}

const providerSettingsApi = (settings: ReturnType<typeof normalizeProviderSettings>): Api =>
  settings.apiFormat === 'responses'
    ? 'openai-responses'
    : settings.apiFormat === 'anthropic_messages'
      ? 'anthropic-messages'
      : 'openai-completions'

const builtInProviderApi = (runtimeProvider: string): Api | null => {
  try {
    return asApi(
      (getModels(runtimeProvider as KnownProvider as any) as Array<{ api?: unknown }>)[0]?.api
    )
  } catch {
    return null
  }
}

const resolveRuntimeProviderApi = (
  providerId: string,
  runtimeProvider: string,
  settings: ReturnType<typeof normalizeProviderSettings>,
  configuredBaseUrl?: string | null
): Api => {
  if (isXiaomiProviderId(providerId)) {
    const api = xiaomiApiForSurface(detectXiaomiApiSurfaceFromBaseUrl(configuredBaseUrl))
    if (api) return api
  }
  if (!shouldRegisterDynamicProvider(providerId, runtimeProvider)) {
    const api = builtInProviderApi(runtimeProvider)
    if (api) return api
  }
  return providerSettingsApi(settings)
}

const asPositiveNumber = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

const resolveStoredModelInput = (
  raw: Record<string, unknown> | null,
  imageInput: boolean
): Array<'text' | 'image'> => {
  const input = Array.isArray(raw?.input) ? raw.input : []
  const values = input.filter(
    (item): item is 'text' | 'image' => item === 'text' || item === 'image'
  )
  if (values.length > 0) return values
  return imageInput ? ['text', 'image'] : ['text']
}

const resolveStoredModelCost = (raw: Record<string, unknown> | null) => {
  const cost = asRecord(raw?.cost)
  return {
    input: asPositiveNumber(cost?.input) ?? 0,
    output: asPositiveNumber(cost?.output) ?? 0,
    cacheRead: asPositiveNumber(cost?.cacheRead) ?? 0,
    cacheWrite: asPositiveNumber(cost?.cacheWrite) ?? 0
  }
}

const asStringRecord = (value: unknown): Record<string, string> | undefined => {
  const record = asRecord(value)
  if (!record) return undefined
  const entries = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

const thinkingLevelKeys = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])

const asThinkingLevelMap = (value: unknown): RuntimeProviderModelInput['thinkingLevelMap'] => {
  const record = asRecord(value)
  if (!record) return undefined
  const entries = Object.entries(record).filter(
    (entry): entry is [string, string | null] =>
      thinkingLevelKeys.has(entry[0]) && (typeof entry[1] === 'string' || entry[1] === null)
  )
  return entries.length > 0
    ? (Object.fromEntries(entries) as RuntimeProviderModelInput['thinkingLevelMap'])
    : undefined
}

const asModelCompat = (value: unknown): RuntimeProviderModelInput['compat'] => {
  const record = asRecord(value)
  return record ? (record as RuntimeProviderModelInput['compat']) : undefined
}

const mapRuntimeRunStatus = (status: AgentRunProjection['status']): AgentRun['status'] => {
  if (status === 'done') return 'finished'
  if (status === 'error') return 'failed'
  if (status === 'aborted') return 'aborted'
  return 'running'
}

const safeJsonParse = (value: string | null): unknown => {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const safeJsonStringify = (value: unknown): string | null => {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

const policyKey = (policy: ExecutionPolicy): string =>
  JSON.stringify({
    model: policy.model,
    contextEngineId: policy.contextEngineId,
    memoryProviderId: policy.memoryProviderId,
    toolProfileId: policy.toolProfileId ?? null,
    sandboxPolicyId: policy.sandboxPolicyId ?? null
  })

const ensureDirectory = (dir: string): string => {
  mkdirSync(dir, { recursive: true })
  return dir
}

export class CodingAgentRuntimeBridge {
  private readonly core: CodingAgentRuntimeBridgeDeps['core']
  private readonly contextHostService?: ContextHostService
  private readonly promptBudgetService?: PromptBudgetService
  private readonly emitAppEvent?: NonNullable<CodingAgentRuntimeBridgeDeps['emitAppEvent']>
  private readonly emitDebugEvent?: NonNullable<CodingAgentRuntimeBridgeDeps['emitDebugEvent']>
  private readonly emitPlanEvent?: NonNullable<CodingAgentRuntimeBridgeDeps['emitPlanEvent']>
  private dispatchPendingDeliveries?: () => Promise<void>
  private readonly interactionController: RuntimeUserInteractionController
  private readonly appConfigDir = getPreferredAppConfigDir()
  private readonly agentDir = path.join(this.appConfigDir, 'agent')
  private modelRuntime: ModelRuntime | null = null
  private modelRuntimeInit: Promise<ModelRuntime> | null = null
  private readonly settingsManager = SettingsManager.inMemory({
    retry: {
      enabled: true,
      maxRetries: 5,
      baseDelayMs: 1000,
      provider: {
        maxRetryDelayMs: 30000
      }
    }
  })
  private readonly sessionsByConversationId = new Map<string, HeadlessRuntimeSession>()
  private readonly abortRequestedConversationIds = new Set<string>()
  private readonly providerGenerationById = new Map<string, number>()
  private readonly conversationIdByInteractionThreadId = new Map<string, string>()
  private readonly interactionThreadIdByConversationId = new Map<string, string>()
  private readonly activeRunByConversationId = new Map<string, AgentRun>()
  private readonly queuedRunsByConversationId = new Map<string, AgentRun[]>()
  private readonly runtimeRunIdToCoreRunId = new Map<string, string>()
  private readonly contextThreadFactory = new ContextThreadFactory()
  private readonly runtimeSurfaceHost = new RuntimeSurfaceHost()
  private readonly baseToolLayer = new BaseRuntimeToolLayer()

  constructor(deps: CodingAgentRuntimeBridgeDeps) {
    this.core = deps.core
    this.contextHostService = deps.contextHostService
    this.promptBudgetService = deps.promptBudgetService
    this.emitAppEvent = deps.emitAppEvent
    this.emitDebugEvent = deps.emitDebugEvent
    this.emitPlanEvent = deps.emitPlanEvent
    this.dispatchPendingDeliveries = deps.dispatchPendingDeliveries
    this.interactionController = new RuntimeUserInteractionController({
      core: this.core,
      emitQuestionEvent: deps.emitQuestionEvent,
      emitQuestionnaireEvent: deps.emitQuestionnaireEvent,
      emitSecretEvent: deps.emitSecretEvent
    })
  }

  setDispatchPendingDeliveries(callback?: () => Promise<void>): void {
    this.dispatchPendingDeliveries = callback
  }

  private async ensureModelRuntime(): Promise<ModelRuntime> {
    if (this.modelRuntime) return this.modelRuntime
    if (!this.modelRuntimeInit) {
      ensureDirectory(this.agentDir)
      this.modelRuntimeInit = ModelRuntime.create({
        authPath: path.join(this.agentDir, 'auth.json'),
        modelsPath: path.join(this.agentDir, 'models.json'),
        allowModelNetwork: false
      }).then((runtime) => {
        this.modelRuntime = runtime
        return runtime
      })
    }
    return this.modelRuntimeInit
  }

  async start(run: AgentRun): Promise<void> {
    const conversation = this.core.getConversation(run.conversationId)
    if (!conversation) throw new Error(`Unknown Conversation: ${run.conversationId}`)

    if (this.shouldCancelRunExecution(run)) {
      await this.abortConversation(run.conversationId)
      return
    }

    this.markRunRunning(run)
    this.activeRunByConversationId.set(run.conversationId, run)

    if (this.shouldCancelRunExecution(run)) {
      await this.abortConversation(run.conversationId)
      return
    }

    const message = this.resolvePromptMessage(run)
    const promptText = message?.text?.trim()
    const isSystemFollowup = run.triggerKind === 'system_followup'
    const promptImages = isSystemFollowup ? [] : this.extractImageBlocks(message)
    if (!promptText && promptImages.length === 0) {
      this.markRunFailed(run, new Error(`No prompt message found for run ${run.id}`))
      return
    }

    try {
      let runtime = await this.getOrCreateSession(
        run,
        message?.externalMessageId ?? message?.id ?? null
      )

      const planPromptContext = this.buildThreadPlanPromptContext(runtime.interactionThreadId)
      const systemEventPrompt = isSystemFollowup ? (promptText ?? '') : ''
      const appendedSystemPrompt = [planPromptContext, systemEventPrompt]
        .map((part) => part.trim())
        .filter(Boolean)
        .join('\n\n')
      const runtimePromptText = isSystemFollowup
        ? SYSTEM_FOLLOWUP_RUNTIME_PROMPT
        : (promptText ?? '')

      runtime = await this.maybePreflightCompact(
        run,
        runtime,
        message?.externalMessageId ?? message?.id ?? null,
        {
          text: runtimePromptText,
          imagesCount: promptImages.length,
          appendedSystemPrompt
        }
      )

      if (this.shouldCancelRunExecution(run)) {
        await this.abortConversation(run.conversationId)
        return
      }

      const promptOptions = isSystemFollowup ? undefined : await this.buildPromptOptions(message)
      this.setSessionAutoRetryEnabled(runtime.session, true)
      if (this.shouldCancelRunExecution(run)) {
        await this.abortConversation(run.conversationId)
        return
      }
      if (appendedSystemPrompt) {
        await withTemporaryPromptAppend(runtime.session as any, appendedSystemPrompt, async () => {
          await (runtime.session as any).prompt(runtimePromptText, promptOptions)
        })
      } else {
        await (runtime.session as any).prompt(runtimePromptText, promptOptions)
      }
    } catch (error) {
      if (
        this.shouldCancelRunExecution(run) ||
        this.core.getAgentRun(run.id)?.status === 'aborted'
      ) {
        return
      }
      this.markRunFailed(run, error)
      throw error
    } finally {
      this.activeRunByConversationId.delete(run.conversationId)
    }
  }

  async stopConversation(conversationId: string): Promise<void> {
    const resolvedConversationId = this.resolveConversationId(conversationId)
    this.abortRequestedConversationIds.delete(resolvedConversationId)
    const interactionThreadId =
      this.interactionThreadIdByConversationId.get(resolvedConversationId) ?? conversationId
    this.interactionController.abortThread(interactionThreadId, 'execution_interrupted')
    const existing = this.sessionsByConversationId.get(resolvedConversationId)
    if (!existing) return
    this.disposeSession(existing)
    this.sessionsByConversationId.delete(resolvedConversationId)
    this.activeRunByConversationId.delete(resolvedConversationId)
    this.forgetInteractionThreadMapping(resolvedConversationId)
  }

  queueStreamingPrompt(input: QueueStreamingPromptInput): boolean {
    const resolvedConversationId = this.resolveConversationId(input.conversationId)
    if (this.abortRequestedConversationIds.has(resolvedConversationId)) return false
    const runtime = this.sessionsByConversationId.get(resolvedConversationId)
    const session = runtime?.session as StreamingPromptSession | undefined
    if (!runtime || !session?.isStreaming || typeof session.prompt !== 'function') return false

    const text = String(input.text ?? '')
      .replace(/\r\n/g, '\n')
      .trim()
    const images = input.images ?? []
    if (!text && images.length === 0) return false

    const traceId = String(input.messageId ?? '').trim()
    const queuedRun = this.resolveQueuedPromptRun(resolvedConversationId, traceId)
    if (this.shouldCancelRunExecution(queuedRun)) return false
    this.markRunRunning(queuedRun)
    if (this.shouldCancelRunExecution(queuedRun)) return false
    this.enqueueQueuedRun(resolvedConversationId, queuedRun)
    this.setSessionAutoRetryEnabled(runtime.session, true)
    void this.submitQueuedPromptToActiveSession(
      runtime,
      {
        text,
        images,
        streamingBehavior: input.streamingBehavior
      },
      queuedRun
    )
    return true
  }

  async stopAll(): Promise<void> {
    this.interactionController.abortAll('execution_interrupted')
    for (const session of this.sessionsByConversationId.values()) {
      this.disposeSession(session)
    }
    this.sessionsByConversationId.clear()
    this.conversationIdByInteractionThreadId.clear()
    this.interactionThreadIdByConversationId.clear()
    this.activeRunByConversationId.clear()
    this.queuedRunsByConversationId.clear()
    this.runtimeRunIdToCoreRunId.clear()
  }

  async answerQuestion(
    threadId: string,
    payload: QuestionAnswerPayload
  ): Promise<RuntimeInteractionAnswerResult> {
    return this.interactionController.answerQuestion(threadId, payload)
  }

  async answerQuestionnaire(
    threadId: string,
    payload: QuestionnaireAnswerPayload
  ): Promise<RuntimeInteractionAnswerResult> {
    return this.interactionController.answerQuestionnaire(threadId, payload)
  }

  async answerSecret(
    threadId: string,
    payload: SecretAnswerPayload
  ): Promise<RuntimeInteractionAnswerResult> {
    return this.interactionController.answerSecret(threadId, payload)
  }

  async invalidateProvider(
    providerId: string
  ): Promise<{ success: true; affectedConversationIds: string[] }> {
    const normalizedProviderId = String(providerId ?? '').trim()
    if (!normalizedProviderId) return { success: true, affectedConversationIds: [] }

    const nextGeneration = this.getProviderGeneration(normalizedProviderId) + 1
    this.providerGenerationById.set(normalizedProviderId, nextGeneration)

    const affectedConversationIds: string[] = []
    for (const runtime of this.sessionsByConversationId.values()) {
      if (runtime.providerId !== normalizedProviderId) continue
      affectedConversationIds.push(runtime.conversationId)
      runtime.reloadPending = true
    }

    return { success: true, affectedConversationIds }
  }

  async prepareConversation(input: {
    conversationId: string
    executionPolicy: ExecutionPolicy
  }): Promise<void> {
    await this.getOrCreateSessionForExecution({
      conversationId: input.conversationId,
      executionPolicy: input.executionPolicy
    })
  }

  async abortConversation(conversationId: string): Promise<void> {
    const resolvedConversationId = this.resolveConversationId(conversationId)
    this.abortRequestedConversationIds.add(resolvedConversationId)

    try {
      await this.markActiveConversationRunAborted(resolvedConversationId)

      const interactionThreadId =
        this.interactionThreadIdByConversationId.get(resolvedConversationId) ??
        resolvedConversationId
      this.interactionController.abortThread(interactionThreadId, 'execution_interrupted')

      const runtime = this.sessionsByConversationId.get(resolvedConversationId)
      if (runtime) {
        await this.hardDisposeRuntimeSession(runtime)
      }

      this.queuedRunsByConversationId.delete(resolvedConversationId)
    } finally {
      this.abortRequestedConversationIds.delete(resolvedConversationId)
    }
  }

  private async markActiveConversationRunAborted(
    conversationId: string,
    preferredRun?: AgentRun
  ): Promise<void> {
    const run =
      preferredRun ??
      this.activeRunByConversationId.get(conversationId) ??
      this.findActiveRunnableRun(conversationId)
    if (!run) return

    const latest = this.core.getAgentRun(run.id) ?? run
    if (latest.status !== 'requested' && latest.status !== 'running') return

    const endedAt = new Date().toISOString()
    this.markRunAborted(latest, endedAt)
    this.activeRunByConversationId.delete(conversationId)

    const conversation = this.core.getConversation(conversationId)
    if (!conversation) return
    const interactionThreadId =
      this.interactionThreadIdByConversationId.get(conversationId) ??
      this.resolveInteractionThreadId(conversation)
    this.emitAbortedAppEvent(interactionThreadId, latest, endedAt)
  }

  private async hardDisposeRuntimeSession(runtime: HeadlessRuntimeSession): Promise<void> {
    const requestedRunId = runtime.runtimeAdapter.getSnapshot()?.agentRunId ?? null
    runtime.runtimeAdapter.markAbortRequested()
    const snapshot = runtime.runtimeAdapter.getSnapshot()
    if (
      snapshot?.status === 'running' &&
      (!requestedRunId || snapshot.agentRunId === requestedRunId)
    ) {
      runtime.runtimeAdapter.forceAbortIfRunning()
    }

    const session = runtime.session as {
      abort?: () => unknown
      setAutoRetryEnabled?: (enabled: boolean) => void
    }
    this.setSessionAutoRetryEnabled(session, false)
    try {
      await Promise.race([
        Promise.resolve(session.abort?.()),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 400)
        })
      ])
    } catch (error: unknown) {
      console.error('Runtime bridge abort failed', error)
    }

    this.disposeSession(runtime)
    this.sessionsByConversationId.delete(runtime.conversationId)
  }

  private findActiveRunnableRun(conversationId: string): AgentRun | null {
    const active = this.activeRunByConversationId.get(conversationId)
    if (active) {
      const latest = this.core.getAgentRun(active.id) ?? active
      if (latest.status === 'requested' || latest.status === 'running') return latest
    }
    return (
      this.core
        .listConversationRuns(conversationId)
        .find((item) => item.status === 'requested' || item.status === 'running') ?? null
    )
  }

  private shouldCancelRunExecution(run: AgentRun): boolean {
    if (this.abortRequestedConversationIds.has(run.conversationId)) return true
    const latest = this.core.getAgentRun(run.id)
    return latest?.status === 'aborted'
  }

  private emitAbortedAppEvent(
    interactionThreadId: string,
    run: AgentRun,
    endedAtIso: string
  ): void {
    if (!this.emitAppEvent) return

    const endedAt = Date.parse(endedAtIso) || Date.now()
    const startedAt = Date.parse(run.startedAt) || endedAt
    const projection: AgentRunProjection = {
      threadId: interactionThreadId,
      agentRunId: run.id,
      status: 'aborted',
      startedAt,
      endedAt,
      turns: [],
      messages: [],
      toolCalls: [],
      text: '',
      termination: { kind: 'aborted', at: endedAt }
    }

    this.emitAppEvent(interactionThreadId, {
      id: crypto.randomUUID(),
      type: 'agent.run.aborted',
      timestamp: endedAt,
      threadId: interactionThreadId,
      agentRunId: run.id,
      agentTurnId: null,
      traceId: run.traceId,
      correlationId: run.id,
      causationId: null,
      parentEventId: null,
      sequence: 0,
      run: projection
    })
  }

  private setSessionAutoRetryEnabled(session: unknown, enabled: boolean): void {
    const candidate = session as {
      setAutoRetryEnabled?: (enabled: boolean) => void
    } | null
    if (typeof candidate?.setAutoRetryEnabled !== 'function') return
    candidate.setAutoRetryEnabled(enabled)
  }

  private async submitQueuedPromptToActiveSession(
    runtime: HeadlessRuntimeSession,
    input: {
      text: string
      images: ChatImageBlock[]
      streamingBehavior: 'steer'
    },
    queuedRun?: AgentRun | null
  ): Promise<void> {
    try {
      if (queuedRun && this.shouldCancelRunExecution(queuedRun)) return
      if (this.abortRequestedConversationIds.has(runtime.conversationId)) return
      if (this.sessionsByConversationId.get(runtime.conversationId) !== runtime) return

      const materializedImages = await Promise.all(
        input.images.map((image) => materializeImageBlockForRuntime(image))
      )
      if (queuedRun && this.shouldCancelRunExecution(queuedRun)) return
      if (this.abortRequestedConversationIds.has(runtime.conversationId)) return
      if (this.sessionsByConversationId.get(runtime.conversationId) !== runtime) return

      const promptOptions = this.buildPromptOptionsFromParts({
        images: materializedImages,
        streamingBehavior: input.streamingBehavior
      })
      const session = runtime.session as StreamingPromptSession
      await session.prompt?.(input.text, promptOptions)
    } catch (error) {
      if (queuedRun && !this.shouldCancelRunExecution(queuedRun))
        this.markRunFailed(queuedRun, error)
      if (!this.abortRequestedConversationIds.has(runtime.conversationId)) {
        console.error('Runtime bridge queued streaming prompt failed', error)
      }
    } finally {
      if (queuedRun) this.removeQueuedRun(runtime.conversationId, queuedRun.id)
    }
  }

  private resolveQueuedPromptRun(conversationId: string, traceId: string): AgentRun {
    const existing =
      traceId &&
      this.core
        .listConversationRuns(conversationId)
        .find(
          (run) =>
            run.traceId === traceId && (run.status === 'requested' || run.status === 'running')
        )
    if (existing) return existing
    return this.core.requestRun({
      conversationId,
      triggerKind: 'user_message',
      traceId: traceId || undefined
    })
  }

  async reloadConversation(
    conversationId: string
  ): Promise<{ reloaded: boolean; deferred: boolean; reason?: 'not-initialized' }> {
    const runtime = this.sessionsByConversationId.get(this.resolveConversationId(conversationId))
    if (!runtime) {
      return {
        reloaded: false,
        deferred: false,
        reason: 'not-initialized'
      }
    }

    if (runtime.reloadInFlight || (runtime.session as any).isStreaming) {
      runtime.reloadPending = true
      return { reloaded: false, deferred: true }
    }

    runtime.reloadInFlight = true
    runtime.reloadPending = false
    try {
      await (runtime.session as any).reload?.()
    } finally {
      runtime.reloadInFlight = false
    }

    if (runtime.reloadPending && !(runtime.session as any).isStreaming) {
      return await this.reloadConversation(conversationId)
    }

    return { reloaded: true, deferred: false }
  }

  getLiveSnapshot(conversationId: string): AgentRunProjection | null {
    const resolvedConversationId = this.resolveConversationId(conversationId)
    const snapshot =
      this.sessionsByConversationId.get(resolvedConversationId)?.runtimeAdapter.getSnapshot() ??
      null
    if (!snapshot) return null
    return this.mapProjectionRunId(
      snapshot,
      this.resolveCoreRunId(resolvedConversationId, snapshot.agentRunId)
    )
  }

  getContextRuntimeState(conversationId: string): {
    initialized: boolean
    modelKey: string | null
    contextWindow: number | null
    isStreaming: boolean
    activeToolNames: string[]
    currentMessages: unknown[]
    systemPrompt: string
    contextUsage: unknown
  } {
    const runtime = this.sessionsByConversationId.get(this.resolveConversationId(conversationId))
    if (!runtime) {
      return {
        initialized: false,
        modelKey: null,
        contextWindow: null,
        isStreaming: false,
        activeToolNames: [],
        currentMessages: [],
        systemPrompt: '',
        contextUsage: undefined
      }
    }

    const session = runtime.session as any
    return {
      initialized: true,
      modelKey: `${runtime.providerId}::${runtime.modelId}`,
      contextWindow: runtime.modelContextWindow || null,
      isStreaming: Boolean(session.isStreaming),
      activeToolNames: runtime.activeToolNames,
      currentMessages: Array.isArray(session.agent?.state?.messages)
        ? session.agent.state.messages
        : [],
      systemPrompt: typeof session.systemPrompt === 'string' ? session.systemPrompt : '',
      contextUsage: session.getContextUsage?.()
    }
  }

  getInteractionState(conversationId: string): {
    question: boolean
    questionnaire: boolean
  } {
    const resolvedConversationId = this.resolveConversationId(conversationId)
    const interactionThreadId =
      this.interactionThreadIdByConversationId.get(resolvedConversationId) ?? resolvedConversationId
    return {
      question: this.interactionController.hasPendingQuestion(interactionThreadId),
      questionnaire: this.interactionController.hasPendingQuestionnaire(interactionThreadId)
    }
  }

  getThinkingConfig(conversationId: string): ThinkingConfigResponse {
    const runtime = this.sessionsByConversationId.get(this.resolveConversationId(conversationId))
    if (!runtime) {
      return { success: false, error: `Runtime not initialized for conversation=${conversationId}` }
    }

    const session = runtime.session as any
    const availableLevels = session.getAvailableThinkingLevels?.() ?? []
    const supportsThinking = Boolean(session.supportsThinking?.())
    return {
      success: true,
      currentLevel: (session.thinkingLevel ?? 'off') as ReasoningLevel,
      availableLevels: Array.isArray(availableLevels)
        ? (availableLevels.filter(
            (level): level is ReasoningLevel => typeof level === 'string'
          ) as ReasoningLevel[])
        : [],
      supportsThinking
    }
  }

  setThinkingLevel(conversationId: string, level: ReasoningLevel): ThinkingConfigResponse {
    const runtime = this.sessionsByConversationId.get(this.resolveConversationId(conversationId))
    if (!runtime) {
      return { success: false, error: `Runtime not initialized for conversation=${conversationId}` }
    }

    const session = runtime.session as any
    session.setThinkingLevel?.(level)
    return this.getThinkingConfig(conversationId)
  }

  async getUserMessagesForForking(
    conversationId: string
  ): Promise<Array<{ entryId: string; text: string }>> {
    const runtime = this.sessionsByConversationId.get(this.resolveConversationId(conversationId))
    if (!runtime) throw new Error(`Runtime not initialized for conversation=${conversationId}`)
    const rows = await (runtime.session as any).getUserMessagesForForking?.()
    return Array.isArray(rows) ? rows : []
  }

  async navigateConversationTree(
    conversationId: string,
    targetId: string,
    options?: {
      summarize?: boolean
      customInstructions?: string
      replaceInstructions?: boolean
      label?: string
    }
  ): Promise<{ cancelled: boolean; editorText?: string; aborted?: boolean }> {
    const runtime = this.sessionsByConversationId.get(this.resolveConversationId(conversationId))
    if (!runtime) throw new Error(`Runtime not initialized for conversation=${conversationId}`)
    return await (runtime.session as any).navigateTree?.(targetId, options)
  }

  private async getOrCreateSession(run: AgentRun, currentPromptExternalMessageId?: string | null) {
    return await this.getOrCreateSessionForExecution({
      conversationId: run.conversationId,
      executionPolicy: run.effectiveExecutionSnapshot,
      currentPromptExternalMessageId
    })
  }

  private async getOrCreateSessionForExecution(input: {
    conversationId: string
    executionPolicy: ExecutionPolicy
    currentPromptExternalMessageId?: string | null
  }): Promise<HeadlessRuntimeSession> {
    const conversation = this.core.getConversation(input.conversationId)
    if (!conversation) throw new Error(`Unknown Conversation: ${input.conversationId}`)

    const workspacePath =
      conversation.workspaceId?.trim() ||
      ensureDirectory(path.join(this.appConfigDir, 'headless-workspaces', conversation.id))
    const interactionThreadId = this.resolveInteractionThreadId(conversation)
    this.rememberInteractionThreadMapping(conversation.id, interactionThreadId)
    const surface = await this.resolveRuntimeSurface(conversation)
    const policy = input.executionPolicy
    const nextPolicyKey = policyKey(policy)
    const agentPluginResources = await resolveAgentPluginResources()
    const nextToolContextKey = JSON.stringify({
      surface: surface.sourceKind,
      agentPlugins: agentPluginResources.signature
    })
    const nextProviderGeneration = this.getProviderGeneration(policy.model.providerId)
    const existing = this.sessionsByConversationId.get(conversation.id)
    if (
      existing &&
      existing.workspacePath === workspacePath &&
      existing.policyKey === nextPolicyKey &&
      existing.toolContextKey === nextToolContextKey &&
      existing.providerGeneration === nextProviderGeneration
    ) {
      return existing
    }

    if (existing) {
      this.interactionController.abortThread(existing.interactionThreadId, 'execution_interrupted')
      this.disposeSession(existing)
    }

    const modelDef = await this.resolveModel(policy)
    const parentRuntimeModel = await this.buildWorkerRuntimeModelConfig(policy, modelDef)
    const loader = await this.createResourceLoader(
      workspacePath,
      interactionThreadId,
      surface,
      conversation.id,
      agentPluginResources
    )
    this.applyShellPrefix()
    const runtimeSurfaceContext = {
      conversationId: conversation.id,
      interactionThreadId,
      workspacePath,
      parentRuntimeModel,
      getActiveRunId: () => this.activeRunByConversationId.get(conversation.id)?.id ?? null,
      interactionController: this.interactionController
    }
    const interactionTools =
      surface.sourceKind === 'local'
        ? this.interactionController.createTools({
            conversationId: conversation.id,
            interactionThreadId,
            getActiveRunId: () => this.activeRunByConversationId.get(conversation.id)?.id ?? null
          })
        : []
    const planTools =
      surface.sourceKind === 'local'
        ? createPlanTools({
            threadId: interactionThreadId,
            conversationId: conversation.id,
            getActiveRunId: () => this.activeRunByConversationId.get(conversation.id)?.id ?? null,
            getPlanState: () => this.core.getThreadPlanState(interactionThreadId),
            upsertPlanState: (planInput) => this.core.upsertThreadPlanState(planInput),
            emitPlanEvent: this.emitPlanEvent
          })
        : []
    const localInteractionTools = [...interactionTools, ...planTools]
    const builtinToolDefinitions = this.baseToolLayer.getBaseBuiltinToolDefinitions(
      workspacePath,
      policy.sandboxPolicyId
    )
    const { frameworkTools, mcpTools } = await this.baseToolLayer.getFrameworkCustomToolGroups(
      workspacePath,
      {
        extraMcpServers: agentPluginResources.mcpServers,
        getSkills: () => loader.getSkills().skills,
        sandboxPolicyId: policy.sandboxPolicyId
      }
    )
    // MCP servers, agent plugins, and desktop automation run outside the filesystem
    // boundary controlled below. Keep them out of sandbox sessions until each has an
    // isolated host and its own permission contract. Network-only tools remain available.
    const isWorkspaceSandbox = policy.sandboxPolicyId === 'sandbox'
    const safeFrameworkTools = isWorkspaceSandbox
      ? frameworkTools.filter((tool) => tool.name !== 'computerUse')
      : frameworkTools
    const manifestPluginTools = isWorkspaceSandbox ? [] : agentPluginResources.tools
    const pluginCatalogTools = isWorkspaceSandbox
      ? []
      : uniqueToolDefinitions([...manifestPluginTools, ...getAgentPluginExtensionTools(loader)])
    const surfaceTools = isWorkspaceSandbox
      ? []
      : await surface.getCustomTools(runtimeSurfaceContext)
    const sandboxMcpTools = isWorkspaceSandbox ? [] : mcpTools
    let registry = buildRuntimeToolRegistry([
      { source: 'builtin', tools: builtinToolDefinitions, scopes: ['local', 'im'] },
      { source: 'framework', tools: safeFrameworkTools, scopes: ['local', 'im'] },
      { source: 'mcp', tools: sandboxMcpTools, scopes: ['local', 'im'] },
      { source: 'plugin', tools: pluginCatalogTools, scopes: ['local', 'im'] },
      { source: 'interaction', tools: localInteractionTools, scopes: ['local'] },
      { source: 'surface', tools: surfaceTools, scopes: [surface.sourceKind] }
    ])
    let resolution = resolveRuntimeTools(registry, {
      surface: surface.sourceKind,
      toolProfileId: policy.toolProfileId ?? null
    })
    const runtimeToolState: RuntimeToolState = {
      surface: surface.sourceKind,
      toolProfileId: policy.toolProfileId ?? null,
      registry,
      catalog: buildActiveRuntimeToolCatalog(resolution),
      enabledToolsets: resolution.enabledToolsets
    }
    const discoverBuiltinToolsTool = createDiscoverBuiltinToolsTool({
      getCatalog: () => runtimeToolState.catalog
    })
    registry = buildRuntimeToolRegistry([
      { source: 'builtin', tools: builtinToolDefinitions, scopes: ['local', 'im'] },
      {
        source: 'framework',
        tools: [discoverBuiltinToolsTool, ...safeFrameworkTools],
        scopes: ['local', 'im']
      },
      { source: 'mcp', tools: sandboxMcpTools, scopes: ['local', 'im'] },
      { source: 'plugin', tools: pluginCatalogTools, scopes: ['local', 'im'] },
      { source: 'interaction', tools: localInteractionTools, scopes: ['local'] },
      { source: 'surface', tools: surfaceTools, scopes: [surface.sourceKind] }
    ])
    resolution = resolveRuntimeTools(registry, {
      surface: surface.sourceKind,
      toolProfileId: policy.toolProfileId ?? null
    })
    runtimeToolState.registry = registry
    runtimeToolState.catalog = buildActiveRuntimeToolCatalog(resolution)
    runtimeToolState.enabledToolsets = resolution.enabledToolsets
    const sessionToolAllowlist = buildAgentSessionToolAllowlist(resolution)
    const customTools = uniqueToolDefinitions([
      // createAgentSession installs its own builtin tools. Register these definitions too so
      // the session registry replaces those defaults with the guarded implementations.
      ...builtinToolDefinitions,
      discoverBuiltinToolsTool,
      ...safeFrameworkTools,
      ...sandboxMcpTools,
      ...manifestPluginTools,
      ...localInteractionTools,
      ...surfaceTools
    ])

    const modelRuntime = await this.ensureModelRuntime()
    const result = await createAgentSession({
      cwd: workspacePath,
      agentDir: this.agentDir,
      model: modelDef,
      thinkingLevel: policy.model.reasoningLevel as any,
      modelRuntime,
      settingsManager: this.settingsManager,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(workspacePath),
      customTools,
      tools: sessionToolAllowlist
    })

    const session = applyAgentSessionCompat(result.session, {
      contextWindow: modelDef.contextWindow ?? null,
      maxTokens: modelDef.maxTokens ?? null
    })
    this.installXiaomiReasoningContentPayloadCompat(session as any)
    ;(session as any).setActiveToolsByName?.(sessionToolAllowlist)
    const contextSeedApplied = await this.applyContextSeed(
      session as any,
      interactionThreadId,
      modelDef
    )
    // Context-engine seed already carries tool/result history. Core chat seed
    // must not overwrite it, or usage stays low and auto-compact never fires.
    if (!contextSeedApplied) {
      await this.applyCoreConversationSeed(
        session as any,
        conversation.id,
        input.currentPromptExternalMessageId ?? null
      )
    }
    const runtimeAdapter = new RuntimeAdapter(session, {
      threadId: interactionThreadId,
      ensureConsumedUserMessage: async (payload) =>
        await this.ensureContextConsumedUserMessage(interactionThreadId, payload),
      onConsumedUserMessage: async (message) => {
        if (!this.contextHostService) return
        await this.contextHostService.onConsumedUserMessage(message)
      },
      onEventsFlushed: async (rows) => this.persistRuntimeEvents(conversation.id, rows),
      resolveCanonicalRunId: (agentRunId) => this.resolveCoreRunId(conversation.id, agentRunId),
      onAppEvent: (appEvent) => {
        const mappedAppEvent = this.mapAppEventRunId(conversation.id, appEvent)
        if (!mappedAppEvent) return
        this.emitAppEvent?.(interactionThreadId, mappedAppEvent)
      },
      onRunFinalized: async (projection) => {
        if (this.contextHostService) {
          this.contextHostService.recordContextUsage(
            interactionThreadId,
            session.getContextUsage?.()
          )
        }
        await this.persistFinalizedRun(conversation.id, projection)
        if (this.contextHostService) {
          await this.contextHostService.onRunFinalized(
            interactionThreadId,
            this.mapProjectionRunId(
              projection,
              this.resolveCoreRunId(conversation.id, projection.agentRunId)
            )
          )
          // Fire-and-forget: if context grew past the compaction threshold
          // during this run, compact now instead of waiting for the next
          // user message.
          this.contextHostService
            .compactAfterRun(
              interactionThreadId,
              `${policy.model.providerId}::${policy.model.modelId}`
            )
            .catch(() => {})
        }
        const current = this.sessionsByConversationId.get(conversation.id)
        if (current?.reloadPending) {
          void this.reloadConversation(conversation.id).catch((error) => {
            console.error('Deferred runtime reload failed', error)
          })
        }
      }
    })
    const unsubscribe = runtimeAdapter.connect()

    const runtime: HeadlessRuntimeSession = {
      conversationId: conversation.id,
      interactionThreadId,
      workspacePath,
      policyKey: nextPolicyKey,
      toolContextKey: nextToolContextKey,
      providerId: policy.model.providerId,
      providerGeneration: nextProviderGeneration,
      modelId: policy.model.modelId,
      modelContextWindow: modelDef.contextWindow ?? 0,
      activeToolNames: sessionToolAllowlist,
      toolState: runtimeToolState,
      session,
      runtimeAdapter,
      unsubscribe,
      reloadPending: false,
      reloadInFlight: false
    }
    this.sessionsByConversationId.set(conversation.id, runtime)
    return runtime
  }

  private resolveInteractionThreadId(conversation: Conversation): string {
    const binding = conversation.activeBindingId
      ? this.core.getConversationBinding(conversation.activeBindingId)
      : null
    if (binding && deriveConversationSourceKind(binding.transportId) === 'local') {
      return binding.externalChatId || conversation.id
    }
    return conversation.id
  }

  private getProviderGeneration(providerId: string): number {
    return this.providerGenerationById.get(String(providerId ?? '').trim()) ?? 0
  }

  private rememberInteractionThreadMapping(
    conversationId: string,
    interactionThreadId: string
  ): void {
    this.conversationIdByInteractionThreadId.set(interactionThreadId, conversationId)
    this.interactionThreadIdByConversationId.set(conversationId, interactionThreadId)
  }

  private forgetInteractionThreadMapping(conversationId: string): void {
    const interactionThreadId = this.interactionThreadIdByConversationId.get(conversationId)
    if (interactionThreadId) this.conversationIdByInteractionThreadId.delete(interactionThreadId)
    this.interactionThreadIdByConversationId.delete(conversationId)
  }

  private resolveConversationId(value: string): string {
    const normalized = String(value ?? '').trim()
    return this.conversationIdByInteractionThreadId.get(normalized) ?? normalized
  }

  private buildThreadPlanPromptContext(interactionThreadId: string): string {
    const state = this.core.getThreadPlanState(interactionThreadId)
    if (!state || state.items.length === 0) return ''
    const lines = [
      '## Current Todo Runtime State',
      `Panel: ${state.closed ? 'closed' : 'open'}`,
      'This is the latest persisted thread-level todo snapshot. Use `setPlanTool` to replace it when the plan changes, or `closePlanTool` when the panel should be closed.'
    ]
    for (const item of state.items) {
      lines.push(`- [${item.status}] ${item.text}`)
    }
    return lines.join('\n')
  }

  private async resolveRuntimeSurface(conversation: Conversation): Promise<RuntimeSurfacePlugin> {
    const binding = conversation.activeBindingId
      ? this.core.getConversationBinding(conversation.activeBindingId)
      : null
    const sourceKind = binding ? deriveConversationSourceKind(binding.transportId) : 'local'
    return await this.runtimeSurfaceHost.getSurface(sourceKind)
  }

  private emitDebugRow(threadId: string, eventType: string, payload: unknown): void {
    if (!this.emitDebugEvent) return
    this.emitDebugEvent(threadId, {
      id: crypto.randomUUID(),
      thread_id: threadId,
      agent_run_id: null,
      event_type: eventType,
      event_origin: 'debug',
      correlation_id: crypto.randomUUID(),
      payload_json: safeJsonStringify(payload) ?? 'null',
      raw_json: null,
      created_at: Date.now()
    })
  }

  private async maybePreflightCompact(
    run: AgentRun,
    runtime: HeadlessRuntimeSession,
    currentPromptExternalMessageId: string | null,
    input: {
      text: string
      imagesCount: number
      appendedSystemPrompt?: string
    }
  ): Promise<HeadlessRuntimeSession> {
    if (!this.contextHostService || !this.promptBudgetService) return runtime
    const session = runtime.session as any
    if (session.isStreaming) return runtime

    const estimate = this.promptBudgetService.estimate({
      config: this.contextHostService.getConfig(),
      contextWindow: runtime.modelContextWindow,
      currentMessages: Array.isArray(session.agent?.state?.messages)
        ? session.agent.state.messages
        : [],
      systemPrompt: typeof session.systemPrompt === 'string' ? session.systemPrompt : '',
      appendedSystemPrompt: input.appendedSystemPrompt,
      pendingUserText: input.text,
      pendingImageCount: input.imagesCount,
      contextUsage: session.getContextUsage?.()
    })

    let outcome: Awaited<ReturnType<NonNullable<typeof this.contextHostService>['compactPreflight']>>
    try {
      outcome = await this.contextHostService.compactPreflight(
        runtime.interactionThreadId,
        `${runtime.providerId}::${runtime.modelId}`,
        estimate,
        {
          onBeforeCompact: (effectiveEstimate) => {
            this.emitDebugRow(runtime.interactionThreadId, 'context.compaction.started', {
              reason: 'preflight',
              estimateMode: effectiveEstimate.estimateMode,
              estimatedPromptTokens: effectiveEstimate.estimatedPromptTokens,
              thresholdTokens: effectiveEstimate.thresholdTokens,
              contextWindow: effectiveEstimate.contextWindow
            })
          }
        }
      )
    } catch (error) {
      this.emitDebugRow(runtime.interactionThreadId, 'context.compaction.failed', {
        reason: 'preflight',
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }

    if (!outcome.attempted) return runtime

    if (!outcome.result?.changed) {
      this.emitDebugRow(runtime.interactionThreadId, 'context.compaction.skipped', {
        reason: 'preflight',
        revision: outcome.result?.revision ?? null,
        estimateMode: outcome.estimate.estimateMode,
        estimatedPromptTokens: outcome.estimate.estimatedPromptTokens,
        thresholdTokens: outcome.estimate.thresholdTokens,
        contextWindow: outcome.estimate.contextWindow
      })
      return runtime
    }

    this.emitDebugRow(runtime.interactionThreadId, 'context.compaction.completed', {
      reason: 'preflight',
      revision: outcome.result.revision,
      summaryEntryId: outcome.result.summaryEntryId ?? null,
      estimateMode: outcome.estimate.estimateMode,
      estimatedPromptTokens: outcome.estimate.estimatedPromptTokens,
      thresholdTokens: outcome.estimate.thresholdTokens,
      contextWindow: outcome.estimate.contextWindow
    })
    // Keep legacy event name for debug/history consumers that still listen for preflight.
    this.emitDebugRow(runtime.interactionThreadId, 'context.compaction.preflight', {
      estimateMode: outcome.estimate.estimateMode,
      estimatedPromptTokens: outcome.estimate.estimatedPromptTokens,
      thresholdTokens: outcome.estimate.thresholdTokens,
      contextWindow: outcome.estimate.contextWindow,
      revision: outcome.result.revision,
      summaryEntryId: outcome.result.summaryEntryId ?? null
    })

    await this.stopConversation(run.conversationId)
    return await this.getOrCreateSessionForExecution({
      conversationId: run.conversationId,
      executionPolicy: run.effectiveExecutionSnapshot,
      currentPromptExternalMessageId
    })
  }

  private installXiaomiReasoningContentPayloadCompat(session: RuntimeSession): void {
    const agent = (session as any)?.agent
    if (!agent || typeof agent !== 'object') return

    const originalOnPayload =
      typeof agent.onPayload === 'function' ? agent.onPayload.bind(agent) : null
    agent.onPayload = async (payload: unknown, model: unknown) => {
      const nextPayload = originalOnPayload ? await originalOnPayload(payload, model) : payload
      return this.normalizeXiaomiReasoningContentPayload(nextPayload ?? payload, model)
    }
  }

  private normalizeXiaomiReasoningContentPayload(payload: unknown, model: unknown): unknown {
    if (!this.isXiaomiModel(model)) return payload

    const request = asRecord(payload)
    const messages = Array.isArray(request?.messages) ? request.messages : null
    if (!request || !messages) return payload

    let changed = false
    const normalizedMessages = messages.map((message) => {
      const record = asRecord(message)
      if (!record || record.role !== 'assistant') return message
      if (typeof record.reasoning_content === 'string') return message

      changed = true
      return {
        ...record,
        reasoning_content: this.extractReasoningContentFromAssistantPayload(record)
      }
    })

    return changed ? { ...request, messages: normalizedMessages } : payload
  }

  private isXiaomiModel(model: unknown): boolean {
    const record = asRecord(model)
    const provider = String(record?.provider ?? '')
      .trim()
      .toLowerCase()
    const baseUrl = String(record?.baseUrl ?? '')
      .trim()
      .toLowerCase()

    return (
      provider === 'xiaomi' ||
      provider.startsWith('xiaomi-') ||
      baseUrl.includes('xiaomimimo.com') ||
      baseUrl.includes('mimo-v2.com')
    )
  }

  private extractReasoningContentFromAssistantPayload(message: Record<string, unknown>): string {
    const content = Array.isArray(message.content) ? message.content : []
    const thinkingParts = content
      .map((item) => {
        const block = asRecord(item)
        if (!block || block.type !== 'thinking') return ''
        return typeof block.thinking === 'string' ? block.thinking : ''
      })
      .filter((text) => text.trim().length > 0)

    if (thinkingParts.length > 0) return thinkingParts.join('\n\n')

    const hasToolUse = content.some((item) => asRecord(item)?.type === 'tool_use')
    if (!hasToolUse) return ''

    return content
      .map((item) => {
        const block = asRecord(item)
        if (!block || block.type !== 'text') return ''
        return typeof block.text === 'string' ? block.text : ''
      })
      .filter((text) => text.trim().length > 0)
      .join('\n\n')
  }

  private async ensureContextConsumedUserMessage(
    interactionThreadId: string,
    payload: {
      threadId: string
      text: string
      agentRunId: string
      agentTurnId?: string | null
      consumedAt: number
      runtimeSequence: number
    }
  ) {
    if (payload.threadId !== interactionThreadId) return null
    if (resolveRuntimeThreadSourceKind(this.core, interactionThreadId) === 'im') return null
    const conversationId = this.resolveConversationId(interactionThreadId)
    const coreRunId = this.resolveCoreRunId(conversationId, payload.agentRunId)
    if (this.isSystemFollowupRun(coreRunId)) return null
    return (await getLocalThreadHostService()).ensureConsumedUserMessage({
      threadId: interactionThreadId,
      text: payload.text,
      agentRunId: coreRunId,
      agentTurnId: payload.agentTurnId ?? null,
      consumedAt: payload.consumedAt,
      runtimeSequence: payload.runtimeSequence
    })
  }

  private async applyContextSeed(
    session: RuntimeSession,
    interactionThreadId: string,
    modelDef: RuntimeModelDefinition
  ): Promise<boolean> {
    if (!this.contextHostService) return false
    try {
      const seedSnapshot = await this.contextHostService.buildSeedMessages(interactionThreadId, {
        api: modelDef.api,
        provider: (modelDef as any).provider,
        id: modelDef.id
      })
      if (!Array.isArray(seedSnapshot.messages) || seedSnapshot.messages.length === 0) {
        return false
      }
      this.contextThreadFactory.applySeedMessages(session as any, seedSnapshot.messages)
      return true
    } catch (error) {
      console.error('Context seed materialization failed', error)
      return false
    }
  }

  private resolvePromptMessage(run: AgentRun): ConversationMessage | null {
    const messages = this.core.getConversationMessages(run.conversationId).filter((item) => {
      const roleMatches =
        item.role === 'user' || (run.triggerKind === 'system_followup' && item.role === 'system')
      return roleMatches && (item.text?.trim() || this.extractImageBlocks(item).length > 0)
    })
    const traceId = String(run.traceId ?? '').trim()
    if (traceId) {
      const traced = messages.find(
        (item) => item.externalMessageId === traceId || item.id === traceId
      )
      if (traced) return traced
    }
    return messages[messages.length - 1] ?? null
  }

  private async buildPromptOptions(
    message: ConversationMessage | null
  ): Promise<Record<string, unknown> | undefined> {
    const images = await Promise.all(
      this.extractImageBlocks(message).map((image) => materializeImageBlockForRuntime(image))
    )
    return this.buildPromptOptionsFromParts({ images })
  }

  private buildPromptOptionsFromParts(input: {
    images?: unknown[]
    streamingBehavior?: 'steer' | 'followUp'
  }): Record<string, unknown> | undefined {
    const images = input.images ?? []
    if (images.length === 0 && !input.streamingBehavior) return undefined
    return {
      ...(images.length > 0 ? { images } : {}),
      ...(input.streamingBehavior ? { streamingBehavior: input.streamingBehavior } : {})
    }
  }

  private extractImageBlocks(message: ConversationMessage | null | undefined): ChatImageBlock[] {
    const content = this.extractPromptMessageContent(message)
    return (content?.blocks ?? []).filter(
      (block): block is ChatImageBlock => block.type === 'image'
    )
  }

  private extractPromptMessageContent(
    message: ConversationMessage | null | undefined
  ): ChatMessageContent | null {
    return this.extractPromptMessageMeta(message).content
  }

  private extractPromptMessageMeta(message: ConversationMessage | null | undefined): {
    content: ChatMessageContent | null
  } {
    const meta = parseLocalThreadMessageMeta(message)
    return {
      content: meta.content
    }
  }

  private async applyCoreConversationSeed(
    session: RuntimeSession,
    conversationId: string,
    currentPromptExternalMessageId?: string | null
  ): Promise<void> {
    const currentId = String(currentPromptExternalMessageId ?? '').trim()
    const seedCandidates = this.core.getConversationMessages(conversationId).filter((message) => {
      if (currentId && (message.externalMessageId === currentId || message.id === currentId))
        return false
      const meta = parseLocalThreadMessageMeta(message)
      if (this.isSystemFollowupSyntheticUserMessage(message, meta.agentRunId)) return false
      if (!meta.includeInAgentContext) return false
      return message.role === 'user' || message.role === 'assistant'
    })
    const seedMessages = (
      await Promise.all(seedCandidates.map((message) => this.toLlmSeedMessage(message)))
    ).filter(Boolean) as any[]

    if (seedMessages.length === 0) return
    this.contextThreadFactory.applySeedMessages(session as any, seedMessages as any)
  }

  private async toLlmSeedMessage(message: ConversationMessage) {
    if (message.role === 'user') {
      const content = this.extractPromptMessageContent(message)
      if (content?.blocks.length) {
        return {
          role: 'user' as const,
          content: await materializeContentBlocksForRuntime(content.blocks)
        }
      }
      const text = message.text?.trim()
      return text ? { role: 'user' as const, content: text } : null
    }

    const text = message.text?.trim()
    if (!text) return null
    return {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text }]
    }
  }

  private async createResourceLoader(
    workspacePath: string,
    threadId: string,
    surface: RuntimeSurfacePlugin,
    conversationId: string,
    agentPluginResources: Pick<
      ResolvedAgentPluginResources,
      'skillPaths' | 'extensionPaths' | 'extensionFactories'
    > = {
      skillPaths: [],
      extensionPaths: [],
      extensionFactories: []
    }
  ): Promise<DefaultResourceLoader> {
    const disabledRaw = getSetting(skillsDisabledKey())
    const disabledSet = new Set<string>()
    if (disabledRaw) {
      try {
        const parsed = JSON.parse(disabledRaw)
        if (Array.isArray(parsed)) {
          for (const value of parsed) if (typeof value === 'string') disabledSet.add(value)
        }
      } catch {
        // ignore malformed settings
      }
    }

    // Phase 3 Memory Injection
    let memoryBlock = ''
    try {
      const knowledgeSettings = getKnowledgeSettings()
      if (!knowledgeSettings.enabled || !knowledgeSettings.autoInjectEnabled) {
        throw new Error('Knowledge injection disabled')
      }

      const messages = this.core.getConversationMessages(conversationId)
      const userMessages = messages.filter((m) => m.role === 'user')
      const lastUserMessage = userMessages[userMessages.length - 1]
      const userQuery = lastUserMessage?.text || ''

      const scheduler = new InjectionScheduler()
      const isFirstMessage = userMessages.length <= 1
      const turnsSinceLast = userMessages.length % 8

      if (
        scheduler.shouldInject({
          isFirstMessage,
          turnsSinceLastInjection: turnsSinceLast === 0 ? 8 : turnsSinceLast,
          userMessage: userQuery
        })
      ) {
        const store = new KnowledgeStore()
        const entityName = workspacePath ? path.basename(workspacePath) : 'user'
        const entityType = workspacePath ? 'project' : 'self'
        const entityId = store.upsertEntity({ type: entityType, canonicalName: entityName })

        const retrieval = new KnowledgeRetrievalService(
          store,
          new OnnxEmbeddingEngine(knowledgeSettings.embeddingModel)
        )
        const injectionService = new KnowledgeInjectionService(
          store,
          retrieval,
          knowledgeSettings.injectionTokenBudget
        )
        const packet = await injectionService.buildPacket(userQuery, entityId)

        if (packet.totalTokens > 0) {
          const renderer = new InjectionRenderer()
          memoryBlock = renderer.render(packet)
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.message === 'Knowledge injection disabled')) {
        console.warn(
          '[knowledge-injection] Failed to construct system prompt injection packet',
          err
        )
      }
    }

    const loader = new DefaultResourceLoader({
      cwd: workspacePath,
      agentDir: this.agentDir,
      settingsManager: this.settingsManager,
      additionalExtensionPaths: agentPluginResources.extensionPaths,
      extensionFactories: agentPluginResources.extensionFactories,
      noSkills: true,
      additionalSkillPaths: (() => {
        const managedGlobalDir = getDefaultSkillsDir()
        ensureSkillsDir(managedGlobalDir)
        return Array.from(
          new Set([
            ...resolveSkillSearchPaths({
              managedSkillsDir: managedGlobalDir,
              extraDirs: readExtraDirs(),
              includeAgentPluginSkills: false
            }),
            ...agentPluginResources.skillPaths
          ])
        )
      })(),
      skillsOverride: (current) => ({
        ...({
          [legacySkillDoctorKey]: Reflect.get(current, legacySkillDoctorKey)
        } as Omit<typeof current, 'skills'>),
        skills: current.skills.map((skill) =>
          disabledSet.has(skill.name) ? { ...skill, disableModelInvocation: true } : skill
        )
      }),
      appendSystemPromptOverride: (base) => {
        const systemPrompt = surface.buildSystemPrompt({
          workspacePath,
          threadId,
          appConfigDir: this.appConfigDir
        })
        const finalPrompt = memoryBlock ? `${systemPrompt}\n\n${memoryBlock}` : systemPrompt
        return [...base, finalPrompt]
      }
    })
    await loader.reload()
    return loader
  }

  private async resolveModel(policy: ExecutionPolicy): Promise<RuntimeModelDefinition> {
    const modelRuntime = await this.ensureModelRuntime()
    const providerId = policy.model.providerId
    const modelId = policy.model.modelId
    const apiKey = getProviderApiKeyByRuntimeProvider(providerId)
    if (apiKey) {
      await modelRuntime.setRuntimeApiKey(providerId, apiKey)
    }

    const providerInfo = getProviderByRuntimeProvider(providerId)
    const defaultProvider = providerInfo ? getDefaultProviderDefinition(providerInfo.id) : null
    const shouldRegisterRuntimeProvider = Boolean(
      providerInfo &&
      apiKey &&
      (shouldRegisterDynamicProvider(providerInfo.id, providerInfo.runtimeProvider) ||
        defaultProvider)
    )
    if (providerInfo && shouldRegisterRuntimeProvider) {
      const settings = parseProviderSettings(providerInfo.settingsJson)
      const normalizedSettings = normalizeProviderSettings({
        providerId: providerInfo.id,
        runtimeProvider: providerInfo.runtimeProvider,
        settings
      })
      const api = resolveRuntimeProviderApi(
        providerInfo.id,
        providerInfo.runtimeProvider,
        normalizedSettings,
        providerInfo.baseUrl
      )
      const xiaomiApiSurface = isXiaomiProviderId(providerInfo.id)
        ? detectXiaomiApiSurfaceFromBaseUrl(providerInfo.baseUrl)
        : null
      const usesXiaomiOpenAI = isXiaomiProviderId(providerInfo.id) && api === 'openai-completions'
      const usesXiaomiAnthropic = xiaomiApiSurface === 'anthropic'
      const compat =
        api === 'openai-completions' ? buildOpenAICompatSettings(normalizedSettings) : undefined
      const xiaomiOpenAICompat = usesXiaomiOpenAI
        ? ({
            ...compat,
            supportsStore: false,
            supportsDeveloperRole: false,
            thinkingFormat: 'deepseek',
            requiresReasoningContentOnAssistantMessages: true
          } as RuntimeProviderModelInput['compat'])
        : undefined
      const models = listProviderModels(providerInfo.id)
      const providerBaseUrl = usesXiaomiOpenAI
        ? normalizeXiaomiOpenAIBaseUrl(
            providerInfo.baseUrl || defaultProvider?.defaultBaseUrl || ''
          )
        : resolveProviderModelBaseUrl(
            providerInfo.id,
            providerInfo.baseUrl,
            settings,
            null,
            defaultProvider?.defaultBaseUrl ?? ''
          )
      const modelDefs: RuntimeProviderModelInput[] = models.map((item) => {
        const raw = asRecord(safeJsonParse(item.rawJson))
        const capabilities = parseModelCapabilitiesJson(item.capabilitiesJson)
        const contextWindow = resolveProviderContextWindowTokens(item)
        const rawApi = asApi(raw?.api)
        const modelApi = usesXiaomiOpenAI
          ? 'openai-completions'
          : usesXiaomiAnthropic
            ? 'anthropic-messages'
            : (rawApi ?? api)
        const modelBaseUrl = usesXiaomiOpenAI
          ? normalizeXiaomiOpenAIBaseUrl(
              providerInfo.baseUrl ||
                (typeof raw?.baseUrl === 'string' ? raw.baseUrl : '') ||
                providerBaseUrl
            )
          : resolveProviderModelBaseUrl(
              providerInfo.id,
              providerInfo.baseUrl,
              settings,
              typeof raw?.baseUrl === 'string' ? raw.baseUrl : null,
              providerBaseUrl
            )
        const resolvedModelBaseUrl = modelBaseUrl || providerBaseUrl
        const finalModelBaseUrl =
          modelApi === 'anthropic-messages'
            ? resolvedModelBaseUrl.replace(/\/v1$/i, '')
            : resolvedModelBaseUrl

        return {
          id: item.modelId,
          name: item.label || item.modelId,
          api: modelApi,
          baseUrl: finalModelBaseUrl,
          reasoning: typeof raw?.reasoning === 'boolean' ? raw.reasoning : capabilities.reasoning,
          thinkingLevelMap: asThinkingLevelMap(raw?.thinkingLevelMap),
          input: resolveStoredModelInput(raw, capabilities.imageInput),
          cost: resolveStoredModelCost(raw),
          contextWindow,
          maxTokens:
            asPositiveNumber(raw?.maxTokens) ?? resolveProviderMaxTokens(item, contextWindow),
          headers: asStringRecord(raw?.headers),
          compat:
            asModelCompat(raw?.compat) ??
            xiaomiOpenAICompat ??
            (modelApi === 'openai-completions'
              ? (compat as RuntimeProviderModelInput['compat'])
              : undefined)
        }
      })
      if (modelDefs.length > 0) {
        const finalProviderBaseUrl =
          api === 'anthropic-messages' ? providerBaseUrl.replace(/\/v1$/i, '') : providerBaseUrl

        modelRuntime.registerProvider(providerId, {
          baseUrl: finalProviderBaseUrl,
          apiKey: apiKey ?? undefined,
          api,
          authHeader: shouldRegisterDynamicProvider(providerInfo.id, providerInfo.runtimeProvider)
            ? true
            : undefined,
          headers:
            shouldRegisterDynamicProvider(providerInfo.id, providerInfo.runtimeProvider) &&
            api === 'anthropic-messages'
              ? { 'anthropic-version': '2023-06-01' }
              : undefined,
          models: modelDefs
        })
      } else if (shouldRegisterDynamicProvider(providerInfo.id, providerInfo.runtimeProvider)) {
        modelRuntime.registerProvider(providerId, {
          baseUrl: providerBaseUrl,
          apiKey: apiKey ?? undefined,
          api,
          authHeader: true,
          headers: api === 'anthropic-messages' ? { 'anthropic-version': '2023-06-01' } : undefined,
          models: modelDefs
        })
      }
    }

    const modelDef = modelRuntime.getModel(providerId, modelId)
    if (!modelDef) throw new Error(`Model ${providerId}::${modelId} not found`)
    return modelDef
  }

  private async buildWorkerRuntimeModelConfig(
    policy: ExecutionPolicy,
    modelDef: RuntimeModelDefinition
  ): Promise<WorkerRuntimeModelConfig> {
    const modelRuntime = await this.ensureModelRuntime()
    const auth = await modelRuntime.getAuth(modelDef)
    return {
      providerId: policy.model.providerId,
      modelId: policy.model.modelId,
      reasoningLevel: policy.model.reasoningLevel ?? null,
      providerConfig: {
        baseUrl: modelDef.baseUrl,
        apiKey: auth?.auth.apiKey,
        api: modelDef.api,
        headers: auth?.auth.headers
          ? Object.fromEntries(
              Object.entries(auth.auth.headers).filter(
                (entry): entry is [string, string] => entry[1] !== null
              )
            )
          : undefined,
        models: [
          {
            id: modelDef.id,
            name: modelDef.name,
            api: modelDef.api,
            baseUrl: modelDef.baseUrl,
            reasoning: modelDef.reasoning,
            thinkingLevelMap: modelDef.thinkingLevelMap,
            input: [...modelDef.input],
            cost: { ...modelDef.cost },
            contextWindow: modelDef.contextWindow,
            maxTokens: modelDef.maxTokens,
            headers: modelDef.headers ? { ...modelDef.headers } : undefined,
            compat: modelDef.compat
          }
        ]
      }
    }
  }

  private applyShellPrefix(): void {
    this.settingsManager.setShellCommandPrefix(
      createPiAgentShellCommandPrefix({
        endpoint: LOCAL_HTTP_BASE_URL,
        nodeExecutable: process.execPath
      })
    )
  }

  private persistRuntimeEvents(conversationId: string, rows: ConversationEventRow[]): void {
    for (const row of rows) {
      const agentRunId = row.agent_run_id
        ? this.resolveCoreRunId(conversationId, row.agent_run_id)
        : null
      const runtimeAgentRunId =
        row.runtime_agent_run_id ??
        (row.agent_run_id && agentRunId && row.agent_run_id !== agentRunId
          ? row.agent_run_id
          : null)
      const aggregateType = agentRunId ? 'agent_run' : 'conversation'
      const aggregateId = agentRunId || conversationId
      this.core.upsertEventLogEntry({
        id: row.id,
        eventType: row.event_type,
        traceId: agentRunId || row.correlation_id || conversationId,
        correlationId: row.correlation_id || row.id,
        aggregateType,
        aggregateId,
        payload: {
          payload: safeJsonParse(row.payload_json),
          runtime: {
            conversationId,
            runtimeAgentRunId,
            coreAgentRunId: agentRunId,
            eventOrigin: row.event_origin,
            raw: safeJsonParse(row.raw_json)
          }
        },
        createdAt: row.created_at
      })
    }
  }

  private async persistFinalizedRun(
    conversationId: string,
    projection: AgentRunProjection
  ): Promise<void> {
    const coreRunId = this.resolveCoreRunId(conversationId, projection.agentRunId)
    const requestedRun =
      this.core.getAgentRun(coreRunId) ?? this.activeRunByConversationId.get(conversationId)
    if (!requestedRun) return
    const nextStatus = mapRuntimeRunStatus(projection.status)
    const currentStatus = this.core.getAgentRun(coreRunId)?.status
    if (currentStatus === 'aborted' && nextStatus !== 'aborted') return

    const mappedProjection = this.mapProjectionRunId(projection, coreRunId)
    this.core.upsertAgentRun({
      id: requestedRun.id,
      conversationId: requestedRun.conversationId,
      instanceId: requestedRun.instanceId ?? null,
      triggerKind: requestedRun.triggerKind,
      requestedExecutionPolicy: requestedRun.requestedExecutionPolicy,
      effectiveExecutionSnapshot: createExecutionSnapshot(
        requestedRun.effectiveExecutionSnapshot,
        new Date(projection.startedAt).toISOString()
      ),
      status: mapRuntimeRunStatus(projection.status),
      traceId: requestedRun.traceId,
      projectionText: mappedProjection.text,
      projectionTurns: mappedProjection.turns,
      startedAt: projection.startedAt,
      endedAt: projection.endedAt ?? null
    })

    const text = mappedProjection.text.trim()
    const scheduledTaskService = getScheduledTaskService()
    const scheduledTask =
      requestedRun.triggerKind === 'automation'
        ? scheduledTaskService.getTaskByAgentRunId(requestedRun.id)
        : null
    const isSilentAutomation =
      requestedRun.triggerKind === 'automation' && text.toUpperCase() === '[SILENT]'
    if (!isSilentAutomation) {
      await this.persistAssistantMessages(requestedRun, mappedProjection)
    }
    if (
      text &&
      !isSilentAutomation &&
      scheduledTask?.deliveryPolicy.mode !== 'silent' &&
      scheduledTask?.deliveryPolicy.mode !== 'thread_only'
    ) {
      new DeliveryCoordinator({ core: this.core }).requestText({
        conversationId: requestedRun.conversationId,
        text
      })
      await this.dispatchPendingDeliveries?.()
    }
    if (requestedRun.triggerKind === 'automation') {
      const runtimeStatus = mapRuntimeRunStatus(mappedProjection.status)
      const runtimeErrorText =
        text || extractFirstTurnError(mappedProjection.turns) || 'Automation run failed'
      scheduledTaskService.markAgentRunFinished({
        agentRunId: requestedRun.id,
        status:
          runtimeStatus === 'finished'
            ? 'succeeded'
            : runtimeStatus === 'aborted'
              ? 'cancelled'
              : 'failed',
        resultSummary: text || null,
        errorText: runtimeStatus === 'finished' ? null : runtimeErrorText,
        endedAt: projection.endedAt ?? null
      })
    }
  }

  private markRunRunning(run: AgentRun): void {
    if (this.abortRequestedConversationIds.has(run.conversationId)) return
    const latest = this.core.getAgentRun(run.id)
    if (latest?.status === 'aborted') return

    this.core.upsertAgentRun({
      id: run.id,
      conversationId: run.conversationId,
      instanceId: run.instanceId ?? null,
      triggerKind: run.triggerKind,
      requestedExecutionPolicy: run.requestedExecutionPolicy,
      effectiveExecutionSnapshot: createExecutionSnapshot(
        run.effectiveExecutionSnapshot,
        run.effectiveExecutionSnapshot.resolvedAt
      ),
      status: 'running',
      traceId: run.traceId,
      startedAt: run.startedAt,
      endedAt: null
    })
    if (run.triggerKind === 'automation') {
      getScheduledTaskService().markAgentRunStarted(run.id)
    }
  }

  private markRunAborted(run: AgentRun, endedAt: string): void {
    this.core.upsertAgentRun({
      id: run.id,
      conversationId: run.conversationId,
      instanceId: run.instanceId ?? null,
      triggerKind: run.triggerKind,
      requestedExecutionPolicy: run.requestedExecutionPolicy,
      effectiveExecutionSnapshot: createExecutionSnapshot(
        run.effectiveExecutionSnapshot,
        run.effectiveExecutionSnapshot.resolvedAt
      ),
      status: 'aborted',
      traceId: run.traceId,
      startedAt: run.startedAt,
      endedAt
    })
    if (run.triggerKind === 'automation') {
      getScheduledTaskService().markAgentRunFinished({
        agentRunId: run.id,
        status: 'cancelled',
        errorText: null,
        endedAt
      })
    }
  }

  private markRunFailed(run: AgentRun, error: unknown): void {
    const errorText = error instanceof Error ? error.message : String(error)
    this.core.upsertAgentRun({
      id: run.id,
      conversationId: run.conversationId,
      instanceId: run.instanceId ?? null,
      triggerKind: run.triggerKind,
      requestedExecutionPolicy: run.requestedExecutionPolicy,
      effectiveExecutionSnapshot: createExecutionSnapshot(
        run.effectiveExecutionSnapshot,
        run.effectiveExecutionSnapshot.resolvedAt
      ),
      status: 'failed',
      traceId: run.traceId,
      projectionText: errorText,
      startedAt: run.startedAt,
      endedAt: new Date().toISOString()
    })
    if (run.triggerKind === 'automation') {
      getScheduledTaskService().markAgentRunFinished({
        agentRunId: run.id,
        status: 'failed',
        errorText,
        endedAt: new Date().toISOString()
      })
    }
  }

  private async persistAssistantMessages(
    requestedRun: AgentRun,
    projection: AgentRunProjection
  ): Promise<void> {
    const conversation = this.core.getConversation(requestedRun.conversationId)
    const binding = conversation?.activeBindingId
      ? this.core.getConversationBinding(conversation.activeBindingId)
      : null
    const isLocalConversation = Boolean(
      binding && deriveConversationSourceKind(binding.transportId) === 'local'
    )

    if (isLocalConversation) {
      const localThreadId =
        this.interactionThreadIdByConversationId.get(requestedRun.conversationId) ??
        binding?.externalChatId ??
        requestedRun.conversationId
      await this.persistLocalAssistantMessages(localThreadId, requestedRun, projection)
      return
    }

    const text = projection.text.trim()
    if (text) {
      this.persistAssistantRunMessage(requestedRun, projection, text)
    }
  }

  private shouldPersistAssistantTurn(turn: AgentTurnProjection): boolean {
    return (
      turn.toolCalls.length > 0 ||
      turn.timelineItems.some(
        (item) =>
          item.kind === 'tool' ||
          item.kind === 'question_answer' ||
          item.kind === 'questionnaire_question' ||
          item.kind === 'questionnaire_answer' ||
          (item.kind === 'text' && item.text.trim().length > 0)
      ) ||
      (turn.status === 'error' && Boolean(turn.errorMessage?.trim()))
    )
  }

  private resolveAssistantTurnCreatedAt(
    run: AgentRunProjection,
    turn: AgentTurnProjection
  ): number {
    if (typeof turn.endedAt === 'number') return turn.endedAt

    let latestTimelineAt: number | undefined
    for (const item of turn.timelineItems) {
      if (item.kind !== 'text' && item.kind !== 'thinking') continue
      const candidate =
        typeof item.endedAt === 'number'
          ? item.endedAt
          : typeof item.startedAt === 'number'
            ? item.startedAt
            : undefined
      if (candidate == null) continue
      latestTimelineAt =
        latestTimelineAt == null ? candidate : Math.max(latestTimelineAt, candidate)
    }

    if (latestTimelineAt != null) return latestTimelineAt
    if (typeof turn.startedAt === 'number') return turn.startedAt
    if (typeof run.endedAt === 'number') return run.endedAt
    return run.startedAt
  }

  private async persistLocalAssistantMessages(
    threadId: string,
    requestedRun: AgentRun,
    projection: AgentRunProjection
  ): Promise<void> {
    const host = await getLocalThreadHostService()

    let persistedTurnMessage = false
    for (const turn of projection.turns) {
      if (!this.shouldPersistAssistantTurn(turn)) continue
      const content = turn.text || (turn.status === 'error' ? turn.errorMessage?.trim() || '' : '')
      const contentJson: ChatMessageContent | null = content
        ? {
            version: 1,
            blocks: [{ type: 'text', text: content }]
          }
        : null
      host.addMessage(threadId, 'assistant', content, requestedRun.id, contentJson, {
        includeInAgentContext: requestedRun.triggerKind === 'automation' ? false : undefined,
        agentTurnId: turn.agentTurnId ?? null,
        createdAt: this.resolveAssistantTurnCreatedAt(projection, turn)
      })
      persistedTurnMessage = true
    }

    if (persistedTurnMessage) return

    const text = projection.text.trim()
    if (!text) return
    host.addMessage(
      threadId,
      'assistant',
      text,
      requestedRun.id,
      {
        version: 1,
        blocks: [{ type: 'text', text }]
      },
      {
        includeInAgentContext: requestedRun.triggerKind === 'automation' ? false : undefined,
        createdAt: projection.endedAt ?? projection.startedAt
      }
    )
  }

  private persistAssistantRunMessage(
    requestedRun: AgentRun,
    projection: AgentRunProjection,
    text: string
  ): void {
    const conversation = this.core.getConversation(requestedRun.conversationId)
    const contentJson: ChatMessageContent = {
      version: 1,
      blocks: [{ type: 'text', text }]
    }
    this.core.upsertConversationMessage({
      conversationId: requestedRun.conversationId,
      bindingId: conversation?.activeBindingId ?? null,
      externalMessageId: `agent-run:${requestedRun.id}:final`,
      role: 'assistant',
      direction: 'outbound',
      text,
      payload: {
        legacy: {
          source: 'coding-agent-runtime-bridge',
          messageKind: 'chat',
          includeInAgentContext: true,
          agentRunId: requestedRun.id,
          agentEntryId: null,
          agentTurnId: null,
          toolCallId: null,
          stepIndex: null,
          runtimeSequence: null,
          contentJson: safeJsonStringify(contentJson)
        },
        runtime: {
          projectionRunId: projection.agentRunId
        }
      },
      createdAt: projection.endedAt ?? Date.now()
    })
  }

  private mapAppEventRunId(conversationId: string, event: AgentAppEvent): AgentAppEvent | null {
    // Defensive fallback: RuntimeAdapter should canonicalize run ids before
    // RuntimeEventStore/RunProjector see the event.
    const eventRunId = 'agentRunId' in event ? event.agentRunId : null
    if (!eventRunId) return event
    const coreRunId = this.resolveCoreRunId(conversationId, eventRunId)
    if (this.shouldSuppressAbortedRunAppEvent(coreRunId, event)) return null
    if (this.shouldSuppressSystemFollowupUserAppEvent(coreRunId, event)) return null

    const injectTriggerKind = (run: any) => {
      const mainRun = this.core.getAgentRun(coreRunId)
      if (mainRun && run) {
        run.triggerKind = mainRun.triggerKind
      }
    }

    if (coreRunId === eventRunId) {
      injectTriggerKind((event as any).run)
      return event
    }

    const mapped = {
      ...(event as any),
      agentRunId: coreRunId
    }
    if (mapped.run) {
      mapped.run = this.mapProjectionRunId(mapped.run, coreRunId)
      injectTriggerKind(mapped.run)
    }
    return mapped as AgentAppEvent
  }

  private shouldSuppressAbortedRunAppEvent(coreRunId: string, event: AgentAppEvent): boolean {
    if (event.type === 'agent.run.aborted') return false
    return this.core.getAgentRun(coreRunId)?.status === 'aborted'
  }

  private shouldSuppressSystemFollowupUserAppEvent(
    coreRunId: string,
    event: AgentAppEvent
  ): boolean {
    if (!this.isSystemFollowupRun(coreRunId)) return false
    if (event.type !== 'agent.message.started' && event.type !== 'agent.message.finished') {
      return false
    }
    const message = (event as any).message
    return message?.role === 'user'
  }

  private isSystemFollowupRun(coreRunId: string): boolean {
    return this.core.getAgentRun(coreRunId)?.triggerKind === 'system_followup'
  }

  private isSystemFollowupSyntheticUserMessage(
    message: ConversationMessage,
    runId?: string | null
  ): boolean {
    const normalizedRunId = String(runId ?? '').trim()
    if (!normalizedRunId || message.role !== 'user') return false
    if (!isSystemFollowupSyntheticPromptText(message.text)) return false
    return this.isSystemFollowupRun(normalizedRunId)
  }

  private mapProjectionRunId(
    projection: AgentRunProjection,
    coreRunId: string
  ): AgentRunProjection {
    return projection.agentRunId === coreRunId
      ? projection
      : { ...projection, agentRunId: coreRunId }
  }

  private enqueueQueuedRun(conversationId: string, run: AgentRun): void {
    const existing = this.queuedRunsByConversationId.get(conversationId) ?? []
    existing.push(run)
    this.queuedRunsByConversationId.set(conversationId, existing)
  }

  private removeQueuedRun(conversationId: string, runId: string): void {
    const existing = this.queuedRunsByConversationId.get(conversationId)
    if (!existing) return
    const next = existing.filter((run) => run.id !== runId)
    if (next.length > 0) this.queuedRunsByConversationId.set(conversationId, next)
    else this.queuedRunsByConversationId.delete(conversationId)
  }

  private takeQueuedRunForRuntimeEvent(conversationId: string): AgentRun | null {
    const queuedRuns = this.queuedRunsByConversationId.get(conversationId)
    if (!queuedRuns || queuedRuns.length === 0) return null

    const activeRun = this.activeRunByConversationId.get(conversationId)
    if (activeRun) return null

    const run = queuedRuns.shift() ?? null
    if (queuedRuns.length === 0) this.queuedRunsByConversationId.delete(conversationId)
    return run
  }

  private resolveCoreRunId(conversationId: string, runtimeRunId: string): string {
    const existing = this.runtimeRunIdToCoreRunId.get(runtimeRunId)
    if (existing) return existing
    const queuedRun = this.takeQueuedRunForRuntimeEvent(conversationId)
    if (queuedRun) {
      this.runtimeRunIdToCoreRunId.set(runtimeRunId, queuedRun.id)
      return queuedRun.id
    }
    const activeRun = this.activeRunByConversationId.get(conversationId)
    if (!activeRun) return runtimeRunId
    this.runtimeRunIdToCoreRunId.set(runtimeRunId, activeRun.id)
    return activeRun.id
  }

  private disposeSession(session: HeadlessRuntimeSession): void {
    try {
      session.unsubscribe()
    } catch {
      // ignore
    }
    try {
      session.runtimeAdapter.dispose()
    } catch {
      // ignore
    }
    try {
      session.session.dispose()
    } catch {
      // ignore
    }
  }
}

/**
 * Extract the first meaningful error message from projection turns
 * when the main projection text is empty (e.g. API errors during model inference).
 */
function extractFirstTurnError(turns: AgentTurnProjection[]): string | null {
  for (const turn of turns) {
    if (turn.errorMessage) {
      try {
        const parsed = JSON.parse(turn.errorMessage)
        const inner = parsed.error?.message
        if (inner) return inner
        const outer = parsed.message
        if (outer) return outer
      } catch {
        // not JSON, use raw
      }
      return turn.errorMessage
    }
  }
  return null
}
