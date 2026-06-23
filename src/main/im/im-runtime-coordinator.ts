import type {
  AgentRun,
  ConversationBinding,
  ConversationMessage,
  CoreCommandService,
  CoreQueryService,
  InboundEnvelope
} from '../core-v2/domain.ts'
import { deriveConversationSourceKind } from '../core-v2/domain.ts'
import type { RunScheduleDecision, RunScheduler } from '../runtime-host/run-scheduler.ts'
import { ImCommandRouter } from './im-command-router.ts'
import type { ImCommandResult, ImModelCatalog } from './im-command-router.ts'
import { ImDedupeStore } from './im-dedupe-store.ts'
import type { ImDedupeDecision } from './im-dedupe-store.ts'
import type { ImDoctorPlane } from './im-doctor-plane.ts'
import { ImInteractionRouter } from './im-interaction-router.ts'
import { getImDoctorPlane } from './im-doctor-plane-singleton.ts'
import type { ImInboundEnvelope, ImTransportInboundEvent } from './im-inbound-types.ts'
import {
  coreEnvelopeFromImInboundEnvelope,
  deriveDefaultImPersonId,
  normalizeImTransportInboundEvent
} from './im-envelope-normalizer.ts'
import { buildImRoutingKey, resolveDefaultImSessionScope } from './im-session-router.ts'

export type ImRuntimeScheduledResult = {
  action: 'scheduled'
  conversationId: string
  binding: ConversationBinding
  message: ConversationMessage | null
  run: AgentRun
  scheduleDecision: RunScheduleDecision
  imTraceId: string
}

