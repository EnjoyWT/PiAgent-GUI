import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSubagentPanelSetEvent } from '../../../src/main/subagents/subagent-panel-projection.ts'
import { InMemorySubagentStore } from '../../../src/main/subagents/subagent-store.ts'

test('buildSubagentPanelSetEvent projects group tasks for the parent thread panel', () => {
  const store = new InMemorySubagentStore({ now: () => '2026-05-21T00:00:00.000Z' })
  store.createGroup({
    id: 'group-1',
    parentConversationId: 'thread-1',
    parentRunId: 'run-1',
    parentMessageId: 'message-1',
    parentToolCallId: 'tool-call-1',
    status: 'running',
    waitStrategy: 'all_settled',
    createdAt: '2026-05-21T00:00:00.000Z'
  })
  store.createTask({
    id: 'task-1',
    groupId: 'group-1',
    parentConversationId: 'thread-1',
    parentRunId: 'run-1',
    label: 'Review API',
    instruction: 'Review API changes',
    status: 'running',
    depth: 0,
    workspaceMode: 'readonly',
    cwd: '/repo',
    toolAllowlist: ['read'],
    retryCount: 0,
    currentAttemptId: 'attempt-1',
    createdAt: '2026-05-21T00:00:00.000Z'
  })
  store.createTask({
    id: 'task-2',
    groupId: 'group-1',
    parentConversationId: 'thread-1',
    parentRunId: 'run-1',
    label: null,
    instruction: 'Run tests',
    status: 'queued',
    depth: 0,
    workspaceMode: 'readonly',
    cwd: '/repo',
    toolAllowlist: ['read'],
    retryCount: 1,
    createdAt: '2026-05-21T00:00:00.000Z'
  })
  store.appendEvent({
    id: 'event-1',
    groupId: 'group-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    kind: 'progress',
    severity: 'info',
    payload: { summary: 'Inspecting routes', currentToolName: 'read' },
    createdAt: '2026-05-21T00:00:01.000Z'
  })

  const event = buildSubagentPanelSetEvent({ store, groupId: 'group-1' })

  assert.equal(event.type, 'set')
  assert.equal(event.state.threadId, 'thread-1')
  assert.equal(event.state.revision, 1)
  assert.equal(event.state.group.groupId, 'group-1')
  assert.equal(event.state.group.status, 'running')
  assert.deepEqual(
    event.state.group.workers.map((worker) => ({
      taskId: worker.taskId,
      title: worker.title,
      status: worker.status,
      attemptId: worker.attemptId,
      retryCount: worker.retryCount,
      latestProgress: worker.latestProgress
    })),
    [
      {
        taskId: 'task-1',
        title: 'Review API',
        status: 'running',
        attemptId: 'attempt-1',
        retryCount: 0,
        latestProgress: 'Inspecting routes'
      },
      {
        taskId: 'task-2',
        title: 'Run tests',
        status: 'queued',
        attemptId: null,
        retryCount: 1,
        latestProgress: null
      }
    ]
  )
})

