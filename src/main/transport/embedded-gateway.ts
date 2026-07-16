import type { ChatImageBlock } from '../../shared/chat-content.ts'
import type { QuestionAnswerPayload } from '../../shared/question-tool.ts'
import type { QuestionnaireAnswerPayload } from '../../shared/questionnaire-tool.ts'
import type { SecretAnswerPayload } from '../../shared/secret-input.ts'
import type {
  InstalledTransportPlugin,
  SaveTransportPluginAccountInput,
  SetTransportPluginEnabledInput,
  StartTransportPluginAccountSetupInput,
  TestTransportPluginAccountInput,
  TestTransportPluginAccountResult,
  TransportPluginAccount,
  TransportPluginAccountSetupEvent,
  TransportPluginAccountSetupMethod,
  TransportPluginAccountSetupStartResult,
  TransportPluginSettingsSchema,
  TransportPluginValidationStatus
} from '../../shared/transport-plugins.ts'
import type {
  Conversation,
  ConversationBinding,
  ConversationBindingTarget,
  ConversationChannelKind,
  CoreCommandService,
  CoreQueryService,
  AgentRun,
  InboundEnvelope,
  ResolveConversationForEnvelopeResult
} from '../core-v2/domain.ts'
import type {
  ClaimedAgentRunProjectionTransportSetupQrModelNotification,
  TransportSetupQrModelNotificationStatus,
  UpdateAgentRunProjectionTransportSetupQrInput
} from '../core-v2/agent-run-projections.ts'
import { ensureDefaultAgentProfile } from '../core-v2/default-agent-profile.ts'
import {
  deriveBindingRoutingKeyFromTarget,
  deriveConversationSourceKind
} from '../core-v2/domain.ts'
import { buildLocalThreadRoutingKey } from '../core-v2/local-thread-binding.ts'
import { getCoreV2Service } from '../core-v2/sqlite-db.ts'
import { listProviderModels, listProviders } from '../db/config-db.ts'
import { ImRuntimeCoordinator } from '../im/im-runtime-coordinator.ts'
import type { ImModelCatalog } from '../im/im-command-router.ts'
import { sanitizeForLog } from '../logging/redaction.ts'
import { getTransportPluginConfigService } from '../plugin-system/transport-plugin-config-service-singleton.ts'
import { type TransportPluginConfigService } from '../plugin-system/transport-plugin-config-service.ts'
import { getLocalRuntimeHostService } from '../runtime-host/local-runtime-host.ts'
import { AgentInstanceManager } from '../runtime-host/agent-instance-manager.ts'
import { RunScheduler, type RunScheduleDecision } from '../runtime-host/run-scheduler.ts'
import {
  desktopChatTransportModule,
  DESKTOP_CHAT_TRANSPORT_ACCOUNT_ID,
  DESKTOP_CHAT_TRANSPORT_ID
} from './builtin/desktop-chat-transport.ts'
import { InboundRouter, type InboundRouteResult } from './inbound-router.ts'
import { OutboundDispatcher, type DispatchDeliveryResult } from './outbound-dispatcher.ts'
import { TransportHost, type TransportHostStatus } from './transport-host.ts'
import type { PluginManifest, PluginRegistration } from '../plugin-system/plugin-types.ts'
import type { TransportPlugin, TransportTargetEntry } from './transport-contract.ts'

const IM_TYPING_REFRESH_MS = 4000

type EmbeddedGatewayCore = CoreCommandService &
  CoreQueryService & {
    updateAgentRunProjectionTransportSetupQr?(
      input: UpdateAgentRunProjectionTransportSetupQrInput
    ): number
    claimAgentRunProjectionTransportSetupQrModelNotification?(input: {
      sessionId: string
      status: TransportSetupQrModelNotificationStatus
      transportId?: string | null
      accountId?: string | null
      methodId?: string | null
      updatedAt?: string | number | Date | null
    }): ClaimedAgentRunProjectionTransportSetupQrModelNotification[]
  }

type EmbeddedGatewayDeps = {
  core: EmbeddedGatewayCore
  transportHost?: TransportHost
  transportPluginConfigService: TransportPluginConfigService
  externalPluginDirectories?: string[]
  modelCatalog?: ImModelCatalog
  runScheduler?: RunScheduler
  runExecutor?: {
    start(run: AgentRun): Promise<void>
    queueStreamingPrompt?(input: {
      conversationId: string
      threadId: string
      text: string
      messageId?: string | null
      streamingBehavior: 'steer'
      images?: ChatImageBlock[]
    }): boolean
    stopConversation?(conversationId: string): Promise<void>
    stopAll?(): Promise<void>
    answerQuestion?(
      threadId: string,
      payload: QuestionAnswerPayload
    ): Promise<{ success: true } | { success: false; error: string }>
    answerQuestionnaire?(
      threadId: string,
      payload: QuestionnaireAnswerPayload
    ): Promise<{ success: true } | { success: false; error: string }>
    answerSecret?(
      threadId: string,
      payload: SecretAnswerPayload
    ): Promise<{ success: true } | { success: false; error: string }>
  }
  resolveAgentProfileId?: () => string
}

export type EmbeddedGatewayInboundResult = InboundRouteResult & {
  scheduleDecision?: RunScheduleDecision | null
}

export type SubmitDesktopLocalMessageInput = {
  threadId: string
  text: string
  messageId?: string | null
  receivedAt?: string | number | Date | null
  images?: ChatImageBlock[]
  streamingBehavior?: 'steer' | 'followUp'
}

export type EmbeddedGatewayRuntimeQueuedResult = {
  action: 'runtime_queued'
  conversationId: string
  binding: ConversationBinding
  message: null
  run: null
  scheduleDecision: null
  delivery: 'steer'
}

export type EmbeddedGatewayLocalSubmitResult =
  | EmbeddedGatewayInboundResult
  | EmbeddedGatewayRuntimeQueuedResult

export type ImTransportAccountInfo = {
  accountId: string
  enabled: boolean
  validationStatus: TransportPluginAccount['validationStatus']
  lastValidatedAt: string | null
  validationError: string | null
  runtimeState: string | null
  runtimeError: string | null
  runtimeErrorCode: string | null
  capabilities?: Awaited<ReturnType<TransportHost['getCapabilities']>> | null
}

export type ImTransportInfo = {
  transportId: string
  displayName: string
  description?: string
  version: string
  sourceKind: PluginRegistration<TransportPlugin>['sourceKind']
  state: PluginRegistration<TransportPlugin>['state']
  error?: string | null
  enabled: boolean
  configurable: boolean
  settingsSchema?: TransportPluginSettingsSchema
  accounts: ImTransportAccountInfo[]
}

type TransportAccountSetupSession = {
  pluginId: string
  accountId: string
  methodId: string
  validateAfterSave: boolean
}