export type ImRuntimeDedupedResult = {
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

export type ImRuntimeCommandHandledResult = {
  action: 'command_handled'
  conversationId: string
  binding: ConversationBinding
  message: ConversationMessage | null
  run: null
  scheduleDecision: null
  imTraceId: string
  command: Exclude<ImCommandResult, { handled: false }>['command']
  deliveryId: string
}

export type ImRuntimeInteractionHandledResult = {
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

export type ImRuntimeInboundResult =
  | ImRuntimeScheduledResult
  | ImRuntimeDedupedResult
  | ImRuntimeCommandHandledResult
  | ImRuntimeInteractionHandledResult

export type ImRuntimeCoordinatorHandleOptions = {
  appendInboundMessage?: boolean
}

export type ImRuntimeCoordinatorDeps = {
  core: Pick<
    CoreCommandService & CoreQueryService,
    | 'resolveConversationForEnvelope'
    | 'appendInboundEnvelope'
    | 'requestRun'
    | 'requestDelivery'
    | 'listPendingInteractions'
    | 'getDeliveryRecords'
    | 'getAgentProfile'
    | 'updateConversation'
    | 'pruneConversationRuntimeAfter'
    | 'answerInteraction'
  >
  runScheduler: RunScheduler
  resolveAgentProfileId: () => string
  resolvePersonId?: (envelope: ImInboundEnvelope) => string | null
  dedupeStore?: ImDedupeStore
  commandRouter?: ImCommandRouter
  modelCatalog?: ImModelCatalog
  interactionRouter?: ImInteractionRouter
  doctorPlane?: ImDoctorPlane
}

export class ImRuntimeCoordinator {
  private readonly core: ImRuntimeCoordinatorDeps['core']
  private readonly runScheduler: RunScheduler
  private readonly resolveAgentProfileId: () => string
  private readonly resolvePersonId?: (envelope: ImInboundEnvelope) => string | null
  private readonly dedupeStore: ImDedupeStore
  private readonly commandRouter: ImCommandRouter
  private readonly interactionRouter: ImInteractionRouter
  private readonly doctorPlane: ImDoctorPlane

  constructor(deps: ImRuntimeCoordinatorDeps) {
    this.core = deps.core
    this.runScheduler = deps.runScheduler
    this.resolveAgentProfileId = deps.resolveAgentProfileId
    this.resolvePersonId = deps.resolvePersonId
    this.dedupeStore = deps.dedupeStore ?? new ImDedupeStore()
    this.doctorPlane = deps.doctorPlane ?? getImDoctorPlane()
    this.commandRouter =
      deps.commandRouter ??
      new ImCommandRouter({
        core: this.core,
        runScheduler: this.runScheduler,
        doctorPlane: this.doctorPlane,
        modelCatalog: deps.modelCatalog
      })
    this.interactionRouter =
      deps.interactionRouter ??
      new ImInteractionRouter({
        core: this.core,
        doctorPlane: this.doctorPlane
      })
  }

  ingestTransportEvent(
    event: ImTransportInboundEvent,
    options: ImRuntimeCoordinatorHandleOptions = {}
  ): ImRuntimeInboundResult {
    const preTraceId = ['im', event.transportId, event.accountId, event.message.id].join(':')
    this.doctorPlane.recordStep({
      imTraceId: preTraceId,
      step: 'transport_received',
      status: 'pass',
      message: `Received ${event.message.type} message from ${event.transportId}:${event.accountId}`,
      detail: {
        transportId: event.transportId,
        accountId: event.accountId,
        eventId: event.id,
        messageId: event.message.id
      }
    })
    const imEnvelope = normalizeImTransportInboundEvent(event)
    this.doctorPlane.recordStep({
      imTraceId: imEnvelope.imTraceId,
      step: 'normalized',
      status: 'pass',
      message: `Normalized IM event to routing key ${imEnvelope.routing.routingKey}`,
      detail: {
        dedupeKey: imEnvelope.dedupeKey,
        routingKey: imEnvelope.routing.routingKey,
        scope: imEnvelope.routing.scope
      }
    })
    const dedupeDecision = this.checkDedupe(imEnvelope.imTraceId, imEnvelope.dedupeKey)
    if (!dedupeDecision.accepted) {
      return {
        action: 'deduped',
        conversationId: null,
        binding: null,
        message: null,
        run: null,
        scheduleDecision: null,
        imTraceId: imEnvelope.imTraceId,
        dedupeKey: imEnvelope.dedupeKey,
        existingTraceId: dedupeDecision.existingTraceId
      }
    }
    const personId = this.resolvePersonId?.(imEnvelope) ?? deriveDefaultImPersonId(imEnvelope)
    this.doctorPlane.recordStep({
      imTraceId: imEnvelope.imTraceId,
      step: 'identity_resolved',
      status: 'pass',
      message: `Resolved person ${personId}`,
      detail: {
        personId,
        externalUserId: imEnvelope.sender.externalUserId,
        unionId: imEnvelope.sender.unionId ?? null
      }
    })
    return this.ingestCoreEnvelope(
      coreEnvelopeFromImInboundEnvelope(imEnvelope, { personId }),
      options,
      { dedupeChecked: true }
    )
  }

  ingestCoreEnvelope(
    envelope: InboundEnvelope,
    options: ImRuntimeCoordinatorHandleOptions = {},
    internal: { dedupeChecked?: boolean } = {}
  ): ImRuntimeInboundResult {
    const sourceKind = deriveConversationSourceKind(envelope.transportId)
    if (sourceKind !== 'im') {
      throw new Error(`Transport ${envelope.transportId} is not an IM transport`)
    }

    const normalizedEnvelope = this.normalizeCoreImEnvelope(envelope)
    const imTraceId = normalizedEnvelope.imTraceId ?? normalizedEnvelope.envelopeId
    if (!internal.dedupeChecked) {
      const dedupeDecision = this.checkDedupe(
        imTraceId,
        normalizedEnvelope.dedupeKey ?? normalizedEnvelope.envelopeId
      )
      if (!dedupeDecision.accepted) {
        return {
          action: 'deduped',
          conversationId: null,
          binding: null,
          message: null,
          run: null,
          scheduleDecision: null,
          imTraceId,
          dedupeKey: dedupeDecision.dedupeKey,
          existingTraceId: dedupeDecision.existingTraceId
        }
      }
    }
    const resolved = this.core.resolveConversationForEnvelope({
      agentProfileId: this.resolveAgentProfileId(),
      envelope: normalizedEnvelope,
      title: normalizedEnvelope.externalUserDisplayName ?? normalizedEnvelope.externalChatId,
      desktopVisibilityMode: 'readonly'
    })
    this.doctorPlane.recordStep({
      imTraceId,
      step: 'conversation_resolved',
      status: 'pass',
      message: `Resolved conversation ${resolved.conversation.id}`,
      detail: {
        conversationId: resolved.conversation.id,
        bindingId: resolved.binding.id,
        routingKey: resolved.binding.routingKey,
        createdConversation: resolved.createdConversation,
        createdBinding: resolved.createdBinding
      }
    })
    const shouldAppendInboundMessage = options.appendInboundMessage ?? true
    const message = shouldAppendInboundMessage
      ? this.core.appendInboundEnvelope({
          conversationId: resolved.conversation.id,
          bindingId: resolved.binding.id,
          envelope: normalizedEnvelope
        })
      : null
    const commandResult = this.commandRouter.tryHandle({
      imTraceId,
      envelope: normalizedEnvelope,
      conversation: resolved.conversation,
      binding: resolved.binding
    })
    if (commandResult.handled) {
      return {
        action: 'command_handled',
        conversationId: resolved.conversation.id,
        binding: resolved.binding,
        message,
        run: null,
        scheduleDecision: null,
        imTraceId,
        command: commandResult.command,
        deliveryId: commandResult.delivery.id
      }
    }
    const interactionResult = this.interactionRouter.tryHandle({
      imTraceId,
      envelope: normalizedEnvelope,
      conversation: resolved.conversation,
      binding: resolved.binding
    })
    if (interactionResult.handled) {
      return {
        action: 'interaction_handled',
        conversationId: resolved.conversation.id,
        binding: resolved.binding,
        message,
        run: null,
        scheduleDecision: null,
        imTraceId,
        interactionId: interactionResult.interaction.id,
        deliveryId: interactionResult.delivery.id
      }
    }
    const run = this.core.requestRun({
      conversationId: resolved.conversation.id,
      triggerKind: 'transport_message',
      traceId: imTraceId
    })
    const scheduleDecision = this.runScheduler.schedule(run)
    this.doctorPlane.recordStep({
      imTraceId,
      step: 'run_decided',
      status:
        scheduleDecision.action === 'start' || scheduleDecision.action === 'queued'
          ? 'pass'
          : 'warn',
      message: `Run ${run.id} ${scheduleDecision.action}`,
      detail: {
        runId: run.id,
        conversationId: run.conversationId,
        action: scheduleDecision.action
      }
    })

    return {
      action: 'scheduled',
      conversationId: resolved.conversation.id,
      binding: resolved.binding,
      message,
      run,
      scheduleDecision,
      imTraceId
    }
  }

  private checkDedupe(imTraceId: string, dedupeKey: string): ImDedupeDecision {
    const decision = this.dedupeStore.accept({ imTraceId, dedupeKey })
    this.doctorPlane.recordStep({
      imTraceId,
      step: 'dedupe_checked',
      status: decision.accepted ? 'pass' : 'warn',
      message: decision.accepted
        ? `Accepted inbound dedupe key ${dedupeKey}`
        : `Ignored duplicate inbound dedupe key ${dedupeKey}`,
      detail: decision
    })
    return decision
  }

  private normalizeCoreImEnvelope(envelope: InboundEnvelope): InboundEnvelope {
    const imTraceId =
      envelope.imTraceId ??
      ['im', envelope.transportId, envelope.transportAccountId, envelope.externalMessageId].join(
        ':'
      )
    const dedupeKey =
      envelope.dedupeKey ??
      [envelope.transportId, envelope.transportAccountId, envelope.externalMessageId].join(':')
    const scope =
      envelope.sessionScope ??
      resolveDefaultImSessionScope({
        chatKind: envelope.channelKind === 'dm' ? 'dm' : 'group',
        threadId: envelope.externalThreadId ?? null
      })
    const senderId = envelope.externalUserId ?? envelope.externalChatId
    const routingKey =
      envelope.routingKey ??
      buildImRoutingKey({
        transportId: envelope.transportId,
        accountId: envelope.transportAccountId,
        chatId: envelope.externalChatId,
        senderId,
        threadId: envelope.externalThreadId ?? null,
        scope
      })
    const tenantId = envelope.tenantId ?? envelope.transportAccountId
    const personId =
      envelope.personId ??
      ['im-person', envelope.transportId, tenantId, senderId]
        .map((part) => encodeURIComponent(part))
        .join(':')

    return {
      ...envelope,
      imTraceId,
      dedupeKey,
      sessionScope: scope,
      sharedMultiUser:
        envelope.sharedMultiUser ?? (scope === 'group_shared' || scope === 'thread_shared'),
      personId,
      tenantId,
      messageType: envelope.messageType ?? 'text',
      routingKey
    }
  }
}
