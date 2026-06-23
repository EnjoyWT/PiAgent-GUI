import type { ThreadPlanItem, ThreadPlanState } from '@shared/thread-plan'

export const hasOpenThreadPlanItems = (items: ThreadPlanItem[]): boolean =>
  items.some((item) => item.status === 'pending' || item.status === 'in_progress')

export const shouldShowThreadPlanPanel = (
  state: ThreadPlanState | null | undefined,
  _isStreaming: boolean,
  hiddenRevision?: number | null
): boolean => {
  if (!state || state.closed || state.items.length === 0) return false
  if (hiddenRevision === state.revision) return false
  return true
}
