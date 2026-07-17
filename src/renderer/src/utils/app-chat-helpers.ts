import type { AgentSubmittedQueueItem } from '@shared/agent-runtime'
import type {
  ChatContentBlock,
  ChatImageBlock,
  ChatMessage,
  ChatMessageContent,
  PendingQueueItem
} from '../components/chat/types'
import { getMessageIdentityKey } from './message-keys.ts'
import { compareChatMessagesByTimeline } from './thread-window-merge.ts'

const toPlainImageBlock = (image: ChatImageBlock): ChatImageBlock => ({
  type: 'image',
  assetId: image.assetId,
  mimeType: image.mimeType,
  name: image.name,
  sizeBytes: image.sizeBytes
})

export const buildUserBlocks = (text: string, images: ChatImageBlock[]): ChatContentBlock[] => {
  const blocks: ChatContentBlock[] = []
  if (text) blocks.push({ type: 'text', text })
  blocks.push(...images)
  return blocks
}

export const buildMessageContentJson = (blocks: ChatContentBlock[]): ChatMessageContent | null =>
  blocks.length > 0 ? { version: 1, blocks } : null

export const toPlainImageBlocks = (images: ChatImageBlock[] = []): ChatImageBlock[] =>
  images.map(toPlainImageBlock)

export const toPlainContentBlocks = (blocks: ChatContentBlock[] = []): ChatContentBlock[] =>
  blocks.map((block) =>
    block.type === 'image'
      ? {
          type: 'image',
          assetId: block.assetId,
          mimeType: block.mimeType,
          name: block.name,
          sizeBytes: block.sizeBytes
        }
      : { type: 'text', text: block.text }
  )

export const toPlainContentJson = (
  contentJson?: ChatMessageContent | null
): ChatMessageContent | null =>
  contentJson ? { version: 1, blocks: toPlainContentBlocks(contentJson.blocks) } : null

export const getMessageImageBlocks = (message?: ChatMessage | null): ChatImageBlock[] =>
  toPlainImageBlocks(
    (message?.blocks ?? []).filter((block): block is ChatImageBlock => block.type === 'image')
  )

export const isAgentContextUserMessage = (
  message?: ChatMessage | null
): message is ChatMessage & { role: 'user' } =>
  Boolean(message && message.role === 'user' && (message.includeInAgentContext ?? true))

export const createQueueItem = (
  text: string,
  blocks?: ChatContentBlock[],
  images?: ChatImageBlock[]
): PendingQueueItem => ({
  id: crypto.randomUUID(),
  text,
  blocks,
  images,
  createdAt: Date.now(),
  status: 'queued'
})

export const mergeQueuedMessages = (items: PendingQueueItem[]): string =>
  items
    .map((item) => item.text.replace(/\r\n/g, '\n').trim())
    .filter(Boolean)
    .join('\n\n')

export const toPendingRuntimeQueueItem = (item: AgentSubmittedQueueItem): PendingQueueItem => ({
  id: item.id,
  text: item.text,
  images: item.images?.map((image) => ({ ...image })),
  createdAt: item.createdAt,
  status: 'submitted',
  submittedAt: item.submittedAt,
  delivery: item.delivery,
  runtimeText: item.text
})

export const normalizeQueueText = (text: string): string => text.replace(/\r\n/g, '\n').trim()

export const isAutomationPromptText = (text: string): boolean =>
  normalizeQueueText(text).startsWith('[SYSTEM: You are running as a scheduled automation task.')

export const shouldAppendConsumedUserMessage = (list: ChatMessage[], text: string): boolean => {
  const normalized = normalizeQueueText(text)
  if (!normalized) return false
  const last = list[list.length - 1] ?? null
  if (!last || last.role !== 'user') return true
  return normalizeQueueText(last.content) !== normalized
}

