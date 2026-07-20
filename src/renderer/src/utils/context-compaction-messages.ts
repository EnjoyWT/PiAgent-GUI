import type { ChatMessage } from '../components/chat/types'

export type ContextCompactionEventRow = {
  id: string
  event_type: string
  payload_json?: string | null
  created_at?: number | string | null
}

const CONTEXT_COMPACTION_MESSAGE_KIND = 'context_compaction'

const contextCompactionEventTypes = new Set([
  'context.compaction.started',
  'context.compaction.preflight',
  'context.compaction.completed',
  'context.compaction.skipped',
  'context.compaction.failed'
])

const buildMessageText = (event: ContextCompactionEventRow): string | null => {
  switch (event.event_type) {
    case 'context.compaction.started':
      return '-----正在压缩上下文-----'
    case 'context.compaction.preflight':
    case 'context.compaction.completed':
      return '-----上下文已压缩-----'
    case 'context.compaction.skipped':
      return '-----上下文压缩已跳过-----'
    case 'context.compaction.failed':
      return '-----上下文压缩失败-----'
    default:
      return null
  }
}

const findRunningCompactionMessageIndex = (messages: ChatMessage[]): number =>
  messages.findLastIndex(
    (message) =>
      message.messageKind === CONTEXT_COMPACTION_MESSAGE_KIND &&
      message.content.includes('正在压缩上下文')
  )

const findLastCompactionMessageIndex = (messages: ChatMessage[]): number =>
  messages.findLastIndex((message) => message.messageKind === CONTEXT_COMPACTION_MESSAGE_KIND)

export const isContextCompactionEvent = (event: Pick<ContextCompactionEventRow, 'event_type'>) =>
  contextCompactionEventTypes.has(event.event_type)

export const applyContextCompactionEventToMessages = (
  messages: ChatMessage[],
  event: ContextCompactionEventRow
): boolean => {
  const content = buildMessageText(event)
  if (!content) return false

  const message: ChatMessage = {
    id: `context-compaction:${event.id}`,
    role: 'assistant',
    messageKind: CONTEXT_COMPACTION_MESSAGE_KIND,
    includeInAgentContext: false,
    content,
    createdAt:
      typeof event.created_at === 'string'
        ? event.created_at
        : typeof event.created_at === 'number'
          ? new Date(event.created_at).toISOString()
          : undefined
  }

  const isTerminalEvent =
    event.event_type === 'context.compaction.preflight' ||
    event.event_type === 'context.compaction.completed' ||
    event.event_type === 'context.compaction.skipped' ||
    event.event_type === 'context.compaction.failed'

  if (isTerminalEvent) {
    // Prefer replacing the in-progress marker, then the latest compaction marker
    // so completed + legacy preflight events do not stack duplicate rows.
    const runningIndex = findRunningCompactionMessageIndex(messages)
    if (runningIndex >= 0) {
      messages[runningIndex] = message
      return true
    }
    const lastIndex = findLastCompactionMessageIndex(messages)
    if (lastIndex >= 0) {
      messages[lastIndex] = message
      return true
    }
  }

  messages.push(message)
  return true
}
