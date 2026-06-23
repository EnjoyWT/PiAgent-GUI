import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemorySubagentStore } from '../../../src/main/subagents/subagent-store.ts'
import { SubagentScheduler } from '../../../src/main/subagents/subagent-scheduler.ts'
import { SubagentTaskManager } from '../../../src/main/subagents/subagent-task-manager.ts'
import type {
  StartWorkerAttemptInput,
  WorkerHandle,
  WorkerHostClient,
  WorkerHostEvent
} from '../../../src/main/subagents/subagent-types.ts'
import { testWorkerRuntimeModel } from './runtime-model-fixture.ts'

class FakeWorkerHostClient implements WorkerHostClient {
  readonly started: StartWorkerAttemptInput[] = []
  readonly canceled: unknown[] = []

  async startAttempt(input: StartWorkerAttemptInput): Promise<WorkerHandle> {
    this.started.push(input)
    return {
      taskId: input.taskId,
      attemptId: input.attemptId,
      processId: 1234,
      startedAt: input.createdAt
    }
  }

  async cancelAttempt(input: unknown): Promise<void> {
    this.canceled.push(input)
  }

  async disposeAttempt(): Promise<void> {}
}

const createManager = () => {
  const store = new InMemorySubagentStore({ now: () => '2026-05-21T00:00:00.000Z' })
  const scheduler = new SubagentScheduler({ globalMaxRunning: 1, perParentRunMaxRunning: 1 })
  const workerHost = new FakeWorkerHostClient()
  const changedGroups: string[] = []
  const manager = new SubagentTaskManager({
    store,
    scheduler,
    workerHost,
    now: () => '2026-05-21T00:00:00.000Z',
    idFactory: (prefix) => `${prefix}-1`,
    onGroupChanged: (groupId) => {
      changedGroups.push(groupId)
    }
  })
  return { manager, store, workerHost, changedGroups }
}

test('delegateWorkers is idempotent by parent run and tool call id', async () => {
  const { manager, workerHost } = createManager()
  const first = await manager.delegateWorkers({
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: 'message-1',
    parentToolCallId: 'tool-call-1',
    cwd: '/repo',
    runtimeModel: testWorkerRuntimeModel,
    tasks: [
      {
        label: 'Scout',
        instruction: 'Inspect scheduler',
        workspaceMode: 'readonly',
        toolAllowlist: ['read', 'grep']
      }
    ]
  })
  const second = await manager.delegateWorkers({
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: 'message-1',
    parentToolCallId: 'tool-call-1',
    cwd: '/repo',
    runtimeModel: testWorkerRuntimeModel,
    tasks: [
      {
        label: 'Scout',
        instruction: 'Inspect scheduler',
        workspaceMode: 'readonly',
        toolAllowlist: ['read', 'grep']
      }
    ]
  })

  assert.equal(second.groupId, first.groupId)
  assert.equal(second.tasks[0]?.taskId, first.tasks[0]?.taskId)
  assert.equal(workerHost.started.length, 1)
  assert.equal(workerHost.started[0]?.promptPackage.taskInstruction, 'Inspect scheduler')
  assert.deepEqual(workerHost.started[0]?.toolPolicy.activeToolNames, ['read', 'grep'])
})

test('waitForGroup timeout reports timeout without changing task status', async () => {
  const { manager, store } = createManager()
  const delegated = await manager.delegateWorkers({
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    cwd: '/repo',
    runtimeModel: testWorkerRuntimeModel,
    tasks: [
      {
        label: 'Scout',
        instruction: 'Inspect scheduler',
        workspaceMode: 'readonly',
        toolAllowlist: ['read']
      }
    ]
  })

  const result = await manager.waitForGroup({
    groupId: delegated.groupId,
    timeoutMs: 1
  })

  assert.equal(result.waitStatus, 'timeout')
  assert.equal(store.getTask(delegated.tasks[0]!.taskId)?.status, 'running')
  assert.equal(result.groupStatus, 'running')
})

test('worker business failure settles task without throwing infrastructure error', async () => {
  const { manager, store, changedGroups } = createManager()
  const delegated = await manager.delegateWorkers({
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    cwd: '/repo',
    runtimeModel: testWorkerRuntimeModel,
    tasks: [
      {
        label: 'Scout',
        instruction: 'Inspect scheduler',
        workspaceMode: 'readonly',
        toolAllowlist: ['read']
      }
    ]
  })
  const taskId = delegated.tasks[0]!.taskId
  const task = store.getTask(taskId)
  assert.ok(task?.currentAttemptId)

  const event: WorkerHostEvent = {
    kind: 'settle_attempt',
    groupId: delegated.groupId,
    taskId,
    attemptId: task.currentAttemptId,
    parentRunId: 'run-1',
    correlationId: 'correlation-1',
    sequence: 1,
    timestamp: '2026-05-21T00:00:01.000Z',
    result: {
      status: 'failed',
      summary: 'Could not inspect scheduler',
      findings: [],
      artifacts: [],
      blockers: ['read failed'],
      confidence: 'high',
      recommendedParentAction: 'retry',
      error: { code: 'worker_business_failed', message: 'read failed', retryable: true }
    }
  }

  await manager.ingestWorkerEvent(event)

  assert.equal(store.getTask(taskId)?.status, 'failed')
  assert.equal(store.getGroup(delegated.groupId)?.status, 'failed')
  assert.equal(store.getAttempt(task.currentAttemptId)?.status, 'failed')
  assert.deepEqual(changedGroups, [delegated.groupId, delegated.groupId])
})

