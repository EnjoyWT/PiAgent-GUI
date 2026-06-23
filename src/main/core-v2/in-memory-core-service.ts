import { generateId } from '../../shared/id.ts'
import type { ThreadPlanState } from '../../shared/thread-plan.ts'
import type {
  AgentProfile,
  AgentRun,
  AnswerInteractionInput,
  AppendInboundEnvelopeInput,
  CancelInteractionInput,
  Conversation,
  ConversationBinding,
  ConversationBindingMatch,
  ConversationListItem,
  ConversationMessagePage,
  ConversationMessagePageCursor,
  ConversationMessage,
  ConversationSearchInput,
  ConversationSearchResult,
  ConversationSearchResultItem,
  CoreCommandService,
  CoreQueryService,
  DeleteConversationInput,
  ConversationWindowProjection,
  DeliveryRecord,
  DeleteConversationMessageInput,
  EventLogEntry,
  EventLogAggregateKey,
  InteractionCheckpoint,
  ListAllConversationMessagesInput,
  ListAllConversationMessagesResult,
  ListConversationMessagesInput,
  ListConversationMessagesResult,
  ListConversationsInput,
  ListConversationsResult,
  PruneConversationRuntimeAfterInput,
  RequestDeliveryInput,
  RequestInteractionInput,
  RequestRunInput,
  ResolveConversationForEnvelopeInput,
  ResolveConversationForEnvelopeResult,
  ResolveConversationForTargetInput,
  UpdateDeliveryStatusInput,
  UpdateConversationInput,
  UpsertAgentRunInput,
  UpsertConversationMessageInput,
  UpsertEventLogEntryInput,
  UpsertThreadPlanStateInput,
  UpsertAgentProfileInput
} from './domain.ts'
import {
  createExecutionSnapshot,
  deriveBindingRoutingKey,
  deriveBindingRoutingKeyFromTarget,
  deriveConversationSourceKind,
  mergeExecutionPolicy
} from './domain.ts'
import { normalizeCoreTimestamp } from './time.ts'
import {
  claimTransportSetupQrModelNotificationInProjectionTurns,
  normalizeProjectionTurns,
  updateTransportSetupQrInProjectionTurns,
  type AgentRunProjectionPayload,
  type ClaimAgentRunProjectionTransportSetupQrModelNotificationInput,
  type ClaimedAgentRunProjectionTransportSetupQrModelNotification,
  type UpdateAgentRunProjectionTransportSetupQrInput
} from './agent-run-projections.ts'

const asCoreTimestamp = (value?: string | number | Date | null): string => {
  return normalizeCoreTimestamp(value)
}

const createConversationTitle = (input: {
  title?: string | null
  externalUserDisplayName?: string | null
  externalChatId: string
  transportId: string
  transportAccountId: string
}): string =>
  input.title?.trim() ||
  input.externalUserDisplayName?.trim() ||
  input.externalChatId ||
  `${input.transportId}:${input.transportAccountId}`

type CoreState = {
  agentProfiles: Map<string, AgentProfile>
  conversations: Map<string, Conversation>
  bindings: Map<string, ConversationBinding>
  bindingByRoutingKey: Map<string, string>
  messagesByConversationId: Map<string, ConversationMessage[]>
  agentRuns: Map<string, AgentRun>
  agentRunProjections: Map<string, AgentRunProjectionPayload>
  interactions: Map<string, InteractionCheckpoint>
  deliveriesByConversationId: Map<string, DeliveryRecord[]>
  threadPlanStates: Map<string, ThreadPlanState>
  eventLog: EventLogEntry[]
  nextSequence: number
}

export class InMemoryCoreService implements CoreCommandService, CoreQueryService {
  private readonly state: CoreState = {
    agentProfiles: new Map(),
    conversations: new Map(),
    bindings: new Map(),
    bindingByRoutingKey: new Map(),
    messagesByConversationId: new Map(),
    agentRuns: new Map(),
    agentRunProjections: new Map(),
    interactions: new Map(),
    deliveriesByConversationId: new Map(),
    threadPlanStates: new Map(),
    eventLog: [],
    nextSequence: 0
  }

  upsertAgentProfile(input: UpsertAgentProfileInput): AgentProfile {
    const now = asCoreTimestamp()
    const id = input.id ?? generateId()
    const existing = this.state.agentProfiles.get(id)

    const profile: AgentProfile = {
      id,
      slug: input.slug,
      displayName: input.displayName,
      isDefault: input.isDefault ?? existing?.isDefault ?? false,
      defaultExecutionPolicy: {
        ...input.defaultExecutionPolicy,
        model: { ...input.defaultExecutionPolicy.model }
      },
      enabledTransportIds: [...(input.enabledTransportIds ?? existing?.enabledTransportIds ?? [])],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }

    if (profile.isDefault) {
      for (const current of this.state.agentProfiles.values()) {
        if (current.id !== profile.id && current.isDefault) {
          this.state.agentProfiles.set(current.id, { ...current, isDefault: false, updatedAt: now })
        }
      }
    }

    this.state.agentProfiles.set(profile.id, profile)
    this.appendEvent('agent_profile.upserted', 'agent_profile', profile.id, profile, now)
    return profile
  }