const serializeTransportAccountSetupEventForLog = (
  event: TransportPluginAccountSetupEvent
): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    type: event.type,
    pluginId: event.pluginId,
    accountId: event.accountId,
    methodId: event.methodId,
    sessionId: event.sessionId
  }

  if (event.type === 'qr') {
    base.expiresAt = event.expiresAt
    return base
  }

  if (event.type === 'status') {
    base.state = event.state
    if (event.message) base.message = event.message
    return base
  }

  if (event.type === 'expired') {
    if (event.reason) base.reason = event.reason
    return base
  }

  if (event.type === 'failed') {
    base.retryable = event.retryable
    base.error = event.error
  }

  return base
}

const mapTransportAccountSetupEventToQrStatus = (
  event: TransportPluginAccountSetupEvent
): UpdateAgentRunProjectionTransportSetupQrInput['status'] | null => {
  if (event.type === 'qr') return 'active'
  if (event.type === 'completed') return 'completed'
  if (event.type === 'expired') return 'expired'
  if (event.type === 'failed') return 'failed'

  if (event.state === 'waiting_scan') return 'active'
  if (event.state === 'scanned' || event.state === 'waiting_confirm') return 'scanned'
  if (
    event.state === 'completed' ||
    event.state === 'expired' ||
    event.state === 'cancelled' ||
    event.state === 'failed'
  ) {
    return event.state
  }
  return null
}

const mapTransportAccountSetupEventToModelNotificationStatus = (
  event: TransportPluginAccountSetupEvent
): TransportSetupQrModelNotificationStatus | null => {
  const status = mapTransportAccountSetupEventToQrStatus(event)
  if (
    status === 'completed' ||
    status === 'expired' ||
    status === 'cancelled' ||
    status === 'failed'
  ) {
    return status
  }
  return null
}

const buildTransportAccountSetupSystemEventText = (
  event: TransportPluginAccountSetupEvent,
  claim: ClaimedAgentRunProjectionTransportSetupQrModelNotification
): string => {
  const transportLabel = event.pluginId === 'wechat' ? 'WeChat' : event.pluginId || 'Transport'
  const header = [
    '[System event]',
    `${transportLabel} account setup session ${claim.sessionId} is ${claim.status}.`,
    `transportId=${event.pluginId ?? claim.transportId ?? ''}`,
    `accountId=${event.accountId ?? claim.accountId ?? ''}`,
    `methodId=${event.methodId ?? claim.methodId ?? ''}`
  ]
    .filter(Boolean)
    .join('\n')

  if (claim.status === 'completed') {
    return [
      header,
      'Tell the user the account connection succeeded and they can continue.',
      'Do not ask the user to scan again.'
    ].join('\n')
  }

  if (claim.status === 'expired') {
    return [
      header,
      'Tell the user the QR code expired.',
      'Ask whether they want to generate a new QR code.',
      'If they agree, call imTool setup_account again with the same transport, account, and setup method.'
    ].join('\n')
  }

  if (claim.status === 'failed') {
    const reason =
      'error' in event && typeof event.error === 'string' && event.error.trim()
        ? event.error.trim()
        : 'unknown error'
    return [
      header,
      `The setup failed: ${reason}.`,
      'Briefly tell the user setup failed and ask whether they want to try again.'
    ].join('\n')
  }

  return [
    header,
    'Tell the user the account setup was cancelled.',
    'Ask whether they want to try again only if continuing setup still makes sense.'
  ].join('\n')
}

export type ImKnownRoute = ConversationBindingTarget & {
  routingKey: string
  source: 'binding' | 'plugin'
  bindingId?: string | null
  conversationId?: string | null
  conversationTitle?: string | null
  title: string
  description?: string
  activeOnConversation: boolean
}

export type ListImTargetsInput = {
  transportId?: string | null
  accountId?: string | null
  query?: string | null
  limit?: number | null
  channelKind?: ConversationChannelKind | null
}

export type SendImMessageInput = {
  text: string
  conversationId?: string | null
  bindingId?: string | null
  transportId?: string | null
  accountId?: string | null
  externalChatId?: string | null
  externalThreadId?: string | null
  externalUserId?: string | null
  channelKind?: ConversationChannelKind | null
  title?: string | null
  setAsActiveRoute?: boolean
}

export type SendImMessageResult = {
  conversation: Conversation
  binding: ConversationBinding
  delivery: import('../core-v2/domain.ts').DeliveryRecord
  dispatch: DispatchDeliveryResult
}

export type AttachImRouteInput = {
  conversationId: string
  transportId: string
  accountId: string
  externalChatId: string
  externalThreadId?: string | null
  externalUserId?: string | null
  channelKind?: ConversationChannelKind | null
  title?: string | null
  setAsActiveRoute?: boolean
}

export class EmbeddedGatewayService {
  private readonly core: EmbeddedGatewayCore
  private readonly transportHost: TransportHost
  private readonly transportPluginConfigService: TransportPluginConfigService
  private readonly externalPluginDirectories?: string[]
  private readonly inboundRouter: InboundRouter
  private readonly imRuntimeCoordinator: ImRuntimeCoordinator
  private readonly outboundDispatcher: OutboundDispatcher
  private readonly runScheduler: RunScheduler
  private readonly runExecutor?: NonNullable<EmbeddedGatewayDeps['runExecutor']>
  private readonly resolveAgentProfileId: () => string
  private readonly transportAccountSetupHandlers = new Set<
    (event: TransportPluginAccountSetupEvent) => Promise<void> | void
  >()
  private readonly transportAccountSetupSessions = new Map<string, TransportAccountSetupSession>()
  private started = false
  private builtinDiscovered = false
  private unsubscribeInbound: (() => void) | null = null

  constructor(deps: EmbeddedGatewayDeps) {
    this.core = deps.core
    this.transportPluginConfigService = deps.transportPluginConfigService
    this.transportHost =
      deps.transportHost ??
      new TransportHost({
        getAccountConfig: (manifest, accountId) =>
          this.transportPluginConfigService.getRuntimeAccountConfig(manifest, accountId)
      })
    this.externalPluginDirectories = deps.externalPluginDirectories
    this.resolveAgentProfileId =
      deps.resolveAgentProfileId ?? (() => ensureDefaultAgentProfile(this.core).id)
    this.runScheduler =
      deps.runScheduler ??
      new RunScheduler({ instanceManager: new AgentInstanceManager({ core: this.core }) })
    this.imRuntimeCoordinator = new ImRuntimeCoordinator({
      core: this.core,
      runScheduler: this.runScheduler,
      resolveAgentProfileId: this.resolveAgentProfileId,
      modelCatalog: deps.modelCatalog
    })
    this.inboundRouter = new InboundRouter({
      core: this.core,
      resolveAgentProfileId: this.resolveAgentProfileId,
      imRuntimeCoordinator: this.imRuntimeCoordinator
    })
    this.outboundDispatcher = new OutboundDispatcher({
      core: this.core,
      transportHost: this.transportHost
    })
    this.runExecutor = deps.runExecutor
    this.transportHost.onAccountSetupEvent((event) => {
      void this.handleTransportAccountSetupEvent(event)
    })
  }