export const findAgentUserMessage = (
  list: ChatMessage[],
  text: string,
  agentRunId?: string | null,
  agentTurnId?: string | null
): ChatMessage | null => {
  const normalized = normalizeQueueText(text)
  if (!normalized) return null
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    if (message.role !== 'user') continue
    if (agentRunId && message.agentRunId === agentRunId) {
      if (agentTurnId && message.agentTurnId === agentTurnId) return message
      if (
        !agentTurnId &&
        !message.agentTurnId &&
        normalizeQueueText(message.content) === normalized
      ) {
        return message
      }
    }
  }
  return null
}

export const findOptimisticDispatchedUserMessage = (
  list: ChatMessage[],
  text: string
): ChatMessage | null => {
  const normalized = normalizeQueueText(text)
  if (!normalized) return null
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    if (message.role !== 'user') continue
    if ((message.agentRunId ?? '').trim()) continue
    if (normalizeQueueText(message.content) !== normalized) continue
    return message
  }
  return null
}

export const findReplayAnchorUserMessage = (
  list: ChatMessage[],
  text: string
): ChatMessage | null => {
  const normalized = normalizeQueueText(text)
  if (!normalized) return null
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    if (message.role !== 'user') continue
    if (!message.retryCandidate) continue
    if (normalizeQueueText(message.content) !== normalized) continue
    return message
  }
  return null
}

export const clearRetryCandidate = (message: ChatMessage | null | undefined): void => {
  if (!message) return
  message.retryCandidate = false
}

export const reorderChatMessagesInPlace = (list: ChatMessage[]): void => {
  if (list.length <= 1) return
  const decorated = list.map((message, index) => ({ message, index }))
  decorated.sort((a, b) => {
    const timelineDelta = compareChatMessagesByTimeline(a.message, b.message)
    if (timelineDelta !== 0) return timelineDelta
    return a.index - b.index
  })

  for (let index = 0; index < decorated.length; index += 1) {
    list[index] = decorated[index].message
  }
}

const messageIdentityScore = (
  message: Pick<
    ChatMessage,
    'id' | 'agentRunId' | 'agentTurnId' | 'runtimeSequence' | 'createdAt' | 'content'
  >
): number => {
  let score = 0
  if (message.id) score += 8
  if (message.agentRunId) score += 4
  if (message.agentTurnId) score += 2
  if (typeof message.runtimeSequence === 'number') score += 1
  if (message.createdAt) score += 1
  if (message.content.trim()) score += 1
  return score
}

export const dedupeChatMessages = (input: ChatMessage[]): ChatMessage[] => {
  const deduped: ChatMessage[] = []
  const indexByKey = new Map<string, number>()
  for (const message of input) {
    const key = getMessageIdentityKey(message)
    const existingIndex = indexByKey.get(key)
    if (existingIndex == null) {
      indexByKey.set(key, deduped.length)
      deduped.push(message)
      continue
    }
    const existing = deduped[existingIndex]
    if (messageIdentityScore(message) > messageIdentityScore(existing)) {
      deduped[existingIndex] = message
    }
  }
  return deduped
}

export type DebugMessageSummary = {
  index: number | undefined
  key: string
  id: string | null
  role: ChatMessage['role']
  kind: string
  content: string
  createdAt: string | null
  runtimeSequence: number | null
  agentRunId: string | null
  agentTurnId: string | null
  isPending: boolean
}

export const summarizeDebugMessage = (
  message: ChatMessage,
  index?: number
): DebugMessageSummary => ({
  index,
  key: getMessageIdentityKey(message),
  id: message.id ?? null,
  role: message.role,
  kind: message.messageKind ?? 'chat',
  content: String(message.content ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 80),
  createdAt: message.createdAt ?? null,
  runtimeSequence: message.runtimeSequence ?? null,
  agentRunId: message.agentRunId ?? null,
  agentTurnId: message.agentTurnId ?? null,
  isPending: message.isPending ?? false
})

export const summarizeDebugMessages = (list: ChatMessage[]): DebugMessageSummary[] =>
  list
    .slice(-8)
    .map((message, offset) => summarizeDebugMessage(message, Math.max(0, list.length - 8) + offset))