  resolveConversationForEnvelope(
    input: ResolveConversationForEnvelopeInput
  ): ResolveConversationForEnvelopeResult {
    const profile = this.requireAgentProfile(input.agentProfileId)
    const now = asCoreTimestamp(input.envelope.receivedAt)
    const routingKey = deriveBindingRoutingKey(input.envelope)
    const bindingId = this.state.bindingByRoutingKey.get(routingKey)
    const existingBinding = bindingId ? (this.state.bindings.get(bindingId) ?? null) : null

    if (existingBinding) {
      const conversation = this.requireConversation(existingBinding.conversationId)
      const updatedBinding: ConversationBinding = {
        ...existingBinding,
        lastExternalMessageId: input.envelope.externalMessageId,
        lastInboundTraceId: input.envelope.imTraceId ?? existingBinding.lastInboundTraceId ?? null,
        updatedAt: now
      }
      const updatedConversation: Conversation =
        conversation.workspaceId == null && input.workspaceId != null
          ? { ...conversation, workspaceId: input.workspaceId, updatedAt: now }
          : conversation

      this.state.bindings.set(updatedBinding.id, updatedBinding)
      this.state.conversations.set(updatedConversation.id, updatedConversation)
      this.appendEvent(
        'conversation.binding.resolved',
        'conversation_binding',
        existingBinding.id,
        {
          conversationId: updatedConversation.id,
          bindingId: existingBinding.id,
          routingKey
        },
        now
      )

      return {
        conversation: updatedConversation,
        binding: updatedBinding,
        createdConversation: false,
        createdBinding: false
      }
    }

    const conversationId = generateId()
    const newConversation: Conversation = {
      id: conversationId,
      agentProfileId: profile.id,
      workspaceId: input.workspaceId ?? null,
      title: createConversationTitle({
        title: input.title,
        externalUserDisplayName: input.envelope.externalUserDisplayName,
        externalChatId: input.envelope.externalChatId,
        transportId: input.envelope.transportId,
        transportAccountId: input.envelope.transportAccountId
      }),
      status: 'active',
      activeBindingId: null,
      lastRunId: null,
      executionOverride: input.executionOverride ?? null,
      desktopVisibilityMode: input.desktopVisibilityMode ?? 'readonly',
      createdAt: now,
      updatedAt: now
    }

    const newBinding: ConversationBinding = {
      id: generateId(),
      conversationId,
      transportId: input.envelope.transportId,
      transportAccountId: input.envelope.transportAccountId,
      externalChatId: input.envelope.externalChatId,
      externalThreadId: input.envelope.externalThreadId ?? null,
      externalUserId: input.envelope.externalUserId ?? null,
      channelKind: input.envelope.channelKind,
      routingKey,
      sessionScope: input.envelope.sessionScope ?? null,
      sharedMultiUser: input.envelope.sharedMultiUser ?? false,
      personId: input.envelope.personId ?? null,
      tenantId: input.envelope.tenantId ?? null,
      lastExternalMessageId: input.envelope.externalMessageId,
      lastInboundTraceId: input.envelope.imTraceId ?? null,
      readonlyInDesktop: (input.desktopVisibilityMode ?? 'readonly') !== 'read_write',
      createdAt: now,
      updatedAt: now
    }

    const conversationWithBinding: Conversation = {
      ...newConversation,
      activeBindingId: newBinding.id
    }

    this.state.conversations.set(conversationWithBinding.id, conversationWithBinding)
    this.state.bindings.set(newBinding.id, newBinding)
    this.state.bindingByRoutingKey.set(routingKey, newBinding.id)
    this.state.messagesByConversationId.set(conversationWithBinding.id, [])

    this.appendEvent(
      'conversation.created',
      'conversation',
      conversationWithBinding.id,
      conversationWithBinding,
      now
    )
    this.appendEvent(
      'conversation.binding.created',
      'conversation_binding',
      newBinding.id,
      newBinding,
      now
    )

    return {
      conversation: conversationWithBinding,
      binding: newBinding,
      createdConversation: true,
      createdBinding: true
    }
  }

  resolveConversationForTarget(
    input: ResolveConversationForTargetInput
  ): ResolveConversationForEnvelopeResult {
    this.requireAgentProfile(input.agentProfileId)

    const now = asCoreTimestamp()
    const routingKey = deriveBindingRoutingKeyFromTarget(input.target)
    const existingBindingId = this.state.bindingByRoutingKey.get(routingKey)
    const existingBinding = existingBindingId
      ? (this.state.bindings.get(existingBindingId) ?? null)
      : null

    if (existingBinding) {
      const existingConversation = this.requireConversation(existingBinding.conversationId)
      if (input.conversationId && existingConversation.id !== input.conversationId) {
        throw new Error(
          `Route ${routingKey} is already attached to conversation ${existingConversation.id}`
        )
      }

      const updatedConversation =
        input.setAsActiveBinding && existingConversation.activeBindingId !== existingBinding.id
          ? {
              ...existingConversation,
              activeBindingId: existingBinding.id,
              updatedAt: now
            }
          : existingConversation

      this.state.conversations.set(updatedConversation.id, updatedConversation)
      this.appendEvent(
        'conversation.binding.resolved',
        'conversation_binding',
        existingBinding.id,
        {
          conversationId: updatedConversation.id,
          bindingId: existingBinding.id,
          routingKey
        },
        now
      )

      return {
        conversation: updatedConversation,
        binding: existingBinding,
        createdConversation: false,
        createdBinding: false
      }
    }

    if (input.conversationId) {
      const conversation = this.requireConversation(input.conversationId)
      const binding: ConversationBinding = {
        id: generateId(),
        conversationId: conversation.id,
        transportId: input.target.transportId,
        transportAccountId: input.target.transportAccountId,
        externalChatId: input.target.externalChatId,
        externalThreadId: input.target.externalThreadId ?? null,
        externalUserId: input.target.externalUserId ?? null,
        channelKind: input.target.channelKind,
        routingKey,
        sessionScope: input.target.sessionScope ?? null,
        sharedMultiUser: input.target.sharedMultiUser ?? false,
        personId: input.target.personId ?? null,
        tenantId: input.target.tenantId ?? null,
        lastExternalMessageId: null,
        lastInboundTraceId: null,
        readonlyInDesktop: conversation.desktopVisibilityMode !== 'read_write',
        createdAt: now,
        updatedAt: now
      }

      const finalizedConversation: Conversation = {
        ...conversation,
        workspaceId:
          conversation.workspaceId == null && input.workspaceId !== undefined
            ? input.workspaceId
            : conversation.workspaceId,
        activeBindingId:
          input.setAsActiveBinding || !conversation.activeBindingId
            ? binding.id
            : conversation.activeBindingId,
        updatedAt: now
      }

      this.state.bindings.set(binding.id, binding)
      this.state.bindingByRoutingKey.set(routingKey, binding.id)
      this.state.conversations.set(conversation.id, finalizedConversation)

      this.appendEvent(
        'conversation.binding.created',
        'conversation_binding',
        binding.id,
        binding,
        now
      )

      return {
        conversation: finalizedConversation,
        binding,
        createdConversation: false,
        createdBinding: true
      }
    }

    const conversationId = generateId()
    const bindingId = generateId()
    const conversation: Conversation = {
      id: conversationId,
      agentProfileId: input.agentProfileId,
      workspaceId: input.workspaceId ?? null,
      title: createConversationTitle({
        title: input.title,
        externalUserDisplayName: input.target.externalUserDisplayName,
        externalChatId: input.target.externalChatId,
        transportId: input.target.transportId,
        transportAccountId: input.target.transportAccountId
      }),
      status: 'active',
      activeBindingId: bindingId,
      lastRunId: null,
      executionOverride: input.executionOverride ?? null,
      desktopVisibilityMode: input.desktopVisibilityMode ?? 'readonly',
      createdAt: now,
      updatedAt: now
    }

    const binding: ConversationBinding = {
      id: bindingId,
      conversationId,
      transportId: input.target.transportId,
      transportAccountId: input.target.transportAccountId,
      externalChatId: input.target.externalChatId,
      externalThreadId: input.target.externalThreadId ?? null,
      externalUserId: input.target.externalUserId ?? null,
      channelKind: input.target.channelKind,
      routingKey,
      sessionScope: input.target.sessionScope ?? null,
      sharedMultiUser: input.target.sharedMultiUser ?? false,
      personId: input.target.personId ?? null,
      tenantId: input.target.tenantId ?? null,
      lastExternalMessageId: null,
      lastInboundTraceId: null,
      readonlyInDesktop: (input.desktopVisibilityMode ?? 'readonly') !== 'read_write',
      createdAt: now,
      updatedAt: now
    }

    this.state.conversations.set(conversation.id, conversation)
    this.state.bindings.set(binding.id, binding)
    this.state.bindingByRoutingKey.set(routingKey, binding.id)
    this.state.messagesByConversationId.set(conversation.id, [])

    this.appendEvent('conversation.created', 'conversation', conversation.id, conversation, now)
    this.appendEvent(
      'conversation.binding.created',
      'conversation_binding',
      binding.id,
      binding,
      now
    )

    return {
      conversation,
      binding,
      createdConversation: true,
      createdBinding: true
    }
  }

