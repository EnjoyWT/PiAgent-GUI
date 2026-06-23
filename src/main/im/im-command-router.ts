import type {
  Conversation,
  ConversationBinding,
  CoreCommandService,
  CoreQueryService,
  DeliveryRecord,
  InboundEnvelope,
  ConversationExecutionOverride,
  ModelSelection,
  ReasoningLevel
} from '../core-v2/domain.ts'
import type { RunScheduler } from '../runtime-host/run-scheduler.ts'
import type { ImDoctorPlane } from './im-doctor-plane.ts'
import type { ImDeliveryPayload } from './im-delivery-types.ts'

export type ImCommandName =
  | 'help'
  | 'status'
  | 'doctor'
  | 'queue'
  | 'session'
  | 'model'
  | 'models'
  | 'stop'
  | 'reset'
  | 'newsession'

type ParsedImCommand =
  | {
      kind: 'known'
      command: ImCommandName
      args: string[]
    }
  | {
      kind: 'unknown'
      command: string
      args: string[]
    }

export type ImCommandResult =
  | { handled: false }
  | {
      handled: true
      command: string
      appendToAgentContext: false
      delivery: DeliveryRecord
      sideEffect: 'none' | 'stop_run' | 'reset_session' | 'new_session'
    }

const MENU_IM_COMMANDS: ImCommandName[] = [
  'help',
  'status',
  'doctor',
  'queue',
  'session',
  'model',
  'models',
  'stop',
  'reset'
]

const KNOWN_IM_COMMANDS: ImCommandName[] = [...MENU_IM_COMMANDS, 'newsession']

const AVAILABLE_COMMANDS_TEXT = MENU_IM_COMMANDS.map((command) => `/${command}`).join(' ')

export type ImModelCatalog = {
  listProviders(): Array<{ id: string; displayName: string; enabled: boolean }>
  listProviderModels(
    providerId: string
  ): Array<{ providerId: string; modelId: string; label: string; enabled: boolean }>
}

const DEFAULT_MODEL_CATALOG: ImModelCatalog = {
  listProviders: () => [],
  listProviderModels: () => []
}

export type ImCommandRouterDeps = {
  core: Pick<
    CoreCommandService & CoreQueryService,
    | 'requestDelivery'
    | 'listPendingInteractions'
    | 'getDeliveryRecords'
    | 'getAgentProfile'
    | 'updateConversation'
    | 'pruneConversationRuntimeAfter'
  >
  runScheduler: RunScheduler
  doctorPlane: ImDoctorPlane
  modelCatalog?: ImModelCatalog
}

export type ImCommandRouterInput = {
  imTraceId: string
  envelope: InboundEnvelope
  conversation: Conversation
  binding: ConversationBinding
}

export class ImCommandRouter {
  private readonly core: ImCommandRouterDeps['core']
  private readonly runScheduler: RunScheduler
  private readonly doctorPlane: ImDoctorPlane
  private readonly modelCatalog: ImModelCatalog

  constructor(deps: ImCommandRouterDeps) {
    this.core = deps.core
    this.runScheduler = deps.runScheduler
    this.doctorPlane = deps.doctorPlane
    this.modelCatalog = deps.modelCatalog ?? DEFAULT_MODEL_CATALOG
  }

  tryHandle(input: ImCommandRouterInput): ImCommandResult {
    const parsed = parseImCommand(input.envelope.text)
    if (!parsed) return { handled: false }

    const payload = this.buildPayload(parsed, input)
    const delivery = this.core.requestDelivery({
      conversationId: input.conversation.id,
      bindingId: input.binding.id,
      mode: 'send',
      transportDeliveryMode: 'reply',
      doctorTraceId: input.imTraceId,
      replyContext: {
        replyToMessageId: input.envelope.externalMessageId
      },
      payload
    })

    this.doctorPlane.recordStep({
      imTraceId: input.imTraceId,
      step: 'command_checked',
      status: parsed.kind === 'known' ? 'pass' : 'warn',
      message:
        parsed.kind === 'known'
          ? `Handled /${parsed.command}`
          : `Unknown command /${parsed.command}`,
      detail: {
        command: parsed.command,
        commandKind: parsed.kind,
        deliveryId: delivery.id
      }
    })

    return {
      handled: true,
      command: parsed.command,
      appendToAgentContext: false,
      delivery,
      sideEffect:
        parsed.kind === 'known' && parsed.command === 'stop'
          ? 'stop_run'
          : parsed.kind === 'known' && parsed.command === 'reset'
            ? 'reset_session'
            : parsed.kind === 'known' && parsed.command === 'newsession'
              ? 'new_session'
              : 'none'
    }
  }

