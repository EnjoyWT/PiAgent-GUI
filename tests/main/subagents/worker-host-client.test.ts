import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { WorkerHostClientProcess } from '../../../src/main/subagents/worker-host-client.ts'
import type { StartWorkerAttemptInput, WorkerHostEvent } from '../../../src/main/subagents/subagent-types.ts'
import { testWorkerRuntimeModel } from './runtime-model-fixture.ts'

const createStartInput = (): StartWorkerAttemptInput => ({
  groupId: 'group-1',
  taskId: 'task-1',
  attemptId: 'attempt-1',
  parentConversationId: 'conversation-1',
  parentRunId: 'run-1',
  parentMessageId: null,
  parentToolCallId: 'tool-call-1',
  correlationId: 'correlation-1',
  attemptNumber: 1,
  createdAt: '2026-05-21T00:00:00.000Z',
  timeoutMs: 60_000,
  cwd: '/repo',
  workspace: { mode: 'readonly', readableRoots: ['/repo'], writableRoots: [] },
  promptPackage: {
    systemPrompt: 'You are a worker.',
    contextMessages: [],
    taskInstruction: 'Inspect scheduler',
    resultContract: 'Return JSON.'
  },
  permissionSnapshot: {
    readableRoots: ['/repo'],
    writableRoots: [],
    allowedTools: ['read'],
    deniedTools: ['delegate_workers'],
    network: { enabled: false },
    secrets: { mode: 'none' },
    shell: { enabled: false },
    environment: { allowedKeys: [] }
  },
  modelPolicy: { providerId: 'openai', modelId: 'gpt-5.4' },
  runtimeModel: testWorkerRuntimeModel,
  toolPolicy: { activeToolNames: ['read'], blockedToolNames: ['delegate_workers'] }
})

test('worker host client starts the configured worker-host-entry and sends start_attempt', async () => {
  const sentMessages: unknown[] = []
  const forkCalls: Array<{ modulePath: string; args: string[] }> = []
  const fakeChild = {
    pid: 1234,
    send: (message: unknown) => {
      sentMessages.push(message)
      return true
    },
    on: () => fakeChild,
    once: (eventName: string, callback: (message: unknown) => void) => {
      if (eventName === 'message') {
        queueMicrotask(() =>
          callback({
            kind: 'worker_ready',
            groupId: 'group-1',
            taskId: 'task-1',
            attemptId: 'attempt-1',
            parentRunId: 'run-1',
            correlationId: 'correlation-1',
            sequence: 1,
            timestamp: '2026-05-21T00:00:00.000Z',
            processId: 1234,
            workerSessionId: 'worker-session-1'
          })
        )
      }
      return fakeChild
    },
    kill: () => true
  }

  const client = new WorkerHostClientProcess({
    entryPath: '/app/src/main/subagents/worker-host-entry.ts',
    startTimeoutMs: 1000,
    fork: (modulePath, args) => {
      forkCalls.push({ modulePath, args })
      return fakeChild as any
    }
  })

  const handle = await client.startAttempt(createStartInput())

  assert.equal(handle.processId, 1234)
  assert.equal(forkCalls[0]?.modulePath, '/app/src/main/subagents/worker-host-entry.ts')
  assert.deepEqual(forkCalls[0]?.args, [])
  assert.equal((sentMessages[0] as any).kind, 'start_attempt')
  assert.equal((sentMessages[0] as any).input.attemptId, 'attempt-1')
})

test('worker host client times out if worker_ready is not received', async () => {
  const fakeChild = {
    pid: 1234,
    send: () => true,
    on: () => fakeChild,
    once: () => fakeChild,
    kill: () => true
  }
  const client = new WorkerHostClientProcess({
    entryPath: '/app/src/main/subagents/worker-host-entry.ts',
    startTimeoutMs: 1,
    fork: () => fakeChild as any
  })

  await assert.rejects(() => client.startAttempt(createStartInput()), /worker_ready/i)
})

