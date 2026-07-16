import type { MessageRow, ThreadRow } from '../../preload/db-types.ts'
import type {
  Conversation,
  ConversationBinding,
  ConversationBindingMatch,
  ConversationMessage,
  CoreQueryService
} from './domain.ts'
import { buildLocalThreadRoutingKey } from './local-thread-binding.ts'
import {
  parseLocalThreadMessageMeta,
  serializeLocalThreadContent
} from './local-thread-message-payload.ts'
import { isSystemFollowupSyntheticPromptText } from './system-followup-synthetic-prompt.ts'
import { getCoreV2Service } from './sqlite-db.ts'

type LocalThreadQueryService = Pick<
  CoreQueryService,
  | 'getAgentProfile'
  | 'getConversation'
  | 'getConversationBinding'
  | 'getConversationByBindingRoutingKey'
  | 'getAgentRun'
  | 'getConversationMessages'
  | 'listConversationRuns'
  | 'listConversationWindows'
>

const compareIds = (left: string | null | undefined, right: string | null | undefined): number =>
  String(left ?? '').localeCompare(String(right ?? ''))

const compareCreatedAt = (
  left: Pick<ConversationMessage, 'createdAt' | 'externalMessageId' | 'id'>,
  right: Pick<ConversationMessage, 'createdAt' | 'externalMessageId' | 'id'>
): number =>
  left.createdAt.localeCompare(right.createdAt) ||
  compareIds(left.externalMessageId ?? left.id, right.externalMessageId ?? right.id)

const AUTOMATION_PROMPT_PREFIX = '[SYSTEM: You are running as a scheduled automation task.'

const isAutomationPromptMessage = (message: ConversationMessage): boolean =>
  message.role === 'user' && (message.text ?? '').trim().startsWith(AUTOMATION_PROMPT_PREFIX)

const toLocalThreadModelKey = (
  service: LocalThreadQueryService,
  conversation: Conversation
): string | null => {
  const profile = service.getAgentProfile(conversation.agentProfileId)
  const providerId =
    conversation.executionOverride?.model?.providerId ??
    profile?.defaultExecutionPolicy.model.providerId ??
    ''
  const modelId =
    conversation.executionOverride?.model?.modelId ??
    profile?.defaultExecutionPolicy.model.modelId ??
    ''
  if (!modelId) return null
  return providerId ? `${providerId}::${modelId}` : modelId
}

const deriveThreadStartedAt = (
  service: LocalThreadQueryService,
  conversationId: string
): string | null => {
  const earliestMessage = service
    .getConversationMessages(conversationId)
    .slice()
    .sort(compareCreatedAt)[0]?.createdAt
  const earliestRun = service
    .listConversationRuns(conversationId)
    .slice()
    .sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) || compareIds(left.id, right.id)
    )[0]?.startedAt

  if (earliestMessage && earliestRun) {
    return earliestMessage.localeCompare(earliestRun) <= 0 ? earliestMessage : earliestRun
  }
  return earliestMessage ?? earliestRun ?? null
}

const toThreadRow = (
  service: LocalThreadQueryService,
  conversation: Conversation,
  binding: ConversationBinding,
  startedAt?: string | null
): ThreadRow => ({
  id: binding.externalChatId,
  workspace_path: conversation.workspaceId ?? '',
  title: conversation.title ?? null,
  model: toLocalThreadModelKey(service, conversation),
  created_at: conversation.createdAt,
  started_at: startedAt !== undefined ? startedAt : deriveThreadStartedAt(service, conversation.id)
})

const toMessageRow = (threadId: string, message: ConversationMessage): MessageRow => {
  const meta = parseLocalThreadMessageMeta(message)
  return {
    id: message.externalMessageId ?? message.id,
    thread_id: threadId,
    role: message.role === 'tool' ? 'tool' : message.role === 'assistant' ? 'assistant' : 'user',
    message_kind: meta.messageKind ?? 'chat',
    include_in_agent_context: meta.includeInAgentContext ? 1 : 0,
    content: message.text ?? '',
    content_json: serializeLocalThreadContent(meta.content),
    agent_run_id: meta.agentRunId ?? null,
    agent_entry_id: meta.agentEntryId ?? null,
    agent_turn_id: meta.agentTurnId ?? null,
    tool_call_id: meta.toolCallId ?? null,
    step_index: meta.stepIndex ?? null,
    runtime_sequence: meta.runtimeSequence ?? null,
    created_at: message.createdAt
  }
}

const isSystemFollowupSyntheticUserMessage = (
  service: LocalThreadQueryService,
  message: ConversationMessage
): boolean => {
  if (message.role !== 'user') return false
  if (!isSystemFollowupSyntheticPromptText(message.text)) return false
  const runId = parseLocalThreadMessageMeta(message).agentRunId
  if (!runId) return false
  return service.getAgentRun(runId)?.triggerKind === 'system_followup'
}

