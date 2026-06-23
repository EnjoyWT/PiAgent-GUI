import type { ThreadPlanState, UpsertThreadPlanStateInput } from '../../shared/thread-plan.ts'
export type { ThreadPlanState, UpsertThreadPlanStateInput } from '../../shared/thread-plan.ts'

export type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type ConversationStatus = 'active' | 'archived'

export type DesktopVisibilityMode = 'hidden' | 'readonly' | 'read_write'

export type ConversationChannelKind = 'dm' | 'group' | 'thread' | 'webhook' | 'api'

export type ConversationSessionScope =
  | 'dm'
  | 'group_shared'
  | 'group_per_member'
  | 'thread_shared'
  | 'thread_per_member'

export type ConversationSourceKind = 'local' | 'im'

export type AgentInstanceStatus =
  | 'idle'
  | 'acquiring'
  | 'running'
  | 'waiting_interaction'
  | 'draining'
  | 'disposed'
  | 'failed'

export type AgentRunStatus =
  | 'requested'
  | 'running'
  | 'waiting_interaction'
  | 'finished'
  | 'failed'
  | 'aborted'

export type InteractionKind =
  | 'approval'
  | 'option_select'
  | 'text_input'
  | 'multi_step_form'
  | 'file_upload_request'

export type DeliveryMode = 'send' | 'edit' | 'append' | 'typing' | 'upload'

export type TransportDeliveryMode = 'send_new' | 'reply' | 'edit' | 'thread_reply' | 'ephemeral'

export type EventAggregateType =
  | 'agent_profile'
  | 'conversation'
  | 'conversation_binding'
  | 'conversation_message'
  | 'agent_instance'
  | 'agent_run'
  | 'interaction_checkpoint'
  | 'delivery_record'
  | 'transport_account_setup'

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type MessageDirection = 'inbound' | 'outbound' | 'internal'

export type ModelSelection = {
  providerId: string
  modelId: string
  reasoningLevel?: ReasoningLevel
}

export type ConversationExecutionOverride = {
  model?: Partial<ModelSelection>
  toolProfileId?: string | null
  sandboxPolicyId?: string | null
}

export type ExecutionPolicy = {
  model: ModelSelection
  contextEngineId: string
  memoryProviderId: string
  toolProfileId?: string | null
  sandboxPolicyId?: string | null
}

export type ExecutionSnapshot = ExecutionPolicy & {
  resolvedAt: string
}

export type AgentProfile = {
  id: string
  slug: string
  displayName: string
  isDefault: boolean
  defaultExecutionPolicy: ExecutionPolicy
  enabledTransportIds: string[]
  createdAt: string
  updatedAt: string
}

export type Conversation = {
  id: string
  agentProfileId: string
  workspaceId?: string | null
  title?: string | null
  status: ConversationStatus
  activeBindingId?: string | null
  lastRunId?: string | null
  executionOverride?: ConversationExecutionOverride | null
  desktopVisibilityMode: DesktopVisibilityMode
  createdAt: string
  updatedAt: string
}

export type ConversationBinding = {
  id: string
  conversationId: string
  transportId: string
  transportAccountId: string
  externalChatId: string
  externalThreadId?: string | null
  externalUserId?: string | null
  channelKind: ConversationChannelKind
  routingKey: string
  sessionScope?: ConversationSessionScope | null
  sharedMultiUser: boolean
  personId?: string | null
  tenantId?: string | null
  lastExternalMessageId?: string | null
  lastInboundTraceId?: string | null
  readonlyInDesktop: boolean
  createdAt: string
  updatedAt: string
}

export type ConversationMessage = {
  id: string
  conversationId: string
  bindingId?: string | null
  externalMessageId?: string | null
  role: MessageRole
  direction: MessageDirection
  text?: string | null
  payloadJson?: string | null
  createdAt: string
}