  private buildPayload(parsed: ParsedImCommand, input: ImCommandRouterInput): ImDeliveryPayload {
    if (parsed.kind === 'unknown') {
      const attempted = parsed.command ? `/${parsed.command}` : '/'
      return {
        kind: 'text',
        text: [`Unknown command: ${attempted}`, `Available: ${AVAILABLE_COMMANDS_TEXT}`].join('\n')
      }
    }

    const { command } = parsed
    if (command === 'help') {
      return {
        kind: 'text',
        text: [
          `Available commands: ${AVAILABLE_COMMANDS_TEXT}`,
          'Use Telegram / menu entries to run them quickly.'
        ].join('\n')
      }
    }

    if (command === 'status') {
      const queueLength = this.runScheduler.listQueuedRuns(input.conversation.id).length
      const pendingInteraction = this.core.listPendingInteractions(input.conversation.id)[0] ?? null
      const lastDelivery = this.core.getDeliveryRecords(input.conversation.id).at(-1) ?? null
      return {
        kind: 'text',
        text: [
          `Session: ${input.binding.sessionScope ?? 'unknown'}`,
          `Conversation: ${input.conversation.id}`,
          `Run queue: ${queueLength}`,
          `Pending interaction: ${pendingInteraction?.kind ?? 'none'}`,
          `Last delivery: ${lastDelivery?.status ?? 'none'}`
        ].join('\n')
      }
    }

    if (command === 'doctor') {
      const trace = this.doctorPlane.getTrace(input.imTraceId)
      return {
        kind: 'text',
        text: [
          `Doctor: ${input.imTraceId}`,
          `Route: ${input.binding.routingKey}`,
          `Steps: ${trace?.steps.length ?? 0}`,
          `Last step: ${trace?.steps.at(-1)?.step ?? 'none'}`
        ].join('\n')
      }
    }

    if (command === 'queue') {
      const queued = this.runScheduler.listQueuedRuns(input.conversation.id)
      return {
        kind: 'text',
        text:
          queued.length === 0
            ? 'Queue: empty'
            : [
                `Queue: ${queued.length}`,
                ...queued.map((run, index) => `${index + 1}. ${run.id}`)
              ].join('\n')
      }
    }

    if (command === 'session') {
      return {
        kind: 'text',
        text: [
          `Session: ${input.binding.sessionScope ?? 'unknown'}`,
          `Conversation: ${input.conversation.id}`,
          `Binding: ${input.binding.id}`,
          `Person: ${input.binding.personId ?? 'none'}`
        ].join('\n')
      }
    }

    if (command === 'model') {
      return this.buildModelPayload(parsed.args, input)
    }

    if (command === 'models') {
      return this.buildModelsPayload(input)
    }

    if (command === 'stop') {
      const stopResult = this.runScheduler.stopConversation(input.conversation.id)
      return {
        kind: 'text',
        text: stopResult.stoppedActiveRun
          ? `Stopped active run. Queue length: ${stopResult.queueLength}`
          : `No active run. Queue length: ${stopResult.queueLength}`
      }
    }

    if (command === 'reset') {
      const resetResult = this.runScheduler.resetConversation(input.conversation.id)
      this.core.pruneConversationRuntimeAfter({
        conversationId: input.conversation.id,
        cutoffCreatedAt: cutoffBefore(input.conversation.createdAt)
      })
      return {
        kind: 'text',
        text: [
          'Session reset.',
          `Stopped active run: ${resetResult.stoppedActiveRun ? 'yes' : 'no'}`,
          `Cleared queued runs: ${resetResult.clearedQueueLength}`
        ].join('\n')
      }
    }

    if (command === 'newsession') {
      return {
        kind: 'text',
        text: [
          '/newsession is not supported yet for IM transports.',
          'Reason: the current core maps one IM routing key to one active conversation binding.',
          'Use /reset to clear the current session context.'
        ].join('\n')
      }
    }

    return {
      kind: 'text',
      text: `/${command} is not implemented yet.`
    }
  }

  private buildModelPayload(args: string[], input: ImCommandRouterInput): ImDeliveryPayload {
    const defaultModel = this.resolveDefaultModel(input)
    const currentModel = resolveEffectiveModel(defaultModel, input.conversation.executionOverride)
    const firstArg = args[0]?.trim().toLowerCase()
    if (!firstArg || firstArg === 'current' || firstArg === 'show') {
      return {
        kind: 'text',
        text: [
          `Current model: ${formatModel(currentModel)}`,
          input.conversation.executionOverride?.model
            ? 'Source: conversation override'
            : 'Source: agent default',
          'Usage: /model provider::model | /model provider model | /model default',
          'List available models: /models'
        ].join('\n')
      }
    }

    if (firstArg === 'default' || firstArg === 'reset' || firstArg === 'clear') {
      this.core.updateConversation({
        conversationId: input.conversation.id,
        executionOverride: removeModelOverride(input.conversation.executionOverride)
      })
      return {
        kind: 'text',
        text: `Model override cleared. Current model: ${formatModel(defaultModel)}`
      }
    }

    const parsed = parseModelSelection(args, currentModel)
    if (!parsed) {
      return {
        kind: 'text',
        text: [
          'Could not parse model selection.',
          'Usage: /model provider::model | /model provider model | /model default'
        ].join('\n')
      }
    }

    this.core.updateConversation({
      conversationId: input.conversation.id,
      executionOverride: {
        ...(input.conversation.executionOverride ?? {}),
        model: parsed
      }
    })
    return {
      kind: 'text',
      text: `Model updated: ${formatModel(parsed)}`
    }
  }