  appendInboundEnvelope(input: AppendInboundEnvelopeInput): ConversationMessage {
    const conversation = this.requireConversation(input.conversationId)
    const binding = this.requireBinding(input.bindingId)
    const createdAt = asCoreTimestamp(input.envelope.receivedAt)
    const message: ConversationMessage = {
      id: generateId(),
      conversationId: conversation.id,
      bindingId: binding.id,
      externalMessageId: input.envelope.externalMessageId,
      role: 'user',
      direction: 'inbound',
      text: input.envelope.text ?? null,
      payloadJson:
        input.envelope.attachments && input.envelope.attachments.length > 0
          ? JSON.stringify({ attachments: input.envelope.attachments })
          : null,
      createdAt
    }

    const messages = this.state.messagesByConversationId.get(conversation.id) ?? []
    messages.push(message)
    this.state.messagesByConversationId.set(conversation.id, messages)
    this.state.bindings.set(binding.id, {
      ...binding,
      lastExternalMessageId: input.envelope.externalMessageId,
      lastInboundTraceId: input.envelope.imTraceId ?? null,
      updatedAt: createdAt
    })
    this.appendEvent(
      'transport.message.received',
      'conversation_message',
      message.id,
      {
        conversationId: conversation.id,
        bindingId: binding.id,
        envelopeId: input.envelope.envelopeId,
        externalMessageId: input.envelope.externalMessageId
      },
      createdAt
    )

    return message
  }

  upsertConversationMessage(input: UpsertConversationMessageInput): ConversationMessage {
    const conversation = this.requireConversation(input.conversationId)
    if (input.bindingId) this.requireBinding(input.bindingId)

    const createdAt = asCoreTimestamp(input.createdAt)
    const existing =
      input.externalMessageId != null
        ? ((this.state.messagesByConversationId.get(conversation.id) ?? []).find(
            (item) => item.externalMessageId === input.externalMessageId
          ) ?? null)
        : null

    if (existing) {
      const updated: ConversationMessage = {
        ...existing,
        bindingId: input.bindingId ?? existing.bindingId ?? null,
        role: input.role,
        direction: input.direction,
        text: input.text ?? null,
        payloadJson: input.payload == null ? null : JSON.stringify(input.payload),
        createdAt
      }
      const messages = (this.state.messagesByConversationId.get(conversation.id) ?? []).map(
        (item) => (item.id === updated.id ? updated : item)
      )
      this.state.messagesByConversationId.set(conversation.id, messages)
      this.state.conversations.set(conversation.id, { ...conversation, updatedAt: createdAt })
      return updated
    }

    const message: ConversationMessage = {
      id: generateId(),
      conversationId: conversation.id,
      bindingId: input.bindingId ?? null,
      externalMessageId: input.externalMessageId ?? null,
      role: input.role,
      direction: input.direction,
      text: input.text ?? null,
      payloadJson: input.payload == null ? null : JSON.stringify(input.payload),
      createdAt
    }

    const messages = this.state.messagesByConversationId.get(conversation.id) ?? []
    messages.push(message)
    this.state.messagesByConversationId.set(conversation.id, messages)
    this.state.conversations.set(conversation.id, { ...conversation, updatedAt: createdAt })
    return message
  }

  updateConversation(input: UpdateConversationInput): Conversation {
    const existing = this.requireConversation(input.conversationId)
    if (input.activeBindingId !== undefined && input.activeBindingId !== null) {
      const binding = this.requireBinding(input.activeBindingId)
      if (binding.conversationId !== existing.id) {
        throw new Error(`Binding ${binding.id} does not belong to conversation ${existing.id}`)
      }
    }
    const updated: Conversation = {
      ...existing,
      title: input.title !== undefined ? input.title : existing.title,
      workspaceId: input.workspaceId !== undefined ? input.workspaceId : existing.workspaceId,
      executionOverride:
        input.executionOverride !== undefined
          ? input.executionOverride
          : existing.executionOverride,
      desktopVisibilityMode: input.desktopVisibilityMode ?? existing.desktopVisibilityMode,
      activeBindingId:
        input.activeBindingId !== undefined ? input.activeBindingId : existing.activeBindingId,
      updatedAt: asCoreTimestamp()
    }

    this.state.conversations.set(updated.id, updated)
    return updated
  }

  requestRun(input: RequestRunInput): AgentRun {
    const conversation = this.requireConversation(input.conversationId)
    const profile = this.requireAgentProfile(conversation.agentProfileId)
    const now = asCoreTimestamp()
    const requestedExecutionPolicy = mergeExecutionPolicy(
      profile.defaultExecutionPolicy,
      conversation.executionOverride ?? null,
      input.triggerExecutionOverride ?? null
    )

    const run: AgentRun = {
      id: generateId(),
      conversationId: conversation.id,
      instanceId: null,
      triggerKind: input.triggerKind,
      requestedExecutionPolicy,
      effectiveExecutionSnapshot: createExecutionSnapshot(requestedExecutionPolicy, now),
      status: 'requested',
      traceId: input.traceId ?? generateId(),
      startedAt: now,
      endedAt: null
    }

    this.state.agentRuns.set(run.id, run)
    this.state.conversations.set(conversation.id, {
      ...conversation,
      lastRunId: run.id,
      updatedAt: now
    })
    this.appendEvent('agent.run.requested', 'agent_run', run.id, run, now)
    return run
  }

