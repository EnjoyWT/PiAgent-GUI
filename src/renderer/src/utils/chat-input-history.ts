export type ChatInputHistoryBucket = {
  entries: string[]
}

export type ChatInputHistoryStore = Record<string, ChatInputHistoryBucket>

const MAX_CHAT_INPUT_HISTORY_ENTRIES = 50

const normalizeThreadId = (threadId?: string | null): string => String(threadId ?? '').trim()

const normalizeHistoryEntry = (value: string): string => (value ?? '').replace(/\r\n/g, '\n').trim()

export const createChatInputHistoryStore = (): ChatInputHistoryStore => ({})

export const getChatInputHistoryEntries = (
  store: ChatInputHistoryStore,
  threadId?: string | null
): string[] => {
  const key = normalizeThreadId(threadId)
  if (!key) return []
  return store[key]?.entries ?? []
}

export const appendChatInputHistoryEntry = (
  store: ChatInputHistoryStore,
  threadId: string | null | undefined,
  value: string,
  limit = MAX_CHAT_INPUT_HISTORY_ENTRIES
): ChatInputHistoryStore => {
  const key = normalizeThreadId(threadId)
  const entry = normalizeHistoryEntry(value)
  if (!key || !entry) return store

  const currentEntries = store[key]?.entries ?? []
  if (currentEntries[currentEntries.length - 1] === entry) return store

  const nextEntries = currentEntries.concat(entry)
  const trimmedEntries =
    nextEntries.length > limit ? nextEntries.slice(nextEntries.length - limit) : nextEntries

  return {
    ...store,
    [key]: { entries: trimmedEntries }
  }
}

export const removeChatInputHistoryThread = (
  store: ChatInputHistoryStore,
  threadId: string | null | undefined
): ChatInputHistoryStore => {
  const key = normalizeThreadId(threadId)
  if (!key || store[key] === undefined) return store
  const { [key]: _removed, ...rest } = store
  return rest
}
