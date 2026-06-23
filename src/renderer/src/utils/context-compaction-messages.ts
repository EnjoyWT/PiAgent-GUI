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

const parsePayload = (value: string | null | undefined): Record<string, unknown> => {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const formatCount = (value: unknown): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.floor(value).toLocaleString('zh-CN')
}

const buildCompletedText = (event: ContextCompactionEventRow): string => {
  const payload = parsePayload(event.payload_json)
  const estimatedPromptTokens = formatCount(payload.estimatedPromptTokens)
  const thresholdTokens = formatCount(payload.thresholdTokens)
  const suffix =
    estimatedPromptTokens && thresholdTokens
      ? ` 触发时估算 ${estimatedPromptTokens} / ${thresholdTokens} tokens。`
      : ''
  return `上下文已压缩${suffix}`
}

const buildMessageText = (event: ContextCompactionEventRow): string | null => {
  switch (event.event_type) {
    case 'context.compaction.started':
      return '正在压缩上下文...'
    case 'context.compaction.preflight':
    case 'context.compaction.completed':
      return buildCompletedText(event)
    case 'context.compaction.skipped':
      return '上下文压缩已跳过，当前激活上下文保持不变。'
    case 'context.compaction.failed':
      return '上下文压缩失败，当前激活上下文保持不变。'
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

  const shouldReplaceRunning =
    event.event_type === 'context.compaction.preflight' ||
    event.event_type === 'context.compaction.completed' ||
    event.event_type === 'context.compaction.skipped' ||
    event.event_type === 'context.compaction.failed'
  const runningIndex = shouldReplaceRunning ? findRunningCompactionMessageIndex(messages) : -1
  if (runningIndex >= 0) {
    messages[runningIndex] = message
    return true
  }

  messages.push(message)
  return true
}
