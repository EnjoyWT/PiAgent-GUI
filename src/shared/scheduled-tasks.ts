import type { ConversationExecutionOverride } from '../main/core-v2/domain.ts'

export type ScheduledTaskType = 'scheduled_task' | 'heartbeat'
export type ScheduledTaskStatus =
  | 'scheduled'
  | 'paused'
  | 'running'
  | 'completed'
  | 'disabled'
  | 'deleted'
export type ScheduledTaskRunStatus =
  | 'claimed'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'timed_out'

export type ScheduledTaskSchedule =
  | {
      kind: 'at'
      runAt: string
    }
  | {
      kind: 'every'
      intervalMs: number
      anchorAt?: string | null
    }
  | {
      kind: 'cron'
      expression: string
    }

export type ScheduledTaskDeliveryPolicy = {
  mode: 'thread_only' | 'thread_and_notify' | 'external' | 'silent'
  suppressOnSilent: boolean
  notifyOnFailure: boolean
  target?: {
    kind: 'conversation' | 'thread' | 'external'
    conversationId?: string | null
    threadId?: string | null
    bindingId?: string | null
  } | null
}

export type ScheduledTaskRetryPolicy = {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  backoff: 'fixed' | 'exponential'
}

export type ScheduledTaskTimeoutPolicy = {
  wallClockMs: number | null
  inactivityMs: number | null
}

export type ScheduledTask = {
  id: string
  taskType: ScheduledTaskType
  name: string
  description: string | null
  status: ScheduledTaskStatus
  enabled: boolean
  scheduleKind: ScheduledTaskSchedule['kind']
  schedule: ScheduledTaskSchedule
  scheduleDisplay: string
  timezone: string
  nextRunAt: string | null
  executionMode: 'main_thread' | 'isolated_thread'
  targetConversationId: string | null
  targetThreadId: string | null
  workspacePath: string | null
  prompt: string
  triggerExecutionOverride: ConversationExecutionOverride | null
  deliveryPolicy: ScheduledTaskDeliveryPolicy
  concurrencyPolicy: 'forbid' | 'queue' | 'replace'
  misfirePolicy: 'skip' | 'run_once' | 'catch_up_limited'
  retryPolicy: ScheduledTaskRetryPolicy
  timeoutPolicy: ScheduledTaskTimeoutPolicy
  leaseOwner: string | null
  leaseUntil: string | null
  lastRunId: string | null
  lastRunAt: string | null
  lastRunStatus: ScheduledTaskRunStatus | null
  lastErrorText: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type ScheduledTaskRun = {
  id: string
  taskId: string
  status: ScheduledTaskRunStatus
  scheduledFor: string
  startedAt: string | null
  endedAt: string | null
  attempt: number
  agentRunId: string | null
  conversationId: string | null
  threadId: string | null
  leaseOwner: string | null
  errorText: string | null
  resultSummary: string | null
  deliveryStatus: string | null
  deliveryErrorText: string | null
  createdAt: string
  updatedAt: string
}

export type CreateScheduledTaskInput = {
  name: string
  prompt: string
  schedule: string | ScheduledTaskSchedule
  description?: string | null
  taskType?: ScheduledTaskType
  timezone?: string | null
  executionMode?: ScheduledTask['executionMode']
  targetConversationId?: string | null
  targetThreadId?: string | null
  workspacePath?: string | null
  modelProviderId?: string | null
  modelId?: string | null
  triggerExecutionOverride?: ConversationExecutionOverride | null
  deliveryPolicy?: Partial<ScheduledTaskDeliveryPolicy> | null
  concurrencyPolicy?: ScheduledTask['concurrencyPolicy']
  misfirePolicy?: ScheduledTask['misfirePolicy']
  retryPolicy?: Partial<ScheduledTaskRetryPolicy> | null
  timeoutPolicy?: Partial<ScheduledTaskTimeoutPolicy> | null
}

export type UpdateScheduledTaskInput = Partial<CreateScheduledTaskInput> & {
  id: string
  enabled?: boolean
  status?: ScheduledTaskStatus
}

export type ScheduledTaskValidationResult =
  | {
      ok: true
      task: Omit<
        ScheduledTask,
        | 'id'
        | 'leaseOwner'
        | 'leaseUntil'
        | 'lastRunId'
        | 'lastRunAt'
        | 'lastRunStatus'
        | 'lastErrorText'
        | 'createdAt'
        | 'updatedAt'
        | 'deletedAt'
      >
    }
  | {
      ok: false
      errorCode: 'VALIDATION_ERROR'
      message: string
      fieldErrors: Array<{ path: string; message: string }>
    }
