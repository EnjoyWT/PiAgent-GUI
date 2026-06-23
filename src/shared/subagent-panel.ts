export type SubagentPanelGroupStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'canceled'
  | 'timed_out'
  | 'interrupted'

export type SubagentPanelWorkerStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'timed_out'
  | 'cancel_requested'
  | 'canceled'
  | 'interrupted'

export type SubagentPanelWorker = {
  taskId: string
  title: string
  status: SubagentPanelWorkerStatus
  attemptId: string | null
  retryCount: number
  latestProgress: string | null
  resultSummary: string | null
  error: string | null
  startedAt: string | null
  settledAt: string | null
}

export type SubagentPanelGroup = {
  groupId: string
  parentRunId: string
  parentToolCallId: string
  status: SubagentPanelGroupStatus
  revision: number
  createdAt: string
  startedAt: string | null
  settledAt: string | null
  workers: SubagentPanelWorker[]
}

export type SubagentPanelState = {
  threadId: string
  revision: number
  group: SubagentPanelGroup
  updatedAt: string
}

export type SubagentPanelEvent =
  | {
      type: 'set'
      state: SubagentPanelState
    }
  | {
      type: 'clear'
      threadId: string
    }
