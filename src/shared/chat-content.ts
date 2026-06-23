type JsonRecord = Record<string, unknown>

export type ChatTextBlock = {
  type: 'text'
  text: string
}

export type ChatImageBlock = {
  type: 'image'
  mimeType: string
  assetId: string
  name?: string
  sizeBytes?: number
}

export type ChatContentBlock = ChatTextBlock | ChatImageBlock

export type ChatMessageContent = {
  version: 1
  blocks: ChatContentBlock[]
}

const asRecord = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export const normalizeChatContentBlock = (value: unknown): ChatContentBlock | null => {
  const record = asRecord(value)
  const type = asString(record?.type).trim()

  if (type === 'text') {
    const text = asString(record?.text)
    return { type: 'text', text }
  }

  if (type === 'image') {
    const mimeType = asString(record?.mimeType).trim()
    const assetId = asString(record?.assetId).trim()
    const name = asString(record?.name).trim() || undefined
    const sizeBytes = asFiniteNumber(record?.sizeBytes)
    if (!mimeType || !assetId) return null
    return { type: 'image', mimeType, assetId, name, sizeBytes }
  }

  return null
}

export const normalizeChatMessageContent = (value: unknown): ChatMessageContent | null => {
  const record = asRecord(value)
  const blocksRaw = Array.isArray(record?.blocks) ? record.blocks : null
  if (!blocksRaw) return null
  const blocks = blocksRaw
    .map((block) => normalizeChatContentBlock(block))
    .filter((block): block is ChatContentBlock => Boolean(block))
  if (blocks.length === 0) return null
  return { version: 1, blocks }
}

export const deserializeChatMessageContent = (value?: string | null): ChatMessageContent | null => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  try {
    return normalizeChatMessageContent(JSON.parse(raw))
  } catch {
    return null
  }
}

export const serializeChatMessageContent = (
  value?: ChatMessageContent | null
): string | undefined => {
  const normalized = normalizeChatMessageContent(value)
  return normalized ? JSON.stringify(normalized) : undefined
}

export const getPlainTextFromBlocks = (blocks?: ChatContentBlock[] | null): string =>
  (blocks ?? [])
    .filter((block): block is ChatTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