  upsertAgentRun(input: UpsertAgentRunInput): AgentRun {
    const conversation = this.requireConversation(input.conversationId)
    const startedAt = asCoreTimestamp(input.startedAt)
    const endedAt = input.endedAt == null ? null : asCoreTimestamp(input.endedAt)
    const existing = this.state.agentRuns.get(input.id) ?? null

    const run: AgentRun = {
      id: input.id,
      conversationId: conversation.id,
      instanceId: input.instanceId ?? existing?.instanceId ?? null,
      triggerKind: input.triggerKind,
      requestedExecutionPolicy: {
        ...input.requestedExecutionPolicy,
        model: { ...input.requestedExecutionPolicy.model }
      },
      effectiveExecutionSnapshot: {
        ...input.effectiveExecutionSnapshot,
        model: { ...input.effectiveExecutionSnapshot.model }
      },
      status: input.status,
      traceId: input.traceId,
      startedAt,
      endedAt
    }

    this.state.agentRuns.set(run.id, run)
    this.state.conversations.set(conversation.id, {
      ...conversation,
      lastRunId:
        !conversation.lastRunId ||
        conversation.lastRunId === run.id ||
        startedAt >= (this.state.agentRuns.get(conversation.lastRunId)?.startedAt ?? '')
          ? run.id
          : conversation.lastRunId,
      updatedAt: endedAt ?? startedAt
    })

    const hasProjectionPayload =
      Object.prototype.hasOwnProperty.call(input, 'projectionText') ||
      Object.prototype.hasOwnProperty.call(input, 'projectionTurns')
    if (hasProjectionPayload) {
      this.state.agentRunProjections.set(run.id, {
        runId: run.id,
        projectionText: input.projectionText ?? '',
        projectionTurns: normalizeProjectionTurns(input.projectionTurns),
        updatedAt: endedAt ?? startedAt
      })
    }

    this.appendEvent(
      'agent.run.upserted',
      'agent_run',
      run.id,
      {
        run,
        projectionStored: hasProjectionPayload
      },
      endedAt ?? startedAt,
      {
        traceId: run.traceId,
        correlationId: run.id
      }
    )

    return run
  }

  requestInteraction(input: RequestInteractionInput): InteractionCheckpoint {
    const conversation = this.requireConversation(input.conversationId)
    const now = asCoreTimestamp()
    const checkpoint: InteractionCheckpoint = {
      id: generateId(),
      conversationId: conversation.id,
      runId: input.runId ?? null,
      kind: input.kind,
      prompt: input.prompt,
      status: 'pending',
      expectedBindingId: input.expectedBindingId ?? null,
      expectedPersonId: input.expectedPersonId ?? null,
      acceptedReplyModes: input.acceptedReplyModes ?? null,
      expiresAt: input.expiresAt == null ? null : asCoreTimestamp(input.expiresAt),
      createdAt: now,
      updatedAt: now
    }

    this.state.interactions.set(checkpoint.id, checkpoint)
    this.state.conversations.set(conversation.id, {
      ...conversation,
      updatedAt: now
    })
    this.appendEvent(
      'interaction.requested',
      'interaction_checkpoint',
      checkpoint.id,
      checkpoint,
      now
    )
    return checkpoint
  }

  answerInteraction(input: AnswerInteractionInput): InteractionCheckpoint {
    const existing = this.state.interactions.get(input.interactionId)
    if (!existing) {
      throw new Error(`Unknown InteractionCheckpoint: ${input.interactionId}`)
    }

    const updated: InteractionCheckpoint = {
      ...existing,
      status: 'answered',
      updatedAt: asCoreTimestamp(input.answeredAt)
    }

    this.state.interactions.set(updated.id, updated)
    this.appendEvent(
      'interaction.answered',
      'interaction_checkpoint',
      updated.id,
      updated,
      updated.updatedAt
    )
    return updated
  }

  cancelInteraction(input: CancelInteractionInput): InteractionCheckpoint {
    const existing = this.state.interactions.get(input.interactionId)
    if (!existing) {
      throw new Error(`Unknown InteractionCheckpoint: ${input.interactionId}`)
    }

    const updated: InteractionCheckpoint = {
      ...existing,
      status: 'cancelled',
      updatedAt: asCoreTimestamp(input.cancelledAt)
    }

    this.state.interactions.set(updated.id, updated)
    this.appendEvent(
      'interaction.cancelled',
      'interaction_checkpoint',
      updated.id,
      updated,
      updated.updatedAt
    )
    return updated
  }

  requestDelivery(input: RequestDeliveryInput): DeliveryRecord {
    this.requireConversation(input.conversationId)
    this.requireBinding(input.bindingId)

    const now = asCoreTimestamp()
    const record: DeliveryRecord = {
      id: generateId(),
      conversationId: input.conversationId,
      bindingId: input.bindingId,
      mode: input.mode,
      payloadJson: JSON.stringify(input.payload),
      status: 'requested',
      transportDeliveryMode: input.transportDeliveryMode ?? null,
      replyContext: input.replyContext ?? null,
      degradeMode: input.degradeMode ?? null,
      externalMessageId: input.externalMessageId ?? null,
      doctorTraceId: input.doctorTraceId ?? null,
      lastError: null,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now
    }

    const records = this.state.deliveriesByConversationId.get(input.conversationId) ?? []
    records.push(record)
    this.state.deliveriesByConversationId.set(input.conversationId, records)
    this.appendEvent('delivery.requested', 'delivery_record', record.id, record, now)
    return record
  }

  updateDeliveryStatus(input: UpdateDeliveryStatusInput): DeliveryRecord {
    const now = asCoreTimestamp(input.updatedAt)
    for (const [conversationId, records] of this.state.deliveriesByConversationId.entries()) {
      const existing = records.find((record) => record.id === input.deliveryId) ?? null
      if (!existing) continue

      const updated: DeliveryRecord = {
        ...existing,
        status: input.status,
        updatedAt: now
      }
      this.state.deliveriesByConversationId.set(
        conversationId,
        records.map((record) => (record.id === updated.id ? updated : record))
      )
      this.appendEvent(
        input.status === 'sent' ? 'delivery.sent' : 'delivery.failed',
        'delivery_record',
        updated.id,
        {
          delivery: updated,
          result: input.result ?? null
        },
        now,
        { correlationId: updated.id }
      )
      return updated
    }

    throw new Error(`Unknown DeliveryRecord: ${input.deliveryId}`)
  }

