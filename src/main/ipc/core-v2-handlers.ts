import { ipcMain } from 'electron'
import type { ChatMessageContent } from '@shared/chat-content'
import { getCoreV2Service } from '../core-v2/sqlite-db.ts'
import { getLocalThreadHostService } from '../core-v2/local-thread-host.ts'
import {
  getLocalConversationByThreadId,
  listLocalThreadRows
} from '../core-v2/local-thread-query.ts'
import {
  generateConversationTitle,
  type GenerateConversationTitleInput
} from '../conversation-title/conversation-title-service.ts'
import type {
  AnswerInteractionInput,
  AppendInboundEnvelopeInput,
  CancelInteractionInput,
  RequestDeliveryInput,
  RequestInteractionInput,
  RequestRunInput,
  ResolveConversationForEnvelopeInput,
  UpsertAgentRunInput,
  UpsertEventLogEntryInput,
  UpsertAgentProfileInput,
  ConversationSearchInput,
  ListConversationsInput,
  ListConversationMessagesInput,
  ListAllConversationMessagesInput
} from '../core-v2/domain.ts'

export function setupCoreV2Handlers(): void {
  ipcMain.handle('core-v2:agent-profiles:upsert', (_, input: UpsertAgentProfileInput) =>
    getCoreV2Service().upsertAgentProfile(input)
  )

  ipcMain.handle(
    'core-v2:conversations:resolve-envelope',
    (_, input: ResolveConversationForEnvelopeInput) =>
      getCoreV2Service().resolveConversationForEnvelope(input)
  )
  ipcMain.handle('core-v2:conversations:get', (_, conversationId: string) =>
    getCoreV2Service().getConversation(conversationId)
  )
  ipcMain.handle('core-v2:conversations:get-local-by-thread', (_, threadId: string) =>
    getLocalConversationByThreadId(threadId)
  )
  ipcMain.handle('core-v2:conversations:list-local-thread-rows', () => listLocalThreadRows())
  ipcMain.handle('core-v2:conversations:list-windows', (_, sourceKind?: 'local' | 'im' | 'all') =>
    getCoreV2Service().listConversationWindows(sourceKind ?? 'all')
  )
  ipcMain.handle(
    'core-v2:local-threads:create',
    (_, workspacePath: string, model?: string | null, title?: string | null) =>
      getLocalThreadHostService().then((host) =>
        host.createThread({ workspacePath, model: model ?? null, title: title ?? null })
      )
  )
  ipcMain.handle(
    'core-v2:local-threads:update',
    (_, id: string, fields: { title?: string; started_at?: string; model?: string }) =>
      getLocalThreadHostService().then((host) => host.updateThread(id, fields))
  )
  ipcMain.handle(
    'core-v2:local-threads:generate-title',
    (_, input: GenerateConversationTitleInput) => generateConversationTitle(input)
  )
  ipcMain.handle('core-v2:local-threads:delete', (_, id: string) => {
    return getLocalThreadHostService().then((host) => host.deleteThread(id))
  })
  ipcMain.handle(
    'core-v2:local-threads:get-user-chat-ordinal',
    (_, threadId: string, messageId: string) =>
      getLocalThreadHostService().then((host) => host.getUserChatOrdinal(threadId, messageId))
  )
  ipcMain.handle(
    'core-v2:local-threads:prune-runtime-after',
    (_, threadId: string, cutoffCreatedAt: string) =>
      getLocalThreadHostService().then((host) => host.pruneRuntimeAfter(threadId, cutoffCreatedAt))
  )

  ipcMain.handle(
    'core-v2:messages:append-inbound-envelope',
    (_, input: AppendInboundEnvelopeInput) => getCoreV2Service().appendInboundEnvelope(input)
  )
  ipcMain.handle('core-v2:messages:list', (_, conversationId: string) =>
    getCoreV2Service().getConversationMessages(conversationId)
  )
  ipcMain.handle('core-v2:messages:search', (_, input: ConversationSearchInput) =>
    getCoreV2Service().searchConversationMessages(input)
  )
  ipcMain.handle(
    'core-v2:messages:list-conversations',
    (_, input: ListConversationsInput) =>
      getCoreV2Service().listConversations(input)
  )
  ipcMain.handle(
    'core-v2:messages:list-conversation-messages',
    (_, input: ListConversationMessagesInput) =>
      getCoreV2Service().listConversationMessages(input)
  )
  ipcMain.handle(
    'core-v2:messages:list-all-messages',
    (_, input: ListAllConversationMessagesInput) =>
      getCoreV2Service().listAllConversationMessages(input)
  )
  ipcMain.handle(
    'core-v2:local-messages:add',
    (
      _,
      threadId: string,
      role: 'user' | 'assistant' | 'tool',
      content: string,
      agentRunId?: string | null,
      contentJson?: ChatMessageContent | null,
      options?: {
        messageKind?:
          | 'chat'
          | 'automation'
          | 'question_answer'
          | 'questionnaire_question'
          | 'questionnaire_answer'
        includeInAgentContext?: boolean
        submissionId?: string | null
        agentTurnId?: string | null
        toolCallId?: string
        stepIndex?: number
        runtimeSequence?: number | null
        createdAt?: string | number | Date | null
      }
    ) =>
      getLocalThreadHostService().then((host) =>
        host.addMessage(threadId, role, content, agentRunId, contentJson, options)
      )
  )
  ipcMain.handle(
    'core-v2:local-messages:update',
    (_, id: string, content: string, contentJson?: ChatMessageContent | null) =>
      getLocalThreadHostService().then((host) => host.updateMessage(id, content, contentJson))
  )
  ipcMain.handle('core-v2:local-messages:delete', (_, id: string) =>
    getLocalThreadHostService().then((host) => host.deleteMessage(id))
  )
  ipcMain.handle(
    'core-v2:local-messages:set-agent-entry-id',
    (_, id: string, agentEntryId: string) =>
      getLocalThreadHostService().then((host) => host.setMessageAgentEntryId(id, agentEntryId))
  )
  ipcMain.handle(
    'core-v2:local-messages:update-runtime-link',
    (
      _,
      id: string,
      fields: {
        agentRunId?: string | null
        submissionId?: string | null
        agentTurnId?: string | null
        runtimeSequence?: number | null
        createdAt?: string | number | Date | null
      }
    ) => getLocalThreadHostService().then((host) => host.updateUserMessageRuntimeLink(id, fields))
  )
  ipcMain.handle('core-v2:local-messages:prepare-for-retry', (_, id: string) =>
    getLocalThreadHostService().then((host) => host.prepareUserMessageForRetry(id))
  )

  ipcMain.handle('core-v2:runs:request', (_, input: RequestRunInput) =>
    getCoreV2Service().requestRun(input)
  )
  ipcMain.handle('core-v2:runs:upsert', (_, input: UpsertAgentRunInput) =>
    getCoreV2Service().upsertAgentRun(input)
  )
  ipcMain.handle('core-v2:runs:get', (_, runId: string) => getCoreV2Service().getAgentRun(runId))
  ipcMain.handle('core-v2:runs:list', (_, conversationId: string) =>
    getCoreV2Service().listConversationRuns(conversationId)
  )

  ipcMain.handle('core-v2:interactions:request', (_, input: RequestInteractionInput) =>
    getCoreV2Service().requestInteraction(input)
  )
  ipcMain.handle('core-v2:interactions:answer', (_, input: AnswerInteractionInput) =>
    getCoreV2Service().answerInteraction(input)
  )
  ipcMain.handle('core-v2:interactions:cancel', (_, input: CancelInteractionInput) =>
    getCoreV2Service().cancelInteraction(input)
  )
  ipcMain.handle('core-v2:interactions:list-pending', (_, conversationId?: string) =>
    getCoreV2Service().listPendingInteractions(conversationId)
  )

  ipcMain.handle('core-v2:deliveries:request', (_, input: RequestDeliveryInput) =>
    getCoreV2Service().requestDelivery(input)
  )
  ipcMain.handle('core-v2:deliveries:list', (_, conversationId: string) =>
    getCoreV2Service().getDeliveryRecords(conversationId)
  )

  ipcMain.handle('core-v2:thread-plans:get', (_, threadId: string) =>
    getCoreV2Service().getThreadPlanState(threadId)
  )

  ipcMain.handle('core-v2:events:list', () => getCoreV2Service().listEventLog())
  ipcMain.handle('core-v2:events:upsert', (_, input: UpsertEventLogEntryInput) =>
    getCoreV2Service().upsertEventLogEntry(input)
  )

  ipcMain.handle('core-v2:events:prune-old', (_, retentionDays?: number) =>
    getCoreV2Service().pruneOldEventLog(retentionDays)
  )

  ipcMain.handle('core-v2:events:stats', () => getCoreV2Service().getEventLogStats())
}
