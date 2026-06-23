export type RunFinishedIndicatorMap = Record<string, true>

export const markRunFinishedIndicatorIfNeeded = (
  previous: RunFinishedIndicatorMap,
  input: {
    finishedThreadId: string
    activeThreadId?: string | null
    notificationShown: boolean
  }
): RunFinishedIndicatorMap => {
  const finishedThreadId = String(input.finishedThreadId ?? '').trim()
  if (!finishedThreadId) return previous
  if (input.activeThreadId === finishedThreadId && !input.notificationShown) return previous
  if (previous[finishedThreadId]) return previous
  return { ...previous, [finishedThreadId]: true }
}

export const clearRunFinishedIndicator = (
  previous: RunFinishedIndicatorMap,
  threadId?: string | null
): RunFinishedIndicatorMap => {
  const normalizedThreadId = String(threadId ?? '').trim()
  if (!normalizedThreadId || !previous[normalizedThreadId]) return previous

  const next = { ...previous }
  delete next[normalizedThreadId]
  return next
}