  deleteConversationMessage(input: DeleteConversationMessageInput): boolean {
    const messages = this.state.messagesByConversationId.get(input.conversationId) ?? []
    const existing =
      messages.find((message) => message.externalMessageId === input.externalMessageId) ?? null
    if (!existing) return false

    this.state.messagesByConversationId.set(
      input.conversationId,
      messages.filter((message) => message.id !== existing.id)
    )

    const conversation = this.state.conversations.get(input.conversationId)
    if (conversation) {
      this.state.conversations.set(input.conversationId, {
        ...conversation,
        updatedAt: asCoreTimestamp()
      })
    }

    this.appendEvent(
      'conversation.message.deleted',
      'conversation_message',
      existing.id,
      {
        conversationId: input.conversationId,
        externalMessageId: input.externalMessageId
      },
      asCoreTimestamp()
    )
    return true
  }

  pruneConversationRuntimeAfter(input: PruneConversationRuntimeAfterInput): void {
    const cutoff = asCoreTimestamp(input.cutoffCreatedAt)
    const messages = this.state.messagesByConversationId.get(input.conversationId) ?? []
    this.state.messagesByConversationId.set(
      input.conversationId,
      messages.filter((message) => message.createdAt <= cutoff)
    )

    for (const run of [...this.state.agentRuns.values()]) {
      if (run.conversationId !== input.conversationId) continue
      const runEndedAt = run.endedAt ?? run.startedAt
      if (run.startedAt <= cutoff && runEndedAt <= cutoff) continue
      this.state.agentRuns.delete(run.id)
      this.state.agentRunProjections.delete(run.id)
    }

    this.state.eventLog.splice(
      0,
      this.state.eventLog.length,
      ...this.state.eventLog.filter((entry) => {
        if (entry.aggregateType === 'agent_run') {
          const run = this.state.agentRuns.get(entry.aggregateId)
          return Boolean(run) || entry.createdAt <= cutoff
        }
        if (entry.aggregateType === 'conversation' && entry.aggregateId === input.conversationId) {
          return entry.createdAt <= cutoff
        }
        return true
      })
    )

    for (const [threadId, state] of [...this.state.threadPlanStates.entries()]) {
      if (state.conversationId === input.conversationId && state.updatedAt > cutoff) {
        this.state.threadPlanStates.delete(threadId)
      }
    }

    const conversation = this.state.conversations.get(input.conversationId)
    if (conversation) {
      const latestRun =
        [...this.state.agentRuns.values()]
          .filter((run) => run.conversationId === input.conversationId)
          .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null
      this.state.conversations.set(input.conversationId, {
        ...conversation,
        lastRunId: latestRun?.id ?? null,
        updatedAt: latestRun?.startedAt ?? cutoff
      })
    }

    this.appendEvent(
      'conversation.runtime.pruned',
      'conversation',
      input.conversationId,
      {
        conversationId: input.conversationId,
        cutoffCreatedAt: cutoff
      },
      cutoff
    )
  }

  deleteConversation(input: DeleteConversationInput): boolean {
    const existing = this.state.conversations.get(input.conversationId)
    if (!existing) return false

    this.state.conversations.delete(input.conversationId)
    this.state.messagesByConversationId.delete(input.conversationId)
    this.state.deliveriesByConversationId.delete(input.conversationId)

    const bindingIds = [...this.state.bindings.values()]
      .filter((binding) => binding.conversationId === input.conversationId)
      .map((binding) => binding.id)
    for (const bindingId of bindingIds) {
      const binding = this.state.bindings.get(bindingId)
      if (binding) {
        this.state.bindingByRoutingKey.delete(binding.routingKey)
      }
      this.state.bindings.delete(bindingId)
    }

    for (const run of [...this.state.agentRuns.values()]) {
      if (run.conversationId === input.conversationId) {
        this.state.agentRuns.delete(run.id)
        this.state.agentRunProjections.delete(run.id)
      }
    }

    for (const interaction of [...this.state.interactions.values()]) {
      if (interaction.conversationId === input.conversationId) {
        this.state.interactions.delete(interaction.id)
      }
    }

    for (const [threadId, state] of [...this.state.threadPlanStates.entries()]) {
      if (state.conversationId === input.conversationId) {
        this.state.threadPlanStates.delete(threadId)
      }
    }

    this.appendEvent(
      'conversation.deleted',
      'conversation',
      input.conversationId,
      {
        conversationId: input.conversationId
      },
      asCoreTimestamp()
    )
    return true
  }

  pruneOldEventLog(retentionDays: number = 30): number {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    const cutoff = cutoffDate.toISOString()

    const beforeCount = this.state.eventLog.length
    this.state.eventLog = this.state.eventLog.filter((entry) => entry.createdAt >= cutoff)
    return beforeCount - this.state.eventLog.length
  }

  getEventLogStats(): { totalCount: number; oldestEntry: string | null; newestEntry: string | null } {
    if (this.state.eventLog.length === 0) {
      return { totalCount: 0, oldestEntry: null, newestEntry: null }
    }

    const sorted = [...this.state.eventLog].sort((a, b) => a.sequence - b.sequence)
    return {
      totalCount: sorted.length,
      oldestEntry: sorted[0]?.createdAt ?? null,
      newestEntry: sorted[sorted.length - 1]?.createdAt ?? null
    }
  }

  upsertThreadPlanState(input: UpsertThreadPlanStateInput): ThreadPlanState {
    const threadId = String(input.threadId ?? '').trim()
    if (!threadId) throw new Error('threadId is required')
    const existing = this.state.threadPlanStates.get(threadId)
    const state: ThreadPlanState = {
      threadId,
      conversationId: String(input.conversationId ?? '').trim() || null,
      revision: (existing?.revision ?? 0) + 1,
      activeRunId: input.activeRunId ?? null,
      sourceToolCallId: input.sourceToolCallId ?? null,
      items: input.items.map((item) => ({ ...item })),
      closed: input.closed ?? false,
      updatedAt: asCoreTimestamp(input.updatedAt)
    }
    this.state.threadPlanStates.set(threadId, state)
    return state
  }

