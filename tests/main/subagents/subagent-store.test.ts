import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemorySubagentStore } from '../../../src/main/subagents/subagent-store.ts'

const createStore = () => new InMemorySubagentStore({ now: () => '2026-05-21T00:00:00.000Z' })

test('subagent store assigns group-scoped event sequence and deduplicates runtime events', () => {
  const store = createStore()
  store.createGroup({
    id: 'group-1',
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: 'message-1',
    parentToolCallId: 'tool-call-1',
    status: 'queued',
    waitStrategy: 'all_settled',
    createdAt: '2026-05-21T00:00:00.000Z'
  })
  store.createTask({
    id: 'task-1',
    groupId: 'group-1',
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    label: 'Scout',
    instruction: 'Inspect scheduler',
    status: 'queued',
    depth: 0,
    workspaceMode: 'readonly',
    cwd: '/repo',
    toolAllowlist: ['read', 'grep'],
    retryCount: 0,
    createdAt: '2026-05-21T00:00:00.000Z'
  })

  const first = store.appendEvent({
    id: 'event-1',
    groupId: 'group-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    kind: 'runtime_event',
    runtimeEventId: 'runtime-event-1',
    severity: 'info',
    payload: { type: 'agentMessageStarted' },
    createdAt: '2026-05-21T00:00:01.000Z'
  })
  const duplicate = store.appendEvent({
    id: 'event-duplicate',
    groupId: 'group-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    kind: 'runtime_event',
    runtimeEventId: 'runtime-event-1',
    severity: 'info',
    payload: { type: 'agentMessageStarted' },
    createdAt: '2026-05-21T00:00:02.000Z'
  })
  const second = store.appendEvent({
    id: 'event-2',
    groupId: 'group-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    kind: 'progress',
    severity: 'info',
    payload: { summary: 'Reading files' },
    createdAt: '2026-05-21T00:00:03.000Z'
  })

  assert.equal(first.groupEventSeq, 1)
  assert.equal(duplicate.id, first.id)
  assert.equal(second.groupEventSeq, 2)
  assert.deepEqual(
    store.listEventsByGroup('group-1').map((event) => event.id),
    ['event-1', 'event-2']
  )
})

test('subagent store updates task status and appends event in one operation', () => {
  const store = createStore()
  store.createGroup({
    id: 'group-1',
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    status: 'queued',
    waitStrategy: 'all_settled',
    createdAt: '2026-05-21T00:00:00.000Z'
  })
  store.createTask({
    id: 'task-1',
    groupId: 'group-1',
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    label: 'Scout',
    instruction: 'Inspect scheduler',
    status: 'queued',
    depth: 0,
    workspaceMode: 'readonly',
    cwd: '/repo',
    toolAllowlist: ['read'],
    retryCount: 0,
    createdAt: '2026-05-21T00:00:00.000Z'
  })

  const event = store.updateTaskStatusWithEvent('task-1', 'running', {
    id: 'event-1',
    groupId: 'group-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    kind: 'task_started',
    severity: 'info',
    payload: {},
    createdAt: '2026-05-21T00:00:04.000Z'
  })

  assert.equal(event.groupEventSeq, 1)
  assert.equal(store.getTask('task-1')?.status, 'running')
  assert.equal(store.listEventsByGroup('group-1')[0]?.kind, 'task_started')
})

test('subagent store startup repair marks in-flight records as interrupted or worker_lost', () => {
  const store = createStore()
  store.createGroup({
    id: 'group-1',
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    status: 'running',
    waitStrategy: 'all_settled',
    createdAt: '2026-05-21T00:00:00.000Z'
  })
  store.createTask({
    id: 'task-1',
    groupId: 'group-1',
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    label: 'Scout',
    instruction: 'Inspect scheduler',
    status: 'running',
    depth: 0,
    workspaceMode: 'readonly',
    cwd: '/repo',
    toolAllowlist: ['read'],
    retryCount: 0,
    createdAt: '2026-05-21T00:00:00.000Z'
  })
  store.createAttempt({
    id: 'attempt-1',
    groupId: 'group-1',
    taskId: 'task-1',
    parentRunId: 'run-1',
    attemptNumber: 1,
    status: 'running',
    createdAt: '2026-05-21T00:00:00.000Z'
  })

  const repaired = store.repairInFlightAfterStartup({
    repairedAt: '2026-05-21T00:00:10.000Z',
    reason: 'app restarted'
  })

  assert.deepEqual(repaired, { groups: 1, tasks: 1, attempts: 1 })
  assert.equal(store.getGroup('group-1')?.status, 'interrupted')
  assert.equal(store.getTask('task-1')?.status, 'interrupted')
  assert.equal(store.getAttempt('attempt-1')?.status, 'worker_lost')
  assert.equal(store.getAttempt('attempt-1')?.error, 'app restarted')
})