  async start(): Promise<void> {
    if (this.started) return
    await this.ensureTransportsDiscovered()
    await this.transportHost.activateAll()
    await this.transportHost.connect(DESKTOP_CHAT_TRANSPORT_ID, DESKTOP_CHAT_TRANSPORT_ACCOUNT_ID)
    const seenAutoConnectTargets = new Set<string>()
    for (const registration of this.transportHost.listRegistrations()) {
      for (const accountId of this.transportPluginConfigService.resolveStartupAccountIds(
        registration.manifest
      )) {
        const target = {
          transportId: registration.manifest.id,
          accountId
        }
        const dedupeKey = `${target.transportId}:${target.accountId}`
        if (seenAutoConnectTargets.has(dedupeKey)) continue
        seenAutoConnectTargets.add(dedupeKey)

        if (
          target.transportId === DESKTOP_CHAT_TRANSPORT_ID &&
          target.accountId === DESKTOP_CHAT_TRANSPORT_ACCOUNT_ID
        ) {
          continue
        }
        try {
          await this.transportHost.connect(target.transportId, target.accountId)
        } catch (error) {
          console.error(
            `Start transport failed for ${target.transportId}:${target.accountId}`,
            sanitizeForLog(error)
          )
        }
      }
    }
    this.unsubscribeInbound = this.transportHost.onInbound(async (envelope) => {
      const result = this.ingestInbound(envelope)
      if (result.action === 'command_handled' || result.action === 'interaction_handled') {
        await this.dispatchPendingDeliveries()
      }
    })
    this.started = true
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.unsubscribeInbound?.()
    this.unsubscribeInbound = null
    this.transportAccountSetupSessions.clear()
    await this.transportHost.shutdown()
    await this.runExecutor?.stopAll?.()
    this.started = false
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  ingestInbound(envelope: InboundEnvelope): EmbeddedGatewayInboundResult {
    return this.routeAndSchedule(envelope, { appendInboundMessage: true })
  }

  submitDesktopLocalMessage(
    input: SubmitDesktopLocalMessageInput
  ): EmbeddedGatewayLocalSubmitResult {
    const threadId = String(input.threadId ?? '').trim()
    if (!threadId) throw new Error('threadId is required')
    const text = String(input.text ?? '')
      .replace(/\r\n/g, '\n')
      .trim()
    if (!text && (input.images?.length ?? 0) === 0)
      throw new Error('message text or image is required')

    const externalMessageId =
      String(input.messageId ?? '').trim() || `desktop-local:${threadId}:${Date.now()}`
    const receivedAt = this.normalizeReceivedAt(input.receivedAt)
    const envelope: InboundEnvelope = {
      envelopeId: externalMessageId,
      transportId: DESKTOP_CHAT_TRANSPORT_ID,
      transportAccountId: DESKTOP_CHAT_TRANSPORT_ACCOUNT_ID,
      externalMessageId,
      externalChatId: threadId,
      externalUserId: 'desktop-user',
      externalUserDisplayName: 'Desktop',
      channelKind: 'dm',
      receivedAt,
      text,
      routingKey: buildLocalThreadRoutingKey(threadId)
    }

    const queued = this.tryQueueDesktopSteeringPrompt(envelope, {
      threadId,
      text,
      images: input.images ?? [],
      streamingBehavior: input.streamingBehavior
    })
    if (queued) return queued

    return this.routeAndSchedule(envelope, { appendInboundMessage: false })
  }

  private tryQueueDesktopSteeringPrompt(
    envelope: InboundEnvelope,
    input: {
      threadId: string
      text: string
      images: ChatImageBlock[]
      streamingBehavior?: SubmitDesktopLocalMessageInput['streamingBehavior']
    }
  ): EmbeddedGatewayRuntimeQueuedResult | null {
    if (input.streamingBehavior !== 'steer') return null
    if (!this.runExecutor?.queueStreamingPrompt) return null

    const resolved = this.core.resolveConversationForEnvelope({
      agentProfileId: this.resolveAgentProfileId(),
      envelope,
      title: envelope.externalUserDisplayName ?? envelope.externalChatId,
      desktopVisibilityMode: 'read_write'
    })
    const hasPersistedLocalMessage = this.core
      .getConversationMessages(resolved.conversation.id)
      .some((item) => String(item.externalMessageId ?? '').trim() === envelope.externalMessageId)
    if (!hasPersistedLocalMessage) return null

    const accepted = this.runExecutor.queueStreamingPrompt({
      conversationId: resolved.conversation.id,
      threadId: input.threadId,
      text: input.text,
      messageId: envelope.externalMessageId,
      streamingBehavior: 'steer',
      images: input.images.map((image) => ({ ...image }))
    })
    if (!accepted) return null

    return {
      action: 'runtime_queued',
      conversationId: resolved.conversation.id,
      binding: resolved.binding,
      message: null,
      run: null,
      scheduleDecision: null,
      delivery: 'steer'
    }
  }

  async resetDesktopLocalConversation(threadId: string): Promise<void> {
    await this.runExecutor?.stopConversation?.(String(threadId ?? '').trim())
  }

  async answerDesktopQuestion(
    threadId: string,
    payload: QuestionAnswerPayload
  ): Promise<{ success: true } | { success: false; error: string }> {
    if (!this.runExecutor?.answerQuestion) {
      return { success: false, error: 'Runtime interaction executor is not available' }
    }
    return this.runExecutor.answerQuestion(String(threadId ?? '').trim(), payload)
  }

  async answerDesktopQuestionnaire(
    threadId: string,
    payload: QuestionnaireAnswerPayload
  ): Promise<{ success: true } | { success: false; error: string }> {
    if (!this.runExecutor?.answerQuestionnaire) {
      return { success: false, error: 'Runtime interaction executor is not available' }
    }
    return this.runExecutor.answerQuestionnaire(String(threadId ?? '').trim(), payload)
  }

  async answerDesktopSecret(
    threadId: string,
    payload: SecretAnswerPayload
  ): Promise<{ success: true } | { success: false; error: string }> {
    if (!this.runExecutor?.answerSecret) {
      return { success: false, error: 'Runtime interaction executor is not available' }
    }
    return this.runExecutor.answerSecret(String(threadId ?? '').trim(), payload)
  }

  private routeAndSchedule(
    envelope: InboundEnvelope,
    options: { appendInboundMessage: boolean }
  ): EmbeddedGatewayInboundResult {
    const routed = this.inboundRouter.handleEnvelope(envelope, options)
    if (!routed.run) return routed
    const scheduleDecision = routed.scheduleDecision ?? this.runScheduler.schedule(routed.run)
    this.startScheduledRun(scheduleDecision)
    return {
      ...routed,
      scheduleDecision
    }
  }

  async dispatchPendingDeliveries(): Promise<DispatchDeliveryResult[]> {
    return await this.outboundDispatcher.dispatchPending()
  }

  listTransportStatuses(): TransportHostStatus[] {
    return this.transportHost.listStatuses()
  }

  getTransportHost(): TransportHost {
    return this.transportHost
  }

  async listImTransports(): Promise<ImTransportInfo[]> {
    await this.ensureTransportsDiscovered()

    const results: ImTransportInfo[] = []
    for (const registration of this.transportHost.listRegistrations()) {
      if (deriveConversationSourceKind(registration.manifest.id) !== 'im') continue

      const settingsSchema = registration.manifest.contributes?.settings
      const configuredAccounts = settingsSchema
        ? this.transportPluginConfigService.listAccounts(registration.manifest.id, settingsSchema)
        : []
      const runtimeStatuses = this.transportHost.getAccountStatuses(registration.manifest.id)
      const accountIds = new Set<string>([
        ...configuredAccounts.map((account) => account.accountId),
        ...runtimeStatuses.map((status) => status.accountId)
      ])

      const accounts: ImTransportAccountInfo[] = []
      for (const accountId of accountIds) {
        const configured =
          configuredAccounts.find((account) => account.accountId === accountId) ?? null
        const runtime = runtimeStatuses.find((status) => status.accountId === accountId) ?? null
        let capabilities: ImTransportAccountInfo['capabilities'] = null
        if (registration.state === 'activated') {
          try {
            capabilities = await this.transportHost.getCapabilities(
              registration.manifest.id,
              accountId
            )
          } catch {
            capabilities = null
          }
        }
        accounts.push({
          accountId,
          enabled: configured?.enabled ?? runtime?.state === 'connected',
          validationStatus: configured?.validationStatus ?? 'unknown',
          lastValidatedAt: configured?.lastValidatedAt ?? null,
          validationError: configured?.validationError ?? null,
          runtimeState: runtime?.state ?? null,
          runtimeError: runtime?.error ?? null,
          runtimeErrorCode: runtime?.errorCode ?? null,
          capabilities
        })
      }

      results.push({
        transportId: registration.manifest.id,
        displayName: registration.manifest.displayName,
        description: registration.manifest.description,
        version: registration.manifest.version,
        sourceKind: registration.sourceKind,
        state: registration.state,
        error: registration.error ?? null,
        enabled: settingsSchema
          ? this.transportPluginConfigService.isTransportPluginEnabled(registration.manifest)
          : registration.state === 'activated',
        configurable: Boolean(settingsSchema),
        settingsSchema,
        accounts
      })
    }

    return results
  }

  async listImTargets(input: ListImTargetsInput = {}): Promise<ImKnownRoute[]> {
    await this.ensureTransportsDiscovered()

    const normalizedLimit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50), 200))
    const normalizedQuery = String(input.query ?? '')
      .trim()
      .toLowerCase()
    const bindings = this.core
      .listConversationBindings({
        transportId: input.transportId ?? null,
        transportAccountId: input.accountId ?? null
      })
      .filter((binding) => deriveConversationSourceKind(binding.transportId) === 'im')
      .map((binding) => {
        const conversation = this.core.getConversation(binding.conversationId)
        return {
          transportId: binding.transportId,
          transportAccountId: binding.transportAccountId,
          externalChatId: binding.externalChatId,
          externalThreadId: binding.externalThreadId ?? null,
          externalUserId: binding.externalUserId ?? null,
          channelKind: binding.channelKind,
          routingKey: binding.routingKey,
          source: 'binding' as const,
          bindingId: binding.id,
          conversationId: binding.conversationId,
          conversationTitle: conversation?.title ?? null,
          title:
            conversation?.title ??
            binding.externalUserId ??
            binding.externalThreadId ??
            binding.externalChatId,
          description: `${binding.transportId}:${binding.transportAccountId}`,
          activeOnConversation: conversation?.activeBindingId === binding.id
        } satisfies ImKnownRoute
      })

    let pluginTargets: ImKnownRoute[] = []
    if (input.transportId && input.accountId) {
      try {
        await this.transportHost.activate(input.transportId)
        const targets = await this.transportHost.listTargets(input.transportId, {
          accountId: input.accountId,
          query: input.query ?? null,
          limit: normalizedLimit,
          channelKind: input.channelKind ?? null
        })
        pluginTargets = targets.map((target: TransportTargetEntry) => ({
          ...target,
          routingKey: deriveBindingRoutingKeyFromTarget(target),
          source: 'plugin',
          bindingId: null,
          conversationId: null,
          conversationTitle: null,
          activeOnConversation: false
        }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? 'Unknown error')
        throw new Error(
          `IM target lookup failed for ${input.transportId}:${input.accountId}: ${message}`,
          { cause: error }
        )
      }
    }

    const deduped = new Map<string, ImKnownRoute>()
    for (const item of [...bindings, ...pluginTargets]) {
      if (input.channelKind && item.channelKind !== input.channelKind) continue
      if (normalizedQuery) {
        const haystack = [
          item.title,
          item.description,
          item.externalChatId,
          item.externalThreadId,
          item.externalUserId,
          item.transportId,
          item.transportAccountId
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(normalizedQuery)) continue
      }
      const existing = deduped.get(item.routingKey)
      if (!existing || existing.source === 'plugin') deduped.set(item.routingKey, item)
    }

    return [...deduped.values()].slice(0, normalizedLimit)
  }

  async attachImRoute(input: AttachImRouteInput): Promise<ResolveConversationForEnvelopeResult> {
    const conversation = this.core.getConversation(String(input.conversationId ?? '').trim())
    if (!conversation)
      throw new Error(`Unknown Conversation: ${String(input.conversationId ?? '')}`)
    if (deriveConversationSourceKind(input.transportId) !== 'im') {
      throw new Error(`Transport ${input.transportId} is not an IM transport`)
    }
    const registration = await this.findTransportRegistration(input.transportId)
    if (!registration) throw new Error(`Unknown transport plugin: ${input.transportId}`)

    return this.core.resolveConversationForTarget({
      agentProfileId: conversation.agentProfileId,
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId ?? null,
      title: input.title ?? conversation.title ?? null,
      desktopVisibilityMode: conversation.desktopVisibilityMode,
      executionOverride: conversation.executionOverride ?? null,
      setAsActiveBinding: Boolean(input.setAsActiveRoute),
      target: {
        transportId: input.transportId,
        transportAccountId: input.accountId,
        externalChatId: input.externalChatId,
        externalThreadId: input.externalThreadId ?? null,
        externalUserId: input.externalUserId ?? null,
        channelKind: input.channelKind ?? 'dm'
      }
    })
  }

  setActiveConversationRoute(conversationId: string, bindingId: string): Conversation {
    const conversation = this.core.getConversation(String(conversationId ?? '').trim())
    if (!conversation) throw new Error(`Unknown Conversation: ${String(conversationId ?? '')}`)
    const binding = this.core.getConversationBinding(String(bindingId ?? '').trim())
    if (!binding) throw new Error(`Unknown Binding: ${String(bindingId ?? '')}`)
    if (binding.conversationId !== conversation.id) {
      throw new Error(`Binding ${binding.id} does not belong to conversation ${conversation.id}`)
    }
    return this.core.updateConversation({
      conversationId: conversation.id,
      activeBindingId: binding.id
    })
  }

  async connectTransportAccount(input: {
    transportId: string
    accountId: string
    validate?: boolean
  }): Promise<TransportPluginAccount> {
    const transportId = String(input.transportId ?? '').trim()
    const accountId = String(input.accountId ?? '').trim()
    if (!transportId) throw new Error('transportId is required')
    if (!accountId) throw new Error('accountId is required')

    const existing = await this.getTransportAccount(transportId, accountId)
    if (!existing) throw new Error(`Transport account not found: ${transportId}:${accountId}`)

    if (!existing.enabled) {
      await this.saveTransportAccount({
        pluginId: transportId,
        accountId,
        enabled: true,
        config: existing.config
      })
    }

    await this.setTransportPluginEnabled({
      pluginId: transportId,
      enabled: true
    })

    if (input.validate !== false) {
      await this.testTransportAccount({
        pluginId: transportId,
        accountId
      })
    }

    const updated = await this.getTransportAccount(transportId, accountId)
    if (!updated)
      throw new Error(`Transport account not found after connect: ${transportId}:${accountId}`)
    return updated
  }

  async disconnectTransportAccount(input: {
    transportId: string
    accountId: string
    disableOnStartup?: boolean
  }): Promise<TransportPluginAccount> {
    const transportId = String(input.transportId ?? '').trim()
    const accountId = String(input.accountId ?? '').trim()
    if (!transportId) throw new Error('transportId is required')
    if (!accountId) throw new Error('accountId is required')

    const existing = await this.getTransportAccount(transportId, accountId)
    if (!existing) throw new Error(`Transport account not found: ${transportId}:${accountId}`)

    if (input.disableOnStartup !== false && existing.enabled) {
      await this.saveTransportAccount({
        pluginId: transportId,
        accountId,
        enabled: false,
        config: existing.config
      })
    }

    try {
      await this.transportHost.disconnect(transportId, accountId)
    } catch {
      // Best-effort disconnect; the persisted startup state is the canonical source of truth.
    }

    const updated = await this.getTransportAccount(transportId, accountId)
    if (!updated)
      throw new Error(`Transport account not found after disconnect: ${transportId}:${accountId}`)
    return updated
  }

  async sendImMessage(input: SendImMessageInput): Promise<SendImMessageResult> {
    const text = String(input.text ?? '')
      .replace(/\r\n/g, '\n')
      .trim()
    if (!text) throw new Error('text is required')

    let conversation: Conversation | null = null
    let binding: ConversationBinding | null = null

    if (input.bindingId) {
      binding = this.core.getConversationBinding(String(input.bindingId).trim())
      if (!binding) throw new Error(`Unknown Binding: ${String(input.bindingId)}`)
      conversation = this.core.getConversation(binding.conversationId)
      if (!conversation) throw new Error(`Unknown Conversation: ${binding.conversationId}`)
    } else if (input.conversationId && !input.externalChatId && !input.transportId) {
      conversation = this.core.getConversation(String(input.conversationId).trim())
      if (!conversation) throw new Error(`Unknown Conversation: ${String(input.conversationId)}`)
      if (!conversation.activeBindingId) {
        throw new Error(`Conversation has no active binding: ${conversation.id}`)
      }
      binding = this.core.getConversationBinding(conversation.activeBindingId)
      if (!binding)
        throw new Error(`Conversation active binding is missing: ${conversation.activeBindingId}`)
    } else {
      const transportId = String(input.transportId ?? '').trim()
      const accountId = String(input.accountId ?? '').trim()
      const externalUserId = String(input.externalUserId ?? '').trim()
      const externalChatId = String(input.externalChatId ?? '').trim() || externalUserId
      if (!transportId) throw new Error('transportId is required when bindingId is not provided')
      if (!accountId) throw new Error('accountId is required when bindingId is not provided')
      if (!externalChatId) {
        throw new Error(
          'externalChatId or externalUserId is required when bindingId is not provided'
        )
      }
      if (deriveConversationSourceKind(transportId) !== 'im') {
        throw new Error(`Transport ${transportId} is not an IM transport`)
      }

      await this.ensureTransportsDiscovered()
      await this.transportHost.activate(transportId)

      const routeResult = input.conversationId
        ? await this.attachImRoute({
            conversationId: input.conversationId,
            transportId,
            accountId,
            externalChatId,
            externalThreadId: input.externalThreadId ?? null,
            externalUserId: externalUserId || null,
            channelKind: input.channelKind ?? 'dm',
            title: input.title ?? null,
            setAsActiveRoute: input.setAsActiveRoute ?? false
          })
        : this.core.resolveConversationForTarget({
            agentProfileId: this.resolveAgentProfileId(),
            title: input.title ?? null,
            desktopVisibilityMode: 'readonly',
            setAsActiveBinding: false,
            target: {
              transportId,
              transportAccountId: accountId,
              externalChatId,
              externalThreadId: input.externalThreadId ?? null,
              externalUserId: externalUserId || null,
              channelKind: input.channelKind ?? 'dm'
            }
          })

      conversation = routeResult.conversation
      binding = routeResult.binding
    }

    if (!conversation || !binding) {
      throw new Error('Unable to resolve conversation binding for IM delivery')
    }
    if (deriveConversationSourceKind(binding.transportId) !== 'im') {
      throw new Error(`Binding ${binding.id} does not point to an IM transport`)
    }

    const delivery = this.core.requestDelivery({
      conversationId: conversation.id,
      bindingId: binding.id,
      mode: 'send',
      payload: { text }
    })
    const dispatch = await this.outboundDispatcher.dispatch(delivery)
    return {
      conversation,
      binding,
      delivery: this.core.getDeliveryRecord(delivery.id) ?? delivery,
      dispatch
    }
  }

  async listInstalledTransportPlugins(): Promise<InstalledTransportPlugin[]> {
    await this.ensureTransportsDiscovered()

    return this.transportHost
      .listRegistrations()
      .filter((registration) => {
        const hasSettings = Boolean(registration.manifest.contributes?.settings)
        return hasSettings || registration.sourceKind !== 'builtin'
      })
      .map((registration) => {
        const settingsSchema = registration.manifest.contributes?.settings
        const accounts = settingsSchema
          ? this.transportPluginConfigService.listAccounts(registration.manifest.id, settingsSchema)
          : []
        const validation = this.resolvePluginValidation(accounts)
        return {
          pluginId: registration.manifest.id,
          displayName: registration.manifest.displayName,
          description: registration.manifest.description,
          version: registration.manifest.version,
          sourceKind: registration.sourceKind,
          state: registration.state,
          error: registration.error ?? null,
          enabled: this.transportPluginConfigService.isTransportPluginEnabled(
            registration.manifest
          ),
          configurable: Boolean(settingsSchema),
          accountCount: accounts.length,
          validationStatus: validation.status,
          lastValidatedAt: validation.lastValidatedAt,
          validationError: validation.error,
          settingsSchema
        }
      })
  }

  async getTransportPluginManifest(pluginId: string): Promise<PluginManifest | null> {
    return (await this.findTransportRegistration(pluginId))?.manifest ?? null
  }

  async listTransportAccountSetupMethods(
    pluginId: string
  ): Promise<TransportPluginAccountSetupMethod[]> {
    const registration = await this.requireConfigurableTransportRegistration(pluginId)
    return this.resolveTransportAccountSetupMethods(registration.manifest.contributes!.settings!)
  }

  onTransportAccountSetupEvent(
    handler: (event: TransportPluginAccountSetupEvent) => Promise<void> | void
  ): () => void {
    this.transportAccountSetupHandlers.add(handler)
    return () => this.transportAccountSetupHandlers.delete(handler)
  }

  async startTransportAccountSetup(
    input: StartTransportPluginAccountSetupInput
  ): Promise<TransportPluginAccountSetupStartResult> {
    const registration = await this.requireConfigurableTransportRegistration(input.pluginId)
    const accountId = String(input.accountId ?? '').trim()
    const methodId = String(input.methodId ?? '').trim()
    if (!accountId) throw new Error('accountId is required')
    if (!methodId) throw new Error('methodId is required')

    const methods = this.resolveTransportAccountSetupMethods(
      registration.manifest.contributes!.settings!
    )
    const method = methods.find((item) => item.id === methodId)
    if (!method) {
      throw new Error(
        `Unknown transport account setup method: ${registration.manifest.id}:${methodId}`
      )
    }
    if (method.kind === 'form') {
      throw new Error('Form setup methods must be handled by saveTransportAccount')
    }

    const result = await this.transportHost.startAccountSetup(registration.manifest.id, {
      accountId,
      methodId,
      initialValues: input.initialValues ?? {}
    })
    this.transportAccountSetupSessions.set(result.sessionId, {
      pluginId: registration.manifest.id,
      accountId,
      methodId,
      validateAfterSave: input.validateAfterSave !== false
    })

    for (const event of result.events ?? []) {
      await this.handleTransportAccountSetupEvent(event)
    }

    return {
      ...result,
      pluginId: registration.manifest.id,
      accountId,
      methodId
    }
  }

  async cancelTransportAccountSetup(
    pluginId: string,
    sessionId: string
  ): Promise<{ success: true }> {
    const registration = await this.requireConfigurableTransportRegistration(pluginId)
    const normalizedSessionId = String(sessionId ?? '').trim()
    if (!normalizedSessionId) throw new Error('sessionId is required')
    await this.transportHost.cancelAccountSetup(registration.manifest.id, normalizedSessionId)
    const session = this.transportAccountSetupSessions.get(normalizedSessionId)
    this.transportAccountSetupSessions.delete(normalizedSessionId)
    await this.emitTransportAccountSetupEvent({
      type: 'status',
      pluginId: registration.manifest.id,
      accountId: session?.accountId,
      methodId: session?.methodId,
      sessionId: normalizedSessionId,
      state: 'cancelled',
      message: 'Account setup was cancelled.'
    })
    return { success: true }
  }

  async setTransportPluginEnabled(
    input: SetTransportPluginEnabledInput
  ): Promise<{ pluginId: string; enabled: boolean }> {
    const registration = await this.requireConfigurableTransportRegistration(input.pluginId)
    const result = this.transportPluginConfigService.setPluginEnabled(input)
    await this.syncTransportRuntime(registration.manifest)
    return result
  }

  async listTransportAccounts(pluginId: string): Promise<TransportPluginAccount[]> {
    const registration = await this.requireConfigurableTransportRegistration(pluginId)
    return this.transportPluginConfigService.listAccounts(
      registration.manifest.id,
      registration.manifest.contributes?.settings
    )
  }

  async getTransportAccount(
    pluginId: string,
    accountId: string
  ): Promise<TransportPluginAccount | null> {
    const registration = await this.requireConfigurableTransportRegistration(pluginId)
    return this.transportPluginConfigService.getAccount(
      registration.manifest.id,
      accountId,
      registration.manifest.contributes?.settings
    )
  }

  async saveTransportAccount(
    input: SaveTransportPluginAccountInput
  ): Promise<TransportPluginAccount> {
    const registration = await this.requireConfigurableTransportRegistration(input.pluginId)
    const saved = this.transportPluginConfigService.saveAccount(registration.manifest, input)
    await this.syncTransportRuntime(registration.manifest)
    return saved
  }

  async testTransportAccount(
    input: TestTransportPluginAccountInput
  ): Promise<TestTransportPluginAccountResult> {
    const registration = await this.requireConfigurableTransportRegistration(input.pluginId)
    const accountId = String(input.accountId ?? '').trim()
    if (!accountId) throw new Error('accountId is required')

    const account = this.transportPluginConfigService.getAccount(
      registration.manifest.id,
      accountId,
      registration.manifest.contributes?.settings
    )
    if (!account) {
      throw new Error(`Transport account not found: ${registration.manifest.id}:${accountId}`)
    }

    await this.transportHost.activate(registration.manifest.id)

    const activatedRegistration = this.transportHost
      .listRegistrations()
      .find((item) => item.manifest.id === registration.manifest.id)
    const plugin = activatedRegistration?.plugin
    if (!plugin) {
      throw new Error(`Transport plugin is not activated: ${registration.manifest.id}`)
    }

    if (typeof plugin.validateAccount === 'function') {
      try {
        await plugin.validateAccount(accountId)
        const checkedAt = new Date().toISOString()
        this.transportPluginConfigService.setAccountValidationResult({
          pluginId: registration.manifest.id,
          accountId,
          status: 'validated',
          checkedAt
        })
        return {
          pluginId: registration.manifest.id,
          accountId,
          success: true,
          checkedAt
        }
      } catch (error) {
        this.transportPluginConfigService.setAccountValidationResult({
          pluginId: registration.manifest.id,
          accountId,
          status: 'invalid',
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    }

    const wasConnected = this.transportHost
      .listConnectedAccounts(registration.manifest.id)
      .includes(accountId)
    const shouldRemainConnected = this.transportPluginConfigService
      .resolveStartupAccountIds(registration.manifest)
      .includes(accountId)

    if (wasConnected) {
      await this.transportHost.disconnect(registration.manifest.id, accountId)
    }

    try {
      await this.transportHost.connect(registration.manifest.id, accountId)
    } catch (error) {
      this.transportPluginConfigService.setAccountValidationResult({
        pluginId: registration.manifest.id,
        accountId,
        status: 'invalid',
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }

    if (!shouldRemainConnected) {
      await this.transportHost.disconnect(registration.manifest.id, accountId)
    }

    const checkedAt = new Date().toISOString()
    this.transportPluginConfigService.setAccountValidationResult({
      pluginId: registration.manifest.id,
      accountId,
      status: 'validated',
      checkedAt
    })

    return {
      pluginId: registration.manifest.id,
      accountId,
      success: true,
      checkedAt
    }
  }

  private resolvePluginValidation(accounts: TransportPluginAccount[]): {
    status: TransportPluginValidationStatus
    lastValidatedAt: string | null
    error: string | null
  } {
    if (accounts.length === 0) {
      return { status: 'unknown', lastValidatedAt: null, error: null }
    }

    const sorted = [...accounts].sort((left, right) => {
      const leftTime = Date.parse(left.lastValidatedAt ?? '') || 0
      const rightTime = Date.parse(right.lastValidatedAt ?? '') || 0
      return rightTime - leftTime
    })

    const validated = sorted.find((account) => account.validationStatus === 'validated')
    if (validated) {
      return {
        status: 'validated',
        lastValidatedAt: validated.lastValidatedAt ?? null,
        error: null
      }
    }

    const invalid = sorted.find((account) => account.validationStatus === 'invalid')
    if (invalid) {
      return {
        status: 'invalid',
        lastValidatedAt: invalid.lastValidatedAt ?? null,
        error: invalid.validationError ?? null
      }
    }

    return { status: 'unknown', lastValidatedAt: null, error: null }
  }

  async deleteTransportAccount(pluginId: string, accountId: string): Promise<{ success: true }> {
    const registration = await this.requireConfigurableTransportRegistration(pluginId)
    const result = this.transportPluginConfigService.deleteAccount(pluginId, accountId)
    await this.syncTransportRuntime(registration.manifest)
    return result
  }

  private resolveTransportAccountSetupMethods(
    settingsSchema: TransportPluginSettingsSchema
  ): TransportPluginAccountSetupMethod[] {
    if (settingsSchema.setupMethods?.length) return settingsSchema.setupMethods
    return [
      {
        id: 'manual_config',
        kind: 'form',
        label: '手动填写配置',
        fields: settingsSchema.fields.map((field) => field.key)
      }
    ]
  }

  private async handleTransportAccountSetupEvent(
    event: TransportPluginAccountSetupEvent
  ): Promise<void> {
    const session = this.transportAccountSetupSessions.get(event.sessionId)
    if (!session) return

    const enriched = {
      ...event,
      pluginId: event.pluginId ?? session.pluginId,
      accountId: event.accountId ?? session.accountId,
      methodId: event.methodId ?? session.methodId
    } as TransportPluginAccountSetupEvent

    if (enriched.type === 'completed') {
      try {
        await this.saveTransportAccount({
          pluginId: session.pluginId,
          accountId: session.accountId,
          enabled: true,
          config: enriched.config,
          secrets: enriched.secrets ?? {}
        })
        await this.setTransportPluginEnabled({
          pluginId: session.pluginId,
          enabled: true
        })
        if (session.validateAfterSave) {
          await this.testTransportAccount({
            pluginId: session.pluginId,
            accountId: session.accountId
          })
        }
        await this.emitTransportAccountSetupEvent(enriched)
      } catch (error) {
        await this.emitTransportAccountSetupEvent({
          type: 'failed',
          pluginId: session.pluginId,
          accountId: session.accountId,
          methodId: session.methodId,
          sessionId: event.sessionId,
          retryable: false,
          error: error instanceof Error ? error.message : String(error)
        })
      } finally {
        this.transportAccountSetupSessions.delete(event.sessionId)
      }
      return
    }

    await this.emitTransportAccountSetupEvent(enriched)
    if (enriched.type === 'expired' || enriched.type === 'failed') {
      this.transportAccountSetupSessions.delete(event.sessionId)
    }
    if (
      enriched.type === 'status' &&
      (enriched.state === 'expired' ||
        enriched.state === 'failed' ||
        enriched.state === 'cancelled')
    ) {
      this.transportAccountSetupSessions.delete(event.sessionId)
    }
  }

  private async emitTransportAccountSetupEvent(
    event: TransportPluginAccountSetupEvent
  ): Promise<void> {
    const qrStatus = mapTransportAccountSetupEventToQrStatus(event)
    if (qrStatus) {
      try {
        this.core.updateAgentRunProjectionTransportSetupQr?.({
          sessionId: event.sessionId,
          status: qrStatus,
          transportId: event.pluginId ?? null,
          accountId: event.accountId ?? null,
          methodId: event.methodId ?? null,
          imageUrl: event.type === 'qr' ? event.qrImageDataUrl || event.qrUrl || null : null,
          qrText: event.type === 'qr' ? (event.qrText ?? null) : null,
          expiresAt: 'expiresAt' in event ? event.expiresAt : null,
          updatedAt: new Date().toISOString()
        })
      } catch (error) {
        console.error('Persist transport account setup projection failed', error)
      }
    }

    this.dispatchTransportAccountSetupModelEvent(event)

    try {
      this.core.upsertEventLogEntry({
        eventType: 'transport.account_setup.event',
        traceId: event.sessionId,
        correlationId: event.sessionId,
        aggregateType: 'transport_account_setup',
        aggregateId: event.sessionId,
        payload: {
          event: serializeTransportAccountSetupEventForLog(event)
        },
        createdAt: new Date().toISOString()
      })
    } catch (error) {
      console.error('Persist transport account setup event failed', error)
    }

    for (const handler of this.transportAccountSetupHandlers) {
      await handler(event)
    }
  }

  private dispatchTransportAccountSetupModelEvent(event: TransportPluginAccountSetupEvent): void {
    const status = mapTransportAccountSetupEventToModelNotificationStatus(event)
    if (!status) return
    if (!this.core.claimAgentRunProjectionTransportSetupQrModelNotification) return

    const now = new Date().toISOString()
    const claims = this.core.claimAgentRunProjectionTransportSetupQrModelNotification({
      sessionId: event.sessionId,
      status,
      transportId: event.pluginId ?? null,
      accountId: event.accountId ?? null,
      methodId: event.methodId ?? null,
      updatedAt: now
    })
    for (const claim of claims) {
      const conversation = this.core.getConversation(claim.conversationId)
      const externalMessageId = `transport-account-setup:${claim.sessionId}:${claim.status}:system-event`
      this.core.upsertConversationMessage({
        conversationId: claim.conversationId,
        bindingId: conversation?.activeBindingId ?? null,
        externalMessageId,
        role: 'system',
        direction: 'internal',
        text: buildTransportAccountSetupSystemEventText(event, claim),
        payload: {
          transportAccountSetupSystemEvent: {
            sessionId: claim.sessionId,
            status: claim.status,
            transportId: event.pluginId ?? claim.transportId ?? null,
            accountId: event.accountId ?? claim.accountId ?? null,
            methodId: event.methodId ?? claim.methodId ?? null
          }
        },
        createdAt: now
      })
      const run = this.core.requestRun({
        conversationId: claim.conversationId,
        triggerKind: 'system_followup',
        traceId: externalMessageId
      })
      this.startScheduledRun(this.runScheduler.schedule(run))
    }
  }

  private startScheduledRun(decision: RunScheduleDecision): void {
    if (decision.action !== 'start' || !this.runExecutor) return
    const stopTyping = this.startTypingIndicatorForRun(decision.run)
    void this.runExecutor
      .start(decision.run)
      .catch((error) => {
        console.error('Gateway run executor failed', error)
      })
      .finally(() => {
        stopTyping()
        const next = this.runScheduler.completeActiveRun(decision.run.conversationId)
        if (next) this.startScheduledRun(next)
      })
  }

  private startTypingIndicatorForRun(run: AgentRun): () => void {
    const conversation = this.core.getConversation(run.conversationId)
    const binding = conversation?.activeBindingId
      ? this.core.getConversationBinding(conversation.activeBindingId)
      : null
    if (!binding || deriveConversationSourceKind(binding.transportId) !== 'im') {
      return () => undefined
    }
    const transportRegistration = this.transportHost
      .listRegistrations()
      .find((registration) => registration.manifest.id === binding.transportId)
    if (transportRegistration?.state !== 'activated') {
      return () => undefined
    }

    let stopped = false
    const sendTyping = () => {
      if (stopped) return
      void this.transportHost
        .send({
          deliveryId: `typing:${run.id}:${Date.now()}`,
          conversationId: run.conversationId,
          bindingId: binding.id,
          transportId: binding.transportId,
          transportAccountId: binding.transportAccountId,
          externalChatId: binding.externalChatId,
          externalThreadId: binding.externalThreadId ?? null,
          externalUserId: binding.externalUserId ?? null,
          channelKind: binding.channelKind,
          mode: 'typing',
          payload: { kind: 'typing' }
        })
        .catch((error) => {
          console.warn('Send IM typing action failed', error)
        })
    }

    sendTyping()
    const timer = setInterval(sendTyping, IM_TYPING_REFRESH_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }

  private normalizeReceivedAt(value?: string | number | Date | null): string {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'number') return new Date(value).toISOString()
    if (typeof value === 'string' && value.trim()) {
      const timestamp = Date.parse(value)
      if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString()
    }
    return new Date().toISOString()
  }

  private async ensureTransportsDiscovered(): Promise<void> {
    if (this.builtinDiscovered) return
    this.transportHost.discoverBuiltin(desktopChatTransportModule)
    await this.transportHost.discoverExternal(this.externalPluginDirectories)
    this.builtinDiscovered = true
  }

  private async findTransportRegistration(
    pluginId: string
  ): Promise<PluginRegistration<TransportPlugin> | null> {
    await this.ensureTransportsDiscovered()
    const normalizedPluginId = String(pluginId ?? '').trim()
    if (!normalizedPluginId) throw new Error('pluginId is required')
    return (
      this.transportHost
        .listRegistrations()
        .find((registration) => registration.manifest.id === normalizedPluginId) ?? null
    )
  }

  private async requireConfigurableTransportRegistration(
    pluginId: string
  ): Promise<PluginRegistration<TransportPlugin>> {
    const registration = await this.findTransportRegistration(pluginId)
    if (!registration) throw new Error(`Unknown transport plugin: ${pluginId}`)
    if (!registration.manifest.contributes?.settings) {
      throw new Error(`Transport plugin ${pluginId} does not declare contributes.settings`)
    }
    return registration
  }

  private async syncTransportRuntime(manifest: PluginManifest): Promise<void> {
    if (!this.started) return

    const desiredAccounts = new Set(
      this.transportPluginConfigService.resolveStartupAccountIds(manifest)
    )
    const connectedAccounts = new Set(this.transportHost.listConnectedAccounts(manifest.id))

    for (const accountId of connectedAccounts) {
      if (desiredAccounts.has(accountId)) continue
      try {
        await this.transportHost.disconnect(manifest.id, accountId)
      } catch (error) {
        console.error(
          `Disconnect transport failed for ${manifest.id}:${accountId}`,
          sanitizeForLog(error)
        )
      }
    }

    for (const accountId of desiredAccounts) {
      try {
        await this.transportHost.connect(manifest.id, accountId)
      } catch (error) {
        console.error(
          `Connect transport failed for ${manifest.id}:${accountId}`,
          sanitizeForLog(error)
        )
      }
    }
  }
}

let embeddedGatewaySingleton: EmbeddedGatewayService | null = null

export const getEmbeddedGatewayService = async (): Promise<EmbeddedGatewayService> => {
  if (embeddedGatewaySingleton) return embeddedGatewaySingleton
  const core = getCoreV2Service()
  const runtimeHost = await getLocalRuntimeHostService()
  embeddedGatewaySingleton = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: getTransportPluginConfigService(),
    runScheduler: runtimeHost.getRunScheduler(),
    runExecutor: runtimeHost.getRunExecutor(),
    modelCatalog: {
      listProviders,
      listProviderModels
    }
  })
  runtimeHost.getRunExecutor().setDispatchPendingDeliveries(async () => {
    await embeddedGatewaySingleton?.dispatchPendingDeliveries()
  })
  return embeddedGatewaySingleton
}

export const stopEmbeddedGatewayService = async (): Promise<void> => {
  if (!embeddedGatewaySingleton) return
  await embeddedGatewaySingleton.stop()
  embeddedGatewaySingleton = null
}