  clearThreadPlanState(threadId: string): boolean {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) return false
    return this.state.threadPlanStates.delete(normalizedThreadId)
  }

  upsertEventLogEntry(input: UpsertEventLogEntryInput): EventLogEntry {
    const createdAt = asCoreTimestamp(input.createdAt)
    const existing = input.id
      ? (this.state.eventLog.find((entry) => entry.id === input.id) ?? null)
      : null

    const entry: EventLogEntry = {
      id: input.id ?? generateId(),
      eventType: input.eventType,
      traceId: input.traceId,
      correlationId: input.correlationId,
      causationId: input.causationId ?? null,
      parentEventId: input.parentEventId ?? null,
      sequence: existing?.sequence ?? ++this.state.nextSequence,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payloadJson: JSON.stringify(input.payload),
      createdAt
    }

    if (existing) {
      const next = this.state.eventLog.map((current) => (current.id === entry.id ? entry : current))
      next.sort((left, right) => left.sequence - right.sequence)
      this.state.eventLog = next
      return entry
    }

    this.state.eventLog.push(entry)
    this.state.eventLog.sort((left, right) => left.sequence - right.sequence)
    return entry
  }

  getAgentProfile(id: string): AgentProfile | null {
    return this.state.agentProfiles.get(id) ?? null
  }

  getConversation(id: string): Conversation | null {
    return this.state.conversations.get(id) ?? null
  }

  getConversationBinding(id: string): ConversationBinding | null {
    return this.state.bindings.get(id) ?? null
  }

  listConversationBindings(options?: {
    conversationId?: string | null
    transportId?: string | null
    transportAccountId?: string | null
  }): ConversationBinding[] {
    return [...this.state.bindings.values()].filter((binding) => {
      if (options?.conversationId && binding.conversationId !== options.conversationId) return false
      if (options?.transportId && binding.transportId !== options.transportId) return false
      if (
        options?.transportAccountId &&
        binding.transportAccountId !== options.transportAccountId
      ) {
        return false
      }
      return true
    })
  }

  getConversationBindingByRoutingKey(routingKey: string): ConversationBinding | null {
    const bindingId = this.state.bindingByRoutingKey.get(routingKey)
    if (!bindingId) return null
    return this.state.bindings.get(bindingId) ?? null
  }

  getConversationByBindingRoutingKey(routingKey: string): ConversationBindingMatch | null {
    const binding = this.getConversationBindingByRoutingKey(routingKey)
    if (!binding) return null
    const conversation = this.state.conversations.get(binding.conversationId) ?? null
    if (!conversation) return null
    return { conversation, binding }
  }

  getConversationMessages(conversationId: string): ConversationMessage[] {
    return [...(this.state.messagesByConversationId.get(conversationId) ?? [])]
  }

  searchConversationMessages(input: ConversationSearchInput): ConversationSearchResult {
    const query = String(input.query ?? '').trim().toLowerCase()
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50), 100))
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))
    if (query.length < 2) return { items: [], total: 0, limit, offset, hasMore: false }

    const roles = new Set((input.roles ?? []).filter(Boolean))
    const items: ConversationSearchResultItem[] = []
    for (const [conversationId, messages] of this.state.messagesByConversationId.entries()) {
      const conversation = this.state.conversations.get(conversationId)
      if (!conversation) continue
      if (input.conversationId && input.conversationId !== conversationId) continue
      if (input.workspacePath && input.workspacePath !== conversation.workspaceId) continue
      const binding = conversation.activeBindingId
        ? this.state.bindings.get(conversation.activeBindingId)
        : [...this.state.bindings.values()].find((item) => item.conversationId === conversationId)
      const threadId = binding?.externalChatId ?? conversationId
      if (input.threadId && input.threadId !== threadId) continue
      for (const message of messages) {
        if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'tool') continue
        if (roles.size > 0 && !roles.has(message.role)) continue
        const text = message.text ?? ''
        const title = conversation.title ?? ''
        const haystack = `${title}\n${text}`.toLowerCase()
        if (!haystack.includes(query)) continue
        items.push({
          messageId: message.id,
          conversationId,
          threadId,
          role: message.role,
          title: conversation.title ?? null,
          workspacePath: conversation.workspaceId ?? null,
          text,
          snippet: text.length > 180 ? `${text.slice(0, 180)}…` : text,
          createdAt: message.createdAt,
          rank: title.toLowerCase().includes(query) ? -1 : 0
        })
      }
    }
    items.sort((left, right) => left.rank - right.rank || right.createdAt.localeCompare(left.createdAt))
    const page = items.slice(offset, offset + limit)
    return { items: page, total: items.length, limit, offset, hasMore: offset + page.length < items.length }
  }

  listConversationMessagesPage(
    conversationId: string,
    options?: { limit?: number; before?: ConversationMessagePageCursor | null }
  ): ConversationMessagePage {
    const normalizedLimit = Math.max(1, Math.min(Math.trunc(options?.limit ?? 50), 200))
    const before = options?.before ?? null
    const rows = [...(this.state.messagesByConversationId.get(conversationId) ?? [])]
    const filtered =
      before?.createdAt && before?.id
        ? rows.filter(
            (message) =>
              message.createdAt.localeCompare(before.createdAt) < 0 ||
              (message.createdAt === before.createdAt &&
                (message.externalMessageId ?? message.id).localeCompare(before.id) < 0)
          )
        : rows
    const hasMoreBefore = filtered.length > normalizedLimit
    const pageRows = hasMoreBefore ? filtered.slice(filtered.length - normalizedLimit) : filtered
    const oldest = pageRows[0] ?? null
    return {
      rows: pageRows,
      hasMoreBefore,
      nextBeforeCursor: oldest
        ? {
            createdAt: oldest.createdAt,
            id: oldest.externalMessageId ?? oldest.id
          }
        : null
    }
  }

  getAgentRun(id: string): AgentRun | null {
    return this.state.agentRuns.get(id) ?? null
  }

  listConversationRuns(conversationId: string): AgentRun[] {
    return [...this.state.agentRuns.values()]
      .filter((item) => item.conversationId === conversationId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  }

  listAgentRunsByIds(runIds: string[]): AgentRun[] {
    const normalizedIds = new Set(runIds.map((id) => String(id ?? '').trim()).filter(Boolean))
    return [...this.state.agentRuns.values()]
      .filter((item) => normalizedIds.has(item.id))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  }

  listAgentRunProjectionPayloadsByIds(runIds: string[]): AgentRunProjectionPayload[] {
    const normalizedIds = new Set(runIds.map((id) => String(id ?? '').trim()).filter(Boolean))
    return [...this.state.agentRunProjections.values()]
      .filter((item) => normalizedIds.has(item.runId))
      .map((item) => ({
        runId: item.runId,
        projectionText: item.projectionText,
        projectionTurns: normalizeProjectionTurns(item.projectionTurns),
        updatedAt: item.updatedAt
      }))
  }

  updateAgentRunProjectionTransportSetupQr(
    input: UpdateAgentRunProjectionTransportSetupQrInput
  ): number {
    const normalizedSessionId = String(input.sessionId ?? '').trim()
    if (!normalizedSessionId) return 0

    let changed = 0
    for (const [runId, payload] of this.state.agentRunProjections.entries()) {
      const update = updateTransportSetupQrInProjectionTurns(payload.projectionTurns, {
        ...input,
        sessionId: normalizedSessionId
      })
      if (!update.changed) continue
      this.state.agentRunProjections.set(runId, {
        ...payload,
        projectionTurns: update.projectionTurns,
        updatedAt: asCoreTimestamp(input.updatedAt)
      })
      changed += 1
    }
    return changed
  }

  claimAgentRunProjectionTransportSetupQrModelNotification(
    input: ClaimAgentRunProjectionTransportSetupQrModelNotificationInput
  ): ClaimedAgentRunProjectionTransportSetupQrModelNotification[] {
    const normalizedSessionId = String(input.sessionId ?? '').trim()
    if (!normalizedSessionId) return []

    const claims: ClaimedAgentRunProjectionTransportSetupQrModelNotification[] = []
    for (const [runId, payload] of this.state.agentRunProjections.entries()) {
      const run = this.state.agentRuns.get(runId)
      if (!run) continue
      const update = claimTransportSetupQrModelNotificationInProjectionTurns(
        payload.projectionTurns,
        {
          ...input,
          sessionId: normalizedSessionId
        }
      )
      if (!update.changed) continue
      this.state.agentRunProjections.set(runId, {
        ...payload,
        projectionTurns: update.projectionTurns,
        updatedAt: asCoreTimestamp(input.updatedAt)
      })
      claims.push({
        runId,
        conversationId: run.conversationId,
        sessionId: normalizedSessionId,
        status: input.status,
        transportId: input.transportId ?? null,
        accountId: input.accountId ?? null,
        methodId: input.methodId ?? null
      })
    }
    return claims
  }

  listPendingInteractions(conversationId?: string): InteractionCheckpoint[] {
    return [...this.state.interactions.values()].filter(
      (item) =>
        item.status === 'pending' && (!conversationId || item.conversationId === conversationId)
    )
  }

  getDeliveryRecords(conversationId: string): DeliveryRecord[] {
    return [...(this.state.deliveriesByConversationId.get(conversationId) ?? [])]
  }

  getDeliveryRecord(id: string): DeliveryRecord | null {
    for (const records of this.state.deliveriesByConversationId.values()) {
      const record = records.find((item) => item.id === id)
      if (record) return record
    }
    return null
  }

  listDeliveryRecords(status?: DeliveryRecord['status']): DeliveryRecord[] {
    const records = [...this.state.deliveriesByConversationId.values()].flat()
    return records
      .filter((record) => !status || record.status === status)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  getThreadPlanState(threadId: string): ThreadPlanState | null {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) return null
    const state = this.state.threadPlanStates.get(normalizedThreadId)
    return state ? { ...state, items: state.items.map((item) => ({ ...item })) } : null
  }

  listConversationWindows(
    sourceKind: 'local' | 'im' | 'all' = 'all'
  ): ConversationWindowProjection[] {
    const projections = [...this.state.conversations.values()].map((conversation) => {
      const binding =
        (conversation.activeBindingId
          ? (this.state.bindings.get(conversation.activeBindingId) ?? null)
          : null) ??
        [...this.state.bindings.values()].find((item) => item.conversationId === conversation.id) ??
        null
      const messages = this.state.messagesByConversationId.get(conversation.id) ?? []
      const firstMessage = messages[0] ?? null
      const lastMessage = messages.at(-1) ?? null
      const runs = [...this.state.agentRuns.values()]
        .filter((item) => item.conversationId === conversation.id)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      const firstRun = runs[0] ?? null
      const run = conversation.lastRunId
        ? (this.state.agentRuns.get(conversation.lastRunId) ?? null)
        : null
      const pendingInteraction =
        [...this.state.interactions.values()]
          .filter((item) => item.conversationId === conversation.id && item.status === 'pending')
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
      const primarySourceKind = binding
        ? deriveConversationSourceKind(binding.transportId)
        : 'local'

      return {
        conversationId: conversation.id,
        agentProfileId: conversation.agentProfileId,
        workspaceId: conversation.workspaceId ?? null,
        primarySourceKind,
        primaryTransportId: binding?.transportId ?? null,
        primaryTransportAccountId: binding?.transportAccountId ?? null,
        primaryExternalLabel:
          conversation.title ??
          binding?.externalUserId ??
          binding?.externalChatId ??
          conversation.id,
        desktopVisibilityMode: conversation.desktopVisibilityMode,
        startedAt:
          firstMessage?.createdAt && firstRun?.startedAt
            ? firstMessage.createdAt <= firstRun.startedAt
              ? firstMessage.createdAt
              : firstRun.startedAt
            : (firstMessage?.createdAt ?? firstRun?.startedAt ?? null),
        lastMessageAt: lastMessage?.createdAt ?? null,
        lastRunStatus: run?.status ?? null,
        pendingInteractionKind: pendingInteraction?.kind ?? null,
        unreadCount: 0,
        needsAttention: Boolean(pendingInteraction) || run?.status === 'failed',
        isPinned: false,
        updatedAt: conversation.updatedAt
      } satisfies ConversationWindowProjection
    })

    return projections
      .filter((item) => sourceKind === 'all' || item.primarySourceKind === sourceKind)
      .sort((left, right) =>
        (right.lastMessageAt ?? right.updatedAt).localeCompare(left.lastMessageAt ?? left.updatedAt)
      )
  }

  listEventLog(): EventLogEntry[] {
    return [...this.state.eventLog]
  }

  listEventLogByAggregateKeys(keys: EventLogAggregateKey[]): EventLogEntry[] {
    const normalizedKeys = new Set(
      keys
        .map((key) => {
          const aggregateType = String(key?.aggregateType ?? '').trim()
          const aggregateId = String(key?.aggregateId ?? '').trim()
          return aggregateType && aggregateId ? `${aggregateType}:${aggregateId}` : ''
        })
        .filter(Boolean)
    )
    return this.state.eventLog.filter((entry) =>
      normalizedKeys.has(`${entry.aggregateType}:${entry.aggregateId}`)
    )
  }

  private appendEvent(
    eventType: string,
    aggregateType: EventLogEntry['aggregateType'],
    aggregateId: string,
    payload: unknown,
    createdAt: string,
    options: {
      traceId?: string
      correlationId?: string
      causationId?: string | null
      parentEventId?: string | null
    } = {}
  ): void {
    const entry: EventLogEntry = {
      id: generateId(),
      eventType,
      traceId: options.traceId ?? generateId(),
      correlationId: options.correlationId ?? generateId(),
      causationId: options.causationId ?? null,
      parentEventId: options.parentEventId ?? null,
      sequence: ++this.state.nextSequence,
      aggregateType,
      aggregateId,
      payloadJson: JSON.stringify(payload),
      createdAt
    }

    this.state.eventLog.push(entry)
  }

  private requireAgentProfile(id: string): AgentProfile {
    const profile = this.state.agentProfiles.get(id)
    if (!profile) {
      throw new Error(`Unknown AgentProfile: ${id}`)
    }
    return profile
  }

  private requireConversation(id: string): Conversation {
    const conversation = this.state.conversations.get(id)
    if (!conversation) {
      throw new Error(`Unknown Conversation: ${id}`)
    }
    return conversation
  }

  private requireBinding(id: string): ConversationBinding {
    const binding = this.state.bindings.get(id)
    if (!binding) {
      throw new Error(`Unknown ConversationBinding: ${id}`)
    }
    return binding
  }

  // === Conversation Query Tool ===

  listConversations(input: ListConversationsInput): ListConversationsResult {
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 20), 200))
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))

    const items: ConversationListItem[] = []
    for (const conversation of this.state.conversations.values()) {
      // Filter by source kind
      if (input.sourceKind && input.sourceKind !== 'all') {
        const binding =
          (conversation.activeBindingId
            ? (this.state.bindings.get(conversation.activeBindingId) ?? null)
            : null) ??
          [...this.state.bindings.values()].find((item) => item.conversationId === conversation.id) ??
          null
        const sourceKind = binding
          ? deriveConversationSourceKind(binding.transportId)
          : 'local'
        if (sourceKind !== input.sourceKind) continue
      }

      // Filter by date range
      if (input.dateAfter && conversation.updatedAt < input.dateAfter) continue
      if (input.dateBefore && conversation.updatedAt > input.dateBefore) continue

      // Filter by query
      if (input.query) {
        const haystack = `${conversation.title ?? ''} ${conversation.id}`.toLowerCase()
        if (!haystack.includes(input.query.toLowerCase())) continue
      }

      const binding =
        (conversation.activeBindingId
          ? (this.state.bindings.get(conversation.activeBindingId) ?? null)
          : null) ??
        [...this.state.bindings.values()].find((item) => item.conversationId === conversation.id) ??
        null
      const messages = this.state.messagesByConversationId.get(conversation.id) ?? []
      const lastMessage = messages.at(-1) ?? null
      const lastRun = conversation.lastRunId
        ? (this.state.agentRuns.get(conversation.lastRunId) ?? null)
        : null

      const sourceKind = binding
        ? deriveConversationSourceKind(binding.transportId)
        : 'local'

      items.push({
        conversationId: conversation.id,
        title: conversation.title ?? null,
        status: conversation.status,
        sourceKind,
        primaryTransportId: binding?.transportId ?? null,
        primaryExternalLabel: (binding?.externalUserId as string | null | undefined) ??
          (binding?.externalChatId as string | null | undefined) ??
          (conversation.title as string | null | undefined) ??
          null,
        lastMessageAt: (lastMessage?.createdAt as string | null | undefined) ?? null,
        lastRunStatus: lastRun?.status ?? null,
        messageCount: messages.length,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
      })
    }

    items.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || right.conversationId.localeCompare(left.conversationId)
    )

    const page = items.slice(offset, offset + limit)
    return {
      items: page,
      total: items.length,
      limit,
      offset,
      hasMore: offset + page.length < items.length
    }
  }

  listConversationMessages(input: ListConversationMessagesInput): ListConversationMessagesResult {
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50), 200))
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))
    const messages = this.state.messagesByConversationId.get(input.conversationId) ?? []

    const filtered = messages.filter((msg) => {
      if (input.dateAfter && msg.createdAt < input.dateAfter) return false
      if (input.dateBefore && msg.createdAt > input.dateBefore) return false
      if (input.role && msg.role !== input.role) return false
      return true
    })

    // Sort by created_at ASC
    filtered.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    )

    const page = filtered.slice(offset, offset + limit)
    const conversation = this.state.conversations.get(input.conversationId)

    return {
      items: page.map((msg) => ({
        messageId: msg.id,
        conversationId: msg.conversationId,
        conversationTitle: conversation?.title ?? null,
        role: msg.role,
        text: msg.text ?? null,
        createdAt: msg.createdAt
      })),
      total: filtered.length,
      limit,
      offset,
      hasMore: offset + page.length < filtered.length
    }
  }

  listAllConversationMessages(input: ListAllConversationMessagesInput): ListAllConversationMessagesResult {
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50), 200))
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))

    const allMessages: Array<{
      message: ConversationMessage
      conversation: Conversation
    }> = []

    for (const [conversationId, messages] of this.state.messagesByConversationId.entries()) {
      // Filter by conversation if specified
      if (input.conversationId && input.conversationId !== conversationId) continue

      const conversation = this.state.conversations.get(conversationId)
      if (!conversation) continue

      for (const msg of messages) {
        if (input.dateAfter && msg.createdAt < input.dateAfter) continue
        if (input.dateBefore && msg.createdAt > input.dateBefore) continue
        if (input.role && msg.role !== input.role) continue

        allMessages.push({ message: msg, conversation })
      }
    }

    // Sort by created_at ASC
    allMessages.sort((left, right) =>
      left.message.createdAt.localeCompare(right.message.createdAt) ||
      left.message.id.localeCompare(right.message.id)
    )

    const page = allMessages.slice(offset, offset + limit)

    return {
      items: page.map(({ message: msg, conversation: conv }) => ({
        messageId: msg.id,
        conversationId: msg.conversationId,
        conversationTitle: conv.title ?? null,
        role: msg.role,
        text: msg.text ?? null,
        createdAt: msg.createdAt
      })),
      total: allMessages.length,
      limit,
      offset,
      hasMore: offset + page.length < allMessages.length
    }
  }
}