export type AgentInstance = {
  id: string
  agentProfileId: string
  conversationId: string
  status: AgentInstanceStatus
  effectiveExecutionPolicy: ExecutionPolicy
  runtimeGeneration: number
  loadedAt: string
  lastActiveAt: string
  lastReloadReason?:
    | 'execution_policy_change'
    | 'context_compaction'
    | 'provider_failover'
    | 'manual'
}

export type AgentRun = {
  id: string
  conversationId: string
  instanceId?: string | null
  triggerKind: 'user_message' | 'transport_message' | 'manual' | 'automation' | 'system_followup'
  requestedExecutionPolicy: ExecutionPolicy
  effectiveExecutionSnapshot: ExecutionSnapshot
  status: AgentRunStatus
  traceId: string
  startedAt: string
  endedAt?: string | null
}

export type InteractionCheckpoint = {
  id: string
  conversationId: string
  runId?: string | null
  kind: InteractionKind
  prompt: string
  status: 'pending' | 'answered' | 'expired' | 'cancelled'
  expectedBindingId?: string | null
  expectedPersonId?: string | null
  acceptedReplyModes?: string[] | null
  expiresAt?: string | null
  createdAt: string
  updatedAt: string
}

export type DeliveryRecord = {
  id: string
  conversationId: string
  bindingId: string
  mode: DeliveryMode
  payloadJson: string
  status: 'requested' | 'sent' | 'failed'
  transportDeliveryMode?: TransportDeliveryMode | null
  replyContext?: unknown | null
  degradeMode?: 'send_new' | 'fail' | 'queue' | null
  externalMessageId?: string | null
  doctorTraceId?: string | null
  lastError?: string | null
  attemptCount: number
  createdAt: string
  updatedAt: string
}

export type EventLogEntry = {
  id: string
  eventType: string
  traceId: string
  correlationId: string
  causationId?: string | null
  parentEventId?: string | null
  sequence: number
  aggregateType: EventAggregateType
  aggregateId: string
  payloadJson: string
  createdAt: string
}

export type ConversationMessagePageCursor = {
  createdAt: string
  id: string
}

export type ConversationMessagePage = {
  rows: ConversationMessage[]
  hasMoreBefore: boolean
  nextBeforeCursor: ConversationMessagePageCursor | null
}

export type ConversationSearchRole = 'user' | 'assistant' | 'tool'

export type ConversationSearchInput = {
  query: string
  limit?: number
  offset?: number
  workspacePath?: string | null
  conversationId?: string | null
  threadId?: string | null
  roles?: ConversationSearchRole[] | null
}

export type ConversationSearchResultItem = {
  messageId: string
  conversationId: string
  threadId: string
  role: ConversationSearchRole
  title: string | null
  workspacePath: string | null
  text: string
  snippet: string
  createdAt: string
  rank: number
}

