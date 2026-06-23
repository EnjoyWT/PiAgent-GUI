import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemorySubagentStore } from '../../../src/main/subagents/subagent-store.ts'
import { SupervisorReporter } from '../../../src/main/subagents/supervisor-reporter.ts'

test('supervisor reporter returns deterministic group snapshot and event delta', () => {
  const store = new InMemorySubagentStore({ now: () => '2026-05-21T00:00:00.000Z' })
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
  store.appendEvent({
    id: 'event-1',
    groupId: 'group-1',
    kind: 'group_created',
    severity: 'info',
    payload: { taskCount: 1 },
    createdAt: '2026-05-21T00:00:00.000Z'
  })
  store.appendEvent({
    id: 'event-2',
    groupId: 'group-1',
    taskId: 'task-1',
    kind: 'progress',
    severity: 'info',
    payload: { summary: 'Reading files' },
    createdAt: '2026-05-21T00:00:01.000Z'
  })

  const reporter = new SupervisorReporter({ store })
  const report = reporter.buildGroupReport({ groupId: 'group-1', afterEventSeq: 1 })

  assert.equal(report.groupId, 'group-1')
  assert.equal(report.nextCursor, 2)
  assert.equal(report.tasks[0]?.status, 'running')
  assert.deepEqual(
    report.events.map((event) => event.groupEventSeq),
    [2]
  )
  assert.match(report.markdown, /group-1/)
  assert.match(report.markdown, /Scout/)
  assert.match(report.markdown, /Reading files/)
})