test('worker infrastructure error releases scheduler slot and starts next queued task', async () => {
  const { manager, store, workerHost } = createManager()
  const delegated = await manager.delegateWorkers({
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    cwd: '/repo',
    runtimeModel: testWorkerRuntimeModel,
    tasks: [
      {
        label: 'Scout A',
        instruction: 'Inspect scheduler A',
        workspaceMode: 'readonly',
        toolAllowlist: ['read']
      },
      {
        label: 'Scout B',
        instruction: 'Inspect scheduler B',
        workspaceMode: 'readonly',
        toolAllowlist: ['read']
      }
    ]
  })
  const firstTaskId = delegated.tasks[0]!.taskId
  const secondTaskId = delegated.tasks[1]!.taskId
  const firstAttemptId = store.getTask(firstTaskId)!.currentAttemptId!

  assert.equal(workerHost.started.length, 1)
  assert.equal(store.getTask(secondTaskId)?.status, 'queued')

  await manager.ingestWorkerEvent({
    kind: 'worker_error',
    groupId: delegated.groupId,
    taskId: firstTaskId,
    attemptId: firstAttemptId,
    parentRunId: 'run-1',
    correlationId: 'correlation-1',
    sequence: 2,
    timestamp: '2026-05-21T00:00:02.000Z',
    error: {
      code: 'worker_runtime_error',
      message: 'worker process crashed',
      retryable: true
    }
  })

  assert.equal(store.getAttempt(firstAttemptId)?.status, 'worker_lost')
  assert.equal(store.getTask(firstTaskId)?.status, 'failed')
  assert.equal(store.getTask(secondTaskId)?.status, 'running')
  assert.equal(workerHost.started.length, 2)
  assert.equal(workerHost.started[1]?.promptPackage.taskInstruction, 'Inspect scheduler B')
})

test('collectWorkerResults returns completed result envelopes for a group', async () => {
  const { manager, store } = createManager()
  const delegated = await manager.delegateWorkers({
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    cwd: '/repo',
    runtimeModel: testWorkerRuntimeModel,
    tasks: [
      {
        label: 'Scout',
        instruction: 'Inspect scheduler',
        workspaceMode: 'readonly',
        toolAllowlist: ['read']
      }
    ]
  })
  const taskId = delegated.tasks[0]!.taskId
  const attemptId = store.getTask(taskId)!.currentAttemptId!
  await manager.ingestWorkerEvent({
    kind: 'settle_attempt',
    groupId: delegated.groupId,
    taskId,
    attemptId,
    parentRunId: 'run-1',
    correlationId: 'correlation-1',
    sequence: 2,
    timestamp: '2026-05-21T00:00:01.000Z',
    result: {
      status: 'completed',
      summary: 'Done',
      findings: [],
      artifacts: [],
      blockers: [],
      confidence: 'high',
      recommendedParentAction: 'collect_results'
    }
  })

  const result = manager.collectWorkerResults({ groupId: delegated.groupId })

  assert.equal(result.groupStatus, 'completed')
  assert.equal(result.completedResults[0]?.summary, 'Done')
})

test('retryWorker creates a new attempt without overwriting old attempt result', async () => {
  const { manager, store, workerHost } = createManager()
  const delegated = await manager.delegateWorkers({
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    cwd: '/repo',
    runtimeModel: testWorkerRuntimeModel,
    tasks: [
      {
        label: 'Scout',
        instruction: 'Inspect scheduler',
        workspaceMode: 'readonly',
        toolAllowlist: ['read']
      }
    ]
  })
  const taskId = delegated.tasks[0]!.taskId
  const firstAttemptId = store.getTask(taskId)!.currentAttemptId!
  await manager.ingestWorkerEvent({
    kind: 'settle_attempt',
    groupId: delegated.groupId,
    taskId,
    attemptId: firstAttemptId,
    parentRunId: 'run-1',
    correlationId: 'correlation-1',
    sequence: 2,
    timestamp: '2026-05-21T00:00:01.000Z',
    result: {
      status: 'failed',
      summary: 'Failed once',
      findings: [],
      artifacts: [],
      blockers: [],
      confidence: 'high',
      recommendedParentAction: 'retry',
      error: { code: 'worker_business_failed', message: 'failed once', retryable: true }
    }
  })

  const retry = await manager.retryWorker({ taskId })
  const attempts = store.listAttemptsByTask(taskId)

  assert.equal(retry.taskId, taskId)
  assert.equal(attempts.length, 2)
  assert.equal(attempts[0]?.result?.summary, 'Failed once')
  assert.equal(attempts[1]?.attemptNumber, 2)
  assert.equal(store.getTask(taskId)?.status, 'running')
  assert.equal(workerHost.started.length, 2)
})

test('cancelWorker marks running attempt cancel_requested and sends cancel to WorkerHost', async () => {
  const { manager, store, workerHost } = createManager()
  const delegated = await manager.delegateWorkers({
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    cwd: '/repo',
    runtimeModel: testWorkerRuntimeModel,
    tasks: [
      {
        label: 'Scout',
        instruction: 'Inspect scheduler',
        workspaceMode: 'readonly',
        toolAllowlist: ['read']
      }
    ]
  })
  const taskId = delegated.tasks[0]!.taskId
  const attemptId = store.getTask(taskId)!.currentAttemptId!

  const canceled = await manager.cancelWorker({ taskId, reason: 'user requested' })

  assert.equal(canceled.status, 'cancel_requested')
  assert.equal(store.getTask(taskId)?.status, 'cancel_requested')
  assert.equal(store.getAttempt(attemptId)?.status, 'cancel_requested')
  assert.equal((workerHost.canceled[0] as any).attemptId, attemptId)
  assert.equal((workerHost.canceled[0] as any).reason, 'user requested')
})