export type ConversationSearchResult = {
  items: ConversationSearchResultItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

// === Conversation query tool types ===

export type ConversationQuerySourceKind = 'local' | 'im' | 'all'

export type ConversationListItem = {
  conversationId: string
  title: string | null
  status: ConversationStatus
  sourceKind: ConversationSourceKind
  primaryTransportId: string | null
  primaryExternalLabel: string | null
  lastMessageAt: string | null
  lastRunStatus: AgentRunStatus | null
  messageCount: number
  createdAt: string
  updatedAt: string
}

export type ListConversationsInput = {
  sourceKind?: ConversationQuerySourceKind
  dateAfter?: string | null
  dateBefore?: string | null
  query?: string | null
  limit?: number
  offset?: number
}

export type ListConversationsResult = {
  items: ConversationListItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export type ConversationMessageListItem = {
  messageId: string
  conversationId: string
  conversationTitle: string | null
  role: MessageRole
  text: string | null
  createdAt: string
}

export type ListConversationMessagesInput = {
  conversationId: string
  dateAfter?: string | null
  dateBefore?: string | null
  role?: MessageRole | null
  limit?: number
  offset?: number
}

export type ListConversationMessagesResult = {
  items: ConversationMessageListItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export type ListAllConversationMessagesInput = {
  conversationId?: string | null
  dateAfter?: string | null
  dateBefore?: string | null
  role?: MessageRole | null
  limit?: number
  offset?: number
}

export type ListAllConversationMessagesResult = {
  items: ConversationMessageListItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export type EventLogAggregateKey = {
  aggregateType: EventAggregateType
  aggregateId: string
}

export type ConversationWindowProjection = {
  conversationId: string
  agentProfileId: string
  workspaceId?: string | null
  primarySourceKind: ConversationSourceKind
  primaryTransportId?: string | null
  primaryTransportAccountId?: string | null
  primaryExternalLabel?: string | null
  desktopVisibilityMode: DesktopVisibilityMode
  startedAt?: string | null
  lastMessageAt?: string | null
  lastRunStatus?: AgentRunStatus | null
  pendingInteractionKind?: InteractionKind | null
  unreadCount: number
  needsAttention: boolean
  isPinned: boolean
  updatedAt: string
}

export type AttachmentRef = {
  id: string
  mimeType: string
  name?: string
  sizeBytes?: number
  storageKey?: string
}

export type InboundEnvelope = {
  envelopeId: string
  imTraceId?: string | null
  dedupeKey?: string | null
  transportId: string
  transportAccountId: string
  externalMessageId: string
  externalChatId: string
  externalThreadId?: string | null
  externalUserId?: string | null
  externalUserDisplayName?: string
  channelKind: ConversationChannelKind
  sessionScope?: ConversationSessionScope | null
  sharedMultiUser?: boolean | null
  personId?: string | null
  tenantId?: string | null
  messageType?: 'text' | 'image' | 'file' | 'audio' | 'video' | 'card' | 'command' | 'unknown'
  receivedAt: string
  text?: string
  attachments?: AttachmentRef[]
  routingKey?: string
}

export type UpsertAgentProfileInput = {
  id?: string
  slug: string
  displayName: string
  isDefault?: boolean
  defaultExecutionPolicy: ExecutionPolicy
  enabledTransportIds?: string[]
}

export type ResolveConversationForEnvelopeInput = {
  agentProfileId: string
  envelope: InboundEnvelope
  workspaceId?: string | null
  title?: string | null
  desktopVisibilityMode?: DesktopVisibilityMode
  executionOverride?: ConversationExecutionOverride | null
}

export type ConversationBindingTarget = {
  transportId: string
  transportAccountId: string
  externalChatId: string
  externalThreadId?: string | null
  externalUserId?: string | null
  channelKind: ConversationChannelKind
  sessionScope?: ConversationSessionScope | null
  sharedMultiUser?: boolean | null
  personId?: string | null
  tenantId?: string | null
  externalUserDisplayName?: string | null
  routingKey?: string
}

export type ResolveConversationForEnvelopeResult = {
  conversation: Conversation
  binding: ConversationBinding
  createdConversation: boolean
  createdBinding: boolean
}

export type ResolveConversationForTargetInput = {
  agentProfileId: string
  target: ConversationBindingTarget
  conversationId?: string | null
  workspaceId?: string | null
  title?: string | null
  desktopVisibilityMode?: DesktopVisibilityMode
  executionOverride?: ConversationExecutionOverride | null
  setAsActiveBinding?: boolean
}

export type ConversationBindingMatch = {
  conversation: Conversation
  binding: ConversationBinding
}

export type AppendInboundEnvelopeInput = {
  conversationId: string
  bindingId: string
  envelope: InboundEnvelope
}

export type UpsertConversationMessageInput = {
  conversationId: string
  bindingId?: string | null
  externalMessageId?: string | null
  role: MessageRole
  direction: MessageDirection
  text?: string | null
  payload?: unknown
  createdAt?: string | number | Date | null
}

export type RequestRunInput = {
  conversationId: string
  triggerKind: AgentRun['triggerKind']
  triggerExecutionOverride?: ConversationExecutionOverride
  traceId?: string
}

export type UpsertAgentRunInput = {
  id: string
  conversationId: string
  instanceId?: string | null
  triggerKind: AgentRun['triggerKind']
  requestedExecutionPolicy: ExecutionPolicy
  effectiveExecutionSnapshot: ExecutionSnapshot
  status: AgentRun['status']
  traceId: string
  projectionText?: string | null
  projectionTurns?: unknown[] | string | null
  startedAt?: string | number | Date | null
  endedAt?: string | number | Date | null
}

export type UpdateConversationInput = {
  conversationId: string
  title?: string | null
  workspaceId?: string | null
  executionOverride?: ConversationExecutionOverride | null
  desktopVisibilityMode?: DesktopVisibilityMode
  activeBindingId?: string | null
}

export type RequestInteractionInput = {
  conversationId: string
  runId?: string | null
  expectedBindingId?: string | null
  expectedPersonId?: string | null
  acceptedReplyModes?: string[] | null
  expiresAt?: string | number | Date | null
  kind: InteractionKind
  prompt: string
}

export type AnswerInteractionInput = {
  interactionId: string
  answeredAt?: string | number | Date | null
}

export type CancelInteractionInput = {
  interactionId: string
  cancelledAt?: string | number | Date | null
}

export type RequestDeliveryInput = {
  conversationId: string
  bindingId: string
  mode: DeliveryMode
  transportDeliveryMode?: TransportDeliveryMode | null
  replyContext?: unknown | null
  degradeMode?: DeliveryRecord['degradeMode']
  externalMessageId?: string | null
  doctorTraceId?: string | null
  payload: unknown
}

export type UpdateDeliveryStatusInput = {
  deliveryId: string
  status: Extract<DeliveryRecord['status'], 'sent' | 'failed'>
  result?: unknown
  updatedAt?: string | number | Date | null
}

export type DeleteConversationInput = {
  conversationId: string
}

export type DeleteConversationMessageInput = {
  conversationId: string
  externalMessageId: string
}

export type PruneConversationRuntimeAfterInput = {
  conversationId: string
  cutoffCreatedAt: string | number | Date
}

export type UpsertEventLogEntryInput = {
  id?: string
  eventType: string
  traceId: string
  correlationId: string
  causationId?: string | null
  parentEventId?: string | null
  aggregateType: EventAggregateType
  aggregateId: string
  payload: unknown
  createdAt?: string | number | Date | null
}

export interface CoreCommandService {
  upsertAgentProfile(input: UpsertAgentProfileInput): AgentProfile
  resolveConversationForEnvelope(
    input: ResolveConversationForEnvelopeInput
  ): ResolveConversationForEnvelopeResult
  resolveConversationForTarget(
    input: ResolveConversationForTargetInput
  ): ResolveConversationForEnvelopeResult
  appendInboundEnvelope(input: AppendInboundEnvelopeInput): ConversationMessage
  upsertConversationMessage(input: UpsertConversationMessageInput): ConversationMessage
  updateConversation(input: UpdateConversationInput): Conversation
  requestRun(input: RequestRunInput): AgentRun
  upsertAgentRun(input: UpsertAgentRunInput): AgentRun
  requestInteraction(input: RequestInteractionInput): InteractionCheckpoint
  answerInteraction(input: AnswerInteractionInput): InteractionCheckpoint
  cancelInteraction(input: CancelInteractionInput): InteractionCheckpoint
  requestDelivery(input: RequestDeliveryInput): DeliveryRecord
  updateDeliveryStatus(input: UpdateDeliveryStatusInput): DeliveryRecord
  upsertEventLogEntry(input: UpsertEventLogEntryInput): EventLogEntry
  upsertThreadPlanState(input: UpsertThreadPlanStateInput): ThreadPlanState
  clearThreadPlanState(threadId: string): boolean
  deleteConversationMessage(input: DeleteConversationMessageInput): boolean
  pruneConversationRuntimeAfter(input: PruneConversationRuntimeAfterInput): void
  deleteConversation(input: DeleteConversationInput): boolean
  pruneOldEventLog(retentionDays?: number): number
  getEventLogStats(): { totalCount: number; oldestEntry: string | null; newestEntry: string | null }
}

export interface CoreQueryService {
  getAgentProfile(id: string): AgentProfile | null
  getConversation(id: string): Conversation | null
  getConversationBinding(id: string): ConversationBinding | null
  listConversationBindings(options?: {
    conversationId?: string | null
    transportId?: string | null
    transportAccountId?: string | null
  }): ConversationBinding[]
  getConversationBindingByRoutingKey(routingKey: string): ConversationBinding | null
  getConversationByBindingRoutingKey(routingKey: string): ConversationBindingMatch | null
  getConversationMessages(conversationId: string): ConversationMessage[]
  searchConversationMessages(input: ConversationSearchInput): ConversationSearchResult
  listConversationMessagesPage(
    conversationId: string,
    options?: { limit?: number; before?: ConversationMessagePageCursor | null }
  ): ConversationMessagePage
  getAgentRun(id: string): AgentRun | null
  listConversationRuns(conversationId: string): AgentRun[]
  listAgentRunsByIds(runIds: string[]): AgentRun[]
  listPendingInteractions(conversationId?: string): InteractionCheckpoint[]
  getDeliveryRecord(id: string): DeliveryRecord | null
  getDeliveryRecords(conversationId: string): DeliveryRecord[]
  listDeliveryRecords(status?: DeliveryRecord['status']): DeliveryRecord[]
  getThreadPlanState(threadId: string): ThreadPlanState | null
  listConversationWindows(
    sourceKind?: ConversationSourceKind | 'all'
  ): ConversationWindowProjection[]
  listEventLog(): EventLogEntry[]
  listEventLogByAggregateKeys(keys: EventLogAggregateKey[]): EventLogEntry[]
  listConversations(input: ListConversationsInput): ListConversationsResult
  listConversationMessages(input: ListConversationMessagesInput): ListConversationMessagesResult
  listAllConversationMessages(input: ListAllConversationMessagesInput): ListAllConversationMessagesResult
}

export const mergeExecutionPolicy = (
  base: ExecutionPolicy,
  conversationOverride?: ConversationExecutionOverride | null,
  triggerOverride?: ConversationExecutionOverride | null
): ExecutionPolicy => {
  const mergedModel = {
    ...base.model,
    ...(conversationOverride?.model ?? {}),
    ...(triggerOverride?.model ?? {})
  }

  return {
    model: mergedModel,
    contextEngineId: base.contextEngineId,
    memoryProviderId: base.memoryProviderId,
    toolProfileId:
      triggerOverride?.toolProfileId ??
      conversationOverride?.toolProfileId ??
      base.toolProfileId ??
      null,
    sandboxPolicyId:
      triggerOverride?.sandboxPolicyId ??
      conversationOverride?.sandboxPolicyId ??
      base.sandboxPolicyId ??
      null
  }
}

export const createExecutionSnapshot = (
  policy: ExecutionPolicy,
  resolvedAt: string
): ExecutionSnapshot => ({
  ...policy,
  model: { ...policy.model },
  resolvedAt
})

export const deriveBindingRoutingKeyFromTarget = (target: ConversationBindingTarget): string =>
  target.routingKey?.trim() ||
  [
    target.transportId,
    target.transportAccountId,
    target.externalChatId,
    target.externalThreadId || '-',
    target.channelKind
  ].join(':')

export const deriveBindingRoutingKey = (envelope: InboundEnvelope): string =>
  deriveBindingRoutingKeyFromTarget(envelope)

export const deriveConversationSourceKind = (transportId: string): ConversationSourceKind =>
  transportId === 'desktop' ||
  transportId === 'desktop-chat' ||
  transportId === 'transport-desktop-chat'
    ? 'local'
    : 'im'
