import type { ThreadTitleRunStatus } from './thread-title-coordinator'

export type ThreadTitleRefinement = (input: {
  threadId: string
  status: ThreadTitleRunStatus
}) => void | Promise<void>

export const scheduleThreadTitleRefinement = (
  input: { threadId: string; status: ThreadTitleRunStatus },
  refineAfterRun: ThreadTitleRefinement,
  schedule: (callback: () => void, delay: number) => unknown = window.setTimeout
): void => {
  if (input.status !== 'finished') {
    void refineAfterRun(input)
    return
  }

  schedule(() => {
    void refineAfterRun(input)
  }, 250)
}