const findLocalThreadMessage = (
  service: LocalThreadQueryService,
  messageId: string
): { threadId: string; message: ConversationMessage } | null => {
  const normalizedMessageId = String(messageId ?? '').trim()
  if (!normalizedMessageId) return null

  for (const window of service.listConversationWindows('local')) {
    const conversation = service.getConversation(window.conversationId)
    if (!conversation) continue
    const binding = conversation.activeBindingId
      ? service.getConversationBinding(conversation.activeBindingId)
      : null
    if (!binding || binding.transportId !== 'desktop-chat') continue
    const message = service
      .getConversationMessages(conversation.id)
      .find(
        (item) =>
          item.id === normalizedMessageId ||
          (item.externalMessageId ?? '').trim() === normalizedMessageId
      )
    if (!message) continue
    return {
      threadId: binding.externalChatId,
      message
    }
  }

  return null
}

const findLatestLocalThreadMessageByRoleAndContentInternal = (
  service: LocalThreadQueryService,
  threadId: string,
  role: MessageRow['role'],
  content: string
): MessageRow | null => {
  const rows = listLocalThreadMessageRowsFromService(service, threadId)
    .filter((message) => message.role === role && message.content === content)
    .sort(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) || compareIds(right.id, left.id)
    )
  return rows[0] ?? null
}

export const getLocalConversationByThreadIdFromService = (
  service: LocalThreadQueryService,
  threadId: string
): ConversationBindingMatch | null => {
  const normalizedThreadId = String(threadId ?? '').trim()
  if (!normalizedThreadId) return null
  return service.getConversationByBindingRoutingKey(buildLocalThreadRoutingKey(normalizedThreadId))
}

export const getLocalConversationByThreadId = (threadId: string): ConversationBindingMatch | null =>
  getLocalConversationByThreadIdFromService(getCoreV2Service(), threadId)

const hasUserChatMessage = (service: LocalThreadQueryService, conversationId: string): boolean =>
  service.getConversationMessages(conversationId).some((message) => {
    if (message.role !== 'user') return false
    const meta = parseLocalThreadMessageMeta(message)
    return (
      (meta.messageKind ?? 'chat') === 'chat' &&
      meta.includeInAgentContext !== false &&
      !isAutomationPromptMessage(message)
    )
  })

const isAutomationOnlyLocalThread = (
  service: LocalThreadQueryService,
  conversationId: string
): boolean => {
  const runs = service.listConversationRuns(conversationId)
  return (
    runs.some((run) => run.triggerKind === 'automation') &&
    !hasUserChatMessage(service, conversationId)
  )
}

export const getLocalThreadRowFromService = (
  service: LocalThreadQueryService,
  threadId: string
): ThreadRow | null => {
  const match = getLocalConversationByThreadIdFromService(service, threadId)
  if (!match) return null
  return toThreadRow(service, match.conversation, match.binding)
}

export const getLocalThreadRow = (threadId: string): ThreadRow | null =>
  getLocalThreadRowFromService(getCoreV2Service(), threadId)

export const listLocalThreadRowsFromService = (service: LocalThreadQueryService): ThreadRow[] => {
  const rows: ThreadRow[] = []

  for (const window of service.listConversationWindows('local')) {
    const conversation = service.getConversation(window.conversationId)
    if (!conversation || conversation.desktopVisibilityMode === 'hidden') continue
    const binding = conversation.activeBindingId
      ? service.getConversationBinding(conversation.activeBindingId)
      : null
    if (!binding || binding.transportId !== 'desktop-chat') continue
    if (isAutomationOnlyLocalThread(service, conversation.id)) continue
    rows.push(toThreadRow(service, conversation, binding, window.startedAt ?? null))
  }

  rows.sort(
    (left, right) =>
      right.created_at.localeCompare(left.created_at) || compareIds(right.id, left.id)
  )
  return rows
}

export const listLocalThreadRows = (): ThreadRow[] =>
  listLocalThreadRowsFromService(getCoreV2Service())

export const listLocalThreadMessageRowsFromService = (
  service: LocalThreadQueryService,
  threadId: string
): MessageRow[] => {
  const match = getLocalConversationByThreadIdFromService(service, threadId)
  if (!match) return []
  return service
    .getConversationMessages(match.conversation.id)
    .filter(
      (message): message is ConversationMessage & { role: 'user' | 'assistant' | 'tool' } =>
        (message.role === 'user' || message.role === 'assistant' || message.role === 'tool') &&
        !isSystemFollowupSyntheticUserMessage(service, message)
    )
    .map((message) => toMessageRow(match.binding.externalChatId, message))
    .sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) || compareIds(left.id, right.id)
    )
}

export const getLocalThreadMessageRowByIdFromService = (
  service: LocalThreadQueryService,
  messageId: string
): MessageRow | null => {
  const resolved = findLocalThreadMessage(service, messageId)
  if (!resolved) return null
  return toMessageRow(resolved.threadId, resolved.message)
}

export const findLatestLocalThreadMessageByRoleAndContentFromService = (
  service: LocalThreadQueryService,
  threadId: string,
  role: MessageRow['role'],
  content: string
): MessageRow | null =>
  findLatestLocalThreadMessageByRoleAndContentInternal(service, threadId, role, content)

export const findLatestLocalThreadMessageByRoleAndContent = (
  threadId: string,
  role: MessageRow['role'],
  content: string
): MessageRow | null =>
  findLatestLocalThreadMessageByRoleAndContentInternal(getCoreV2Service(), threadId, role, content)
