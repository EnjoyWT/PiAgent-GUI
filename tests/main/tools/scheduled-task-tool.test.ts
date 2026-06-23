import test from 'node:test'
import assert from 'node:assert/strict'
import { createScheduledTaskTool } from '../../../src/main/tools/scheduled-task-tool.ts'
import type { ScheduledTask } from '../../../src/shared/scheduled-tasks.ts'

const createTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 'task-123',
  taskType: 'scheduled_task',
  name: 'Every minute reminder',
  description: 'Test reminder',
  status: 'scheduled',
  enabled: true,
  scheduleKind: 'every',
  schedule: {
    kind: 'every',
    intervalMs: 60000,
    anchorAt: '2026-04-27T03:42:12.302Z'
  },
  scheduleDisplay: 'every 1m',
  timezone: 'Asia/Shanghai',
  nextRunAt: '2026-04-27T03:43:12.302Z',
  executionMode: 'main_thread',
  targetConversationId: 'conversation-1',
  targetThreadId: 'thread-1',
  workspacePath: null,
  prompt: 'Send a reminder.',
  triggerExecutionOverride: null,
  deliveryPolicy: {
    mode: 'thread_only',
    suppressOnSilent: true,
    notifyOnFailure: true,
    target: null
  },
  concurrencyPolicy: 'forbid',
  misfirePolicy: 'run_once',
  retryPolicy: {
    maxAttempts: 1,
    baseDelayMs: 1000,
    maxDelayMs: 1000,
    backoff: 'fixed'
  },
  timeoutPolicy: {
    wallClockMs: null,
    inactivityMs: null
  },
  leaseOwner: null,
  leaseUntil: null,
  lastRunId: null,
  lastRunAt: '2026-04-27T11:42:27.306+08:00',
  lastRunStatus: 'succeeded',
  lastErrorText: null,
  createdAt: '2026-04-27T11:42:12.302+08:00',
  updatedAt: '2026-04-27T11:42:27.310+08:00',
  deletedAt: null,
  ...overrides
})

const getFirstText = (
  result: Awaited<ReturnType<ReturnType<typeof createScheduledTaskTool>['execute']>>
) => {
  const first = result.content[0]
  return first?.type === 'text' ? first.text : ''
}

test('scheduledTaskTool list_tasks returns model-visible task summaries with ids', async () => {
  const task = createTask()
  const tool = createScheduledTaskTool({
    context: {
      conversationId: 'conversation-1',
      interactionThreadId: 'thread-1',
      interactionController: {} as any
    },
    scheduledTaskService: {
      listTasks: async () => [task]
    } as any
  })

  const result = await tool.execute(
    'tool-list-tasks',
    { action: 'list_tasks' } as any,
    undefined,
    undefined,
    {} as any
  )

  const text = getFirstText(result)
  assert.match(text, /已返回 1 个定时任务/)
  assert.match(text, /taskId=task-123/)
  assert.match(text, /name=Every minute reminder/)
  assert.match(text, /status=scheduled/)
  assert.match(text, /schedule=every 1m/)
  assert.match(text, /targetThreadId=thread-1/)
  assert.equal((result.details as any).tasks[0].id, 'task-123')
})