  private buildModelsPayload(input: ImCommandRouterInput): ImDeliveryPayload {
    const defaultModel = this.resolveDefaultModel(input)
    const currentModel = resolveEffectiveModel(defaultModel, input.conversation.executionOverride)
    const lines = [
      `Current model: ${formatModel(currentModel)}`,
      'Available models:',
      'Copy one command to switch quickly:'
    ]
    let modelCount = 0
    const providers = this.modelCatalog
      .listProviders()
      .filter((provider) => provider.enabled)
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id))

    for (const provider of providers) {
      const models = this.modelCatalog
        .listProviderModels(provider.id)
        .filter((model) => model.enabled)
        .sort((a, b) => a.label.localeCompare(b.label) || a.modelId.localeCompare(b.modelId))
      if (models.length === 0) continue

      lines.push('', `${provider.displayName || provider.id} (${provider.id})`)
      for (const model of models) {
        modelCount += 1
        const label =
          model.label?.trim() && model.label !== model.modelId ? `${model.label} - ` : ''
        lines.push(`- ${label}/model ${provider.id}::${model.modelId}`)
      }
    }

    if (modelCount === 0) {
      lines.push(
        'No enabled models found.',
        'Sync provider models in settings, then enable the models you want to use.'
      )
    }

    return {
      kind: 'text',
      text: lines.join('\n')
    }
  }

  private resolveDefaultModel(input: ImCommandRouterInput): ModelSelection {
    const profile = this.core.getAgentProfile(input.conversation.agentProfileId)
    return (
      profile?.defaultExecutionPolicy.model ?? {
        providerId: 'unknown',
        modelId: 'unknown'
      }
    )
  }
}

export const parseImCommand = (text?: string | null): ParsedImCommand | null => {
  const trimmed = text?.trim()
  if (!trimmed?.startsWith('/')) return null
  const [rawCommand = '', ...args] = trimmed.slice(1).split(/\s+/).filter(Boolean)
  const command = rawCommand.toLowerCase().split('@', 1)[0] ?? ''
  if (KNOWN_IM_COMMANDS.includes(command as ImCommandName)) {
    return { kind: 'known', command: command as ImCommandName, args }
  }
  return { kind: 'unknown', command, args }
}

const resolveEffectiveModel = (
  defaultModel: ModelSelection,
  override?: ConversationExecutionOverride | null
): ModelSelection => ({
  ...defaultModel,
  ...(override?.model ?? {})
})

const formatModel = (model: Partial<ModelSelection>): string => {
  const providerId = model.providerId?.trim() || 'unknown'
  const modelId = model.modelId?.trim() || 'unknown'
  return `${providerId}::${modelId}${model.reasoningLevel ? ` (${model.reasoningLevel})` : ''}`
}

const parseModelSelection = (
  args: string[],
  currentModel: ModelSelection
): Partial<ModelSelection> | null => {
  const [firstRaw = '', secondRaw = '', thirdRaw = ''] = args
  const first = firstRaw.trim()
  const second = secondRaw.trim()
  const third = thirdRaw.trim()
  if (!first) return null

  const reasoningFromSecond = parseReasoningLevel(second)
  if (first.includes('::')) {
    const [providerId, ...modelParts] = first.split('::')
    const modelId = modelParts.join('::').trim()
    if (!providerId.trim() || !modelId) return null
    return {
      providerId: providerId.trim(),
      modelId,
      ...(reasoningFromSecond ? { reasoningLevel: reasoningFromSecond } : {})
    }
  }

  if (second && !reasoningFromSecond) {
    const reasoningFromThird = parseReasoningLevel(third)
    return {
      providerId: first,
      modelId: second,
      ...(reasoningFromThird ? { reasoningLevel: reasoningFromThird } : {})
    }
  }

  return {
    providerId: currentModel.providerId,
    modelId: first,
    ...(reasoningFromSecond ? { reasoningLevel: reasoningFromSecond } : {})
  }
}

const REASONING_LEVELS: ReasoningLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

const parseReasoningLevel = (
  value: string | undefined
): ModelSelection['reasoningLevel'] | null => {
  if (REASONING_LEVELS.includes(value as ReasoningLevel)) return value as ReasoningLevel
  return null
}

const removeModelOverride = (
  override?: ConversationExecutionOverride | null
): ConversationExecutionOverride | null => {
  if (!override) return null
  const next: ConversationExecutionOverride = {}
  if (override.toolProfileId !== undefined) next.toolProfileId = override.toolProfileId
  if (override.sandboxPolicyId !== undefined) next.sandboxPolicyId = override.sandboxPolicyId
  return Object.keys(next).length > 0 ? next : null
}

const cutoffBefore = (createdAt: string): string => {
  const timestamp = Date.parse(createdAt)
  if (!Number.isFinite(timestamp)) return createdAt
  return new Date(Math.max(0, timestamp - 1)).toISOString()
}
