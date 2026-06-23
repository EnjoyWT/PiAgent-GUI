import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SqliteSubagentStore } from '../../../src/main/subagents/sqlite-subagent-store.ts'

const createStore = (db = new Database(':memory:')) => {
  const store = new SqliteSubagentStore(db, { now: () => '2026-05-21T00:00:00.000Z' })
  return { db, store }
}

test('sqlite subagent store persists groups tasks attempts and events across instances', (t) => {
  const { db, store } = createStore()
  t.after(() => db.close())

  store.createGroup({
    id: 'group-1',
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    idempotencyKey: 'run-1:tool-call-1:',
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
    toolAllowlist: ['read', 'grep'],
    retryCount: 0,
    currentAttemptId: null,
    createdAt: '2026-05-21T00:00:00.000Z'
  })
  store.createAttempt({
    id: 'attempt-1',
    taskId: 'task-1',
    groupId: 'group-1',
    parentRunId: 'run-1',
    correlationId: 'correlation-1',
    attemptNumber: 1,
    status: 'running',
    createdAt: '2026-05-21T00:00:00.000Z'
  })
  const event = store.appendEvent({
    id: 'event-1',
    groupId: 'group-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    kind: 'progress',
    severity: 'info',
    payload: { summary: 'Reading files' },
    createdAt: '2026-05-21T00:00:01.000Z'
  })

  const reloaded = new SqliteSubagentStore(db, { now: () => '2026-05-21T00:00:00.000Z' })

  assert.equal(reloaded.findGroupByIdempotencyKey('run-1:tool-call-1:')?.id, 'group-1')
  assert.equal(reloaded.getTask('task-1')?.currentAttemptId, 'attempt-1')
  assert.deepEqual(reloaded.getTask('task-1')?.toolAllowlist, ['read', 'grep'])
  assert.equal(reloaded.getAttempt('attempt-1')?.correlationId, 'correlation-1')
  assert.equal(event.groupEventSeq, 1)
  assert.equal((reloaded.listEventsByGroup('group-1')[0]?.payload as any)?.summary, 'Reading files')
})

test('sqlite subagent store deduplicates runtime events per attempt', (t) => {
  const { db, store } = createStore()
  t.after(() => db.close())
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

  const first = store.appendEvent({
    id: 'event-1',
    groupId: 'group-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    kind: 'runtime_event',
    runtimeEventId: 'runtime-event-1',
    severity: 'info',
    payload: { type: 'message_update' },
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
    payload: { type: 'message_update' },
    createdAt: '2026-05-21T00:00:02.000Z'
  })

  assert.equal(duplicate.id, first.id)
  assert.equal(store.listEventsByGroup('group-1').length, 1)
})
