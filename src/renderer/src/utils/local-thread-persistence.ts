export const shouldPersistRuntimeUserMessageToLocalThread = (
  threadId: string,
  isKnownLocalThread: (threadId: string) => boolean
): boolean => {
  const normalizedThreadId = String(threadId ?? '').trim()
  return Boolean(normalizedThreadId && isKnownLocalThread(normalizedThreadId))
}
