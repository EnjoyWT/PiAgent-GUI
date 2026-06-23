export type ThreadPlanItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export type ThreadPlanItem = {
  id: string
  text: string
  status: ThreadPlanItemStatus
}

export type ThreadPlanState = {
  threadId: string
  conversationId?: string | null
  revision: number
  activeRunId?: string | null
  sourceToolCallId?: string | null
  items: ThreadPlanItem[]
  closed: boolean
  updatedAt: string
}

export type UpsertThreadPlanStateInput = {
  threadId: string
  conversationId?: string | null
  activeRunId?: string | null
  sourceToolCallId?: string | null
  items: ThreadPlanItem[]
  closed?: boolean
  updatedAt?: string | number | Date | null
}

export type ThreadPlanEvent =
  | {
      type: 'set'
      state: ThreadPlanState
    }
  | {
      type: 'clear'
      threadId: string
    }
