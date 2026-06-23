import type { AgentThreadMessageProjection } from '../../shared/agent-runtime.ts'
import {
  deserializeChatMessageContent,
  serializeChatMessageContent,
  type ChatMessageContent
} from '../../shared/chat-content.ts'
import type { MessageRow } from '../../preload/db-types.ts'
import type { ConversationMessage } from './domain.ts'

type JsonRecord = Record<string, unknown>

export type LocalThreadMessageMeta = {
  messageKind: AgentThreadMessageProjection['messageKind']
  includeInAgentContext: boolean
  agentRunId?: string | null
  submissionId?: string | null
  agentEntryId?: string | null
  agentTurnId?: string | null
  toolCallId?: string | null
  stepIndex?: number | null
  runtimeSequence?: number | null
  content: ChatMessageContent | null
}

const asRecord = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const parsePayloadRecord = (payloadJson: string | null | undefined): JsonRecord | null => {
  if (!payloadJson) return null
  try {
    return asRecord(JSON.parse(payloadJson))
  } catch {
    return null
  }
}

const normalizeMessageKind = (value: unknown): AgentThreadMessageProjection['messageKind'] => {
  const raw = asString(value)
  if (
    raw === 'automation' ||
    raw === 'question_answer' ||
    raw === 'questionnaire_question' ||
    raw === 'questionnaire_answer'
  ) {
    return raw
  }
  return 'chat'
}

const parseStoredContent = (value: unknown): ChatMessageContent | null => {
  if (typeof value === 'string') return deserializeChatMessageContent(value)
  const record = asRecord(value)
  if (!record) return null
  try {
    return deserializeChatMessageContent(JSON.stringify(record))
  } catch {
    return null
  }
}

export const buildLocalThreadMessagePayload = (row: MessageRow): { localThread: JsonRecord } => ({
  localThread: {
    version: 1,
    messageKind: row.message_kind,
    includeInAgentContext: Boolean(row.include_in_agent_context),
    agentRunId: row.agent_run_id,
    submissionId: row.submission_id,
    agentEntryId: row.agent_entry_id,
    agentTurnId: row.agent_turn_id,
    toolCallId: row.tool_call_id,
    stepIndex: row.step_index,
    runtimeSequence: row.runtime_sequence,
    content: deserializeChatMessageContent(row.content_json)
  }
})

export const parseLocalThreadMessageMeta = (
  message: Pick<ConversationMessage, 'payloadJson'> | null | undefined
): LocalThreadMessageMeta => {
  const payload = parsePayloadRecord(message?.payloadJson)
  const localThread = asRecord(payload?.localThread)

  return {
    messageKind: normalizeMessageKind(localThread?.messageKind),
    includeInAgentContext:
      typeof localThread?.includeInAgentContext === 'boolean'
        ? localThread.includeInAgentContext
        : true,
    agentRunId: asString(localThread?.agentRunId).trim() || null,
    submissionId: asString(localThread?.submissionId).trim() || null,
    agentEntryId: asString(localThread?.agentEntryId).trim() || null,
    agentTurnId: asString(localThread?.agentTurnId).trim() || null,
    toolCallId: asString(localThread?.toolCallId).trim() || null,
    stepIndex: asNumber(localThread?.stepIndex),
    runtimeSequence: asNumber(localThread?.runtimeSequence),
    content: parseStoredContent(localThread?.content)
  }
}

export const serializeLocalThreadContent = (
  content: ChatMessageContent | null | undefined
): string | null => serializeChatMessageContent(content ?? null) ?? null
