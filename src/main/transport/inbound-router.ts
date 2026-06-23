import type {
  ConversationBinding,
  ConversationMessage,
  CoreCommandService,
  CoreQueryService,
  AgentRun,
  InboundEnvelope
} from '../core-v2/domain.ts'
import { deriveConversationSourceKind } from '../core-v2/domain.ts'
import type { ImRuntimeCoordinator } from '../im/im-runtime-coordinator.ts'
import type { RunScheduleDecision } from '../runtime-host/run-scheduler.ts'

export type InboundScheduledRouteResult = {
  action: 'scheduled'
  conversationId: string
  binding: ConversationBinding
  message: ConversationMessage | null
  run: AgentRun
  scheduleDecision?: RunScheduleDecision
}

export type InboundRouteResult =
  | InboundScheduledRouteResult
  | {
      action: 'deduped'
      conversationId: null
      binding: null
      message: null
      run: null
      scheduleDecision: null
      imTraceId: string
      dedupeKey: string
      existingTraceId: string
    }
  | {
      action: 'command_handled'
      conversationId: string
      binding: ConversationBinding
      message: ConversationMessage | null
      run: null
      scheduleDecision: null
      imTraceId: string
      command: string
      deliveryId: string
    }
  | {
      action: 'interaction_handled'
      conversationId: string
      binding: ConversationBinding
      message: ConversationMessage | null
      run: null
      scheduleDecision: null
      imTraceId: string
      interactionId: string
      deliveryId: string
    }

export type InboundRouterHandleOptions = {
  appendInboundMessage?: boolean
}

export type InboundRouterDeps = {
  core: Pick<
    CoreCommandService & CoreQueryService,
    | 'resolveConversationForEnvelope'
    | 'appendInboundEnvelope'
    | 'requestRun'
    | 'getConversationMessages'
  >
  resolveAgentProfileId: () => string
  imRuntimeCoordinator?: ImRuntimeCoordinator
}

export class InboundRouter {
  private readonly core: InboundRouterDeps['core']
  private readonly resolveAgentProfileId: () => string
  private readonly imRuntimeCoordinator?: ImRuntimeCoordinator

  constructor(deps: InboundRouterDeps) {
    this.core = deps.core
    this.resolveAgentProfileId = deps.resolveAgentProfileId
    this.imRuntimeCoordinator = deps.imRuntimeCoordinator
  }

  handleEnvelope(
    envelope: InboundEnvelope,
    options: InboundRouterHandleOptions = {}
  ): InboundRouteResult {
    const sourceKind = deriveConversationSourceKind(envelope.transportId)
    if (sourceKind === 'im' && this.imRuntimeCoordinator) {
      return this.imRuntimeCoordinator.ingestCoreEnvelope(envelope, options)
    }

    const resolved = this.core.resolveConversationForEnvelope({
      agentProfileId: this.resolveAgentProfileId(),
      envelope,
      title: envelope.externalUserDisplayName ?? envelope.externalChatId,
      desktopVisibilityMode: sourceKind === 'local' ? 'read_write' : 'readonly'
    })
    const requestedAppendInboundMessage = options.appendInboundMessage ?? true
    const externalMessageId = String(envelope.externalMessageId ?? '').trim()
    const hasPersistedLocalMessage =
      !requestedAppendInboundMessage &&
      sourceKind === 'local' &&
      externalMessageId.length > 0 &&
      this.core
        .getConversationMessages(resolved.conversation.id)
        .some((item) => String(item.externalMessageId ?? '').trim() === externalMessageId)
    const shouldAppendInboundMessage =
      requestedAppendInboundMessage || (sourceKind === 'local' && !hasPersistedLocalMessage)
    const message = shouldAppendInboundMessage
      ? this.core.appendInboundEnvelope({
          conversationId: resolved.conversation.id,
          bindingId: resolved.binding.id,
          envelope
        })
      : null
    const run = this.core.requestRun({
      conversationId: resolved.conversation.id,
      triggerKind: sourceKind === 'local' ? 'user_message' : 'transport_message',
      traceId: envelope.envelopeId
    })

    return {
      action: 'scheduled',
      conversationId: resolved.conversation.id,
      binding: resolved.binding,
      message,
      run
    }
  }
}