test('worker host client forwards post-ready worker events to subscriber', async () => {
  const forwarded: WorkerHostEvent[] = []
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    send: (message: unknown) => boolean
    kill: () => boolean
  }
  child.pid = 1234
  child.send = (message: unknown) => {
    if ((message as any).kind === 'start_attempt') {
      queueMicrotask(() =>
        child.emit('message', {
          kind: 'worker_ready',
          groupId: 'group-1',
          taskId: 'task-1',
          attemptId: 'attempt-1',
          parentRunId: 'run-1',
          correlationId: 'correlation-1',
          sequence: 1,
          timestamp: '2026-05-21T00:00:00.000Z',
          processId: 1234,
          workerSessionId: 'worker-session-1'
        })
      )
    }
    return true
  }
  child.kill = () => true
  const client = new WorkerHostClientProcess({
    entryPath: '/app/src/main/subagents/worker-host-entry.ts',
    onEvent: (event) => forwarded.push(event),
    fork: () => child as any
  })

  await client.startAttempt(createStartInput())
  child.emit('message', {
    kind: 'runtime_event',
    groupId: 'group-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    parentRunId: 'run-1',
    correlationId: 'correlation-1',
    sequence: 2,
    timestamp: '2026-05-21T00:00:01.000Z',
    runtimeEventId: 'runtime-event-1',
    eventType: 'message_update',
    payload: { text: 'working' }
  })
  child.emit('message', {
    kind: 'settle_attempt',
    groupId: 'group-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    parentRunId: 'run-1',
    correlationId: 'correlation-1',
    sequence: 3,
    timestamp: '2026-05-21T00:00:02.000Z',
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

  assert.deepEqual(
    forwarded.map((event) => event.kind),
    ['runtime_event', 'settle_attempt']
  )
})

test('worker host client kills worker after cancel grace if worker does not acknowledge', async () => {
  let killed = false
  const sentMessages: unknown[] = []
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    send: (message: unknown) => boolean
    kill: () => boolean
  }
  child.pid = 1234
  child.send = (message: unknown) => {
    sentMessages.push(message)
    if ((message as any).kind === 'start_attempt') {
      queueMicrotask(() =>
        child.emit('message', {
          kind: 'worker_ready',
          groupId: 'group-1',
          taskId: 'task-1',
          attemptId: 'attempt-1',
          parentRunId: 'run-1',
          correlationId: 'correlation-1',
          sequence: 1,
          timestamp: '2026-05-21T00:00:00.000Z',
          processId: 1234,
          workerSessionId: 'worker-session-1'
        })
      )
    }
    return true
  }
  child.kill = () => {
    killed = true
    return true
  }
  const client = new WorkerHostClientProcess({
    entryPath: '/app/src/main/subagents/worker-host-entry.ts',
    cancelGraceMs: 1,
    fork: () => child as any
  })
  const input = createStartInput()

  await client.startAttempt(input)
  await client.cancelAttempt({
    groupId: input.groupId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    parentRunId: input.parentRunId,
    correlationId: input.correlationId,
    reason: 'user requested'
  })
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.equal((sentMessages.at(-1) as any).kind, 'cancel_attempt')
  assert.equal(killed, true)
})

test('worker host client emits worker_killed_after_cancel when cancel grace expires', async () => {
  const forwarded: WorkerHostEvent[] = []
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    send: (message: unknown) => boolean
    kill: () => boolean
  }
  child.pid = 1234
  child.send = (message: unknown) => {
    if ((message as any).kind === 'start_attempt') {
      queueMicrotask(() =>
        child.emit('message', {
          kind: 'worker_ready',
          groupId: 'group-1',
          taskId: 'task-1',
          attemptId: 'attempt-1',
          parentRunId: 'run-1',
          correlationId: 'correlation-1',
          sequence: 1,
          timestamp: '2026-05-21T00:00:00.000Z',
          processId: 1234,
          workerSessionId: 'worker-session-1'
        })
      )
    }
    return true
  }
  child.kill = () => true
  const client = new WorkerHostClientProcess({
    entryPath: '/app/src/main/subagents/worker-host-entry.ts',
    cancelGraceMs: 1,
    onEvent: (event) => forwarded.push(event),
    fork: () => child as any
  })
  const input = createStartInput()

  await client.startAttempt(input)
  await client.cancelAttempt({
    groupId: input.groupId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    parentRunId: input.parentRunId,
    correlationId: input.correlationId,
    reason: 'user requested'
  })
  await new Promise((resolve) => setTimeout(resolve, 5))

  const workerError = forwarded.find((event) => event.kind === 'worker_error') as
    | Extract<WorkerHostEvent, { kind: 'worker_error' }>
    | undefined
  assert.equal(workerError?.error.code, 'worker_killed_after_cancel')
  assert.equal(workerError?.attemptId, 'attempt-1')
})
