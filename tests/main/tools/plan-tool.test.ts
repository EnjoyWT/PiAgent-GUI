import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlanTools, normalizeSetPlanToolParams } from '../../../src/main/tools/plan-tool.ts'
import type { ThreadPlanState } from '../../../src/shared/thread-plan.ts'

const createState = (input: Partial<ThreadPlanState>): ThreadPlanState => ({
  threadId: input.threadId ?? 'thread-plan-1',
  conversationId: input.conversationId ?? 'conversation-plan-1',
  revision: input.revision ?? 1,
  activeRunId: input.activeRunId ?? null,
  sourceToolCallId: input.sourceToolCallId ?? null,
  items: input.items ?? [],
  closed: input.closed ?? false,
  updatedAt: input.updatedAt ?? '2026-05-11T00:00:00.000Z'
})

test('normalizeSetPlanToolParams trims steps and preserves ordered statuses', () => {
  const normalized = normalizeSetPlanToolParams({
    explanation: 'Track implementation progress',
    plan: [
      { step: ' Inspect runtime tools ', status: 'completed' },
      { step: 'Persist thread state', status: 'inProgress' },
      { step: 'Render panel', status: 'pending' }
    ]
  })

  assert.deepEqual(normalized, {
    items: [
      { id: '1', text: 'Inspect runtime tools', status: 'completed' },
      { id: '2', text: 'Persist thread state', status: 'in_progress' },
      { id: '3', text: 'Render panel', status: 'pending' }
    ]
  })
})

test('normalizeSetPlanToolParams rejects more than one active item', () => {
  assert.throws(
    () =>
      normalizeSetPlanToolParams({
        plan: [
          { step: 'One', status: 'inProgress' },
          { step: 'Two', status: 'inProgress' }
        ]
      }),
    /at most one inProgress/i
  )
})

test('normalizeSetPlanToolParams rejects empty plans', () => {
  assert.throws(
    () =>
      normalizeSetPlanToolParams({
        plan: []
      }),
    /setPlanTool requires at least one plan item/i
  )
})

test('setPlanTool persists the full open thread snapshot', async () => {
  const savedStates: ThreadPlanState[] = []
  const tools = createPlanTools({
    threadId: 'thread-plan-1',
    conversationId: 'conversation-plan-1',
    getActiveRunId: () => 'run-plan-1',
    getPlanState: () => null,
    upsertPlanState: (input) => {
      const saved = createState({
        threadId: input.threadId,
        conversationId: input.conversationId,
        revision: 1,
        activeRunId: input.activeRunId ?? null,
        sourceToolCallId: input.sourceToolCallId ?? null,
        items: input.items,
        closed: input.closed ?? false
      })
      savedStates.push(saved)
      return saved
    },
    emitPlanEvent: () => {}
  })
  const tool = tools.find((candidate) => candidate.name === 'setPlanTool')
  assert.ok(tool)

  const result = await tool.execute(
    'tool-call-plan-1',
    {
      explanation: 'Track implementation progress',
      plan: [
        { step: 'Write tests', status: 'completed' },
        { step: 'Implement state', status: 'inProgress' },
        { step: 'Wire UI', status: 'pending' }
      ]
    } as any,
    undefined,
    undefined,
    {} as any
  )

  const saved = savedStates[0]
  assert.ok(saved)
  assert.equal(saved.threadId, 'thread-plan-1')
  assert.equal(saved.activeRunId, 'run-plan-1')
  assert.equal(saved.sourceToolCallId, 'tool-call-plan-1')
  assert.equal(saved.closed, false)
  assert.equal(saved.items[1]?.text, 'Implement state')
  assert.equal((result.details as any).status, 'updated')
  assert.equal((result.details as any).revision, 1)
})

test('closePlanTool persists closed state without clearing the last snapshot', async () => {
  const existing = createState({
    revision: 4,
    items: [
      { id: '1', text: 'Write tests', status: 'completed' },
      { id: '2', text: 'Implement state', status: 'completed' }
    ]
  })
  const savedStates: ThreadPlanState[] = []
  const tools = createPlanTools({
    threadId: 'thread-plan-1',
    conversationId: 'conversation-plan-1',
    getActiveRunId: () => null,
    getPlanState: () => existing,
    upsertPlanState: (input) => {
      const saved = createState({
        threadId: input.threadId,
        conversationId: input.conversationId,
        revision: existing.revision + 1,
        activeRunId: input.activeRunId ?? null,
        sourceToolCallId: input.sourceToolCallId ?? null,
        items: input.items,
        closed: input.closed ?? false
      })
      savedStates.push(saved)
      return saved
    },
    emitPlanEvent: () => {}
  })
  const tool = tools.find((candidate) => candidate.name === 'closePlanTool')
  assert.ok(tool)

  const result = await tool.execute(
    'tool-call-plan-close',
    {} as any,
    undefined,
    undefined,
    {} as any
  )

  const saved = savedStates[0]
  assert.ok(saved)
  assert.equal(saved.closed, true)
  assert.equal(saved.items.length, existing.items.length)
  assert.equal(saved.items[1]?.text, 'Implement state')
  assert.equal((result.details as any).status, 'closed')
  assert.equal((result.details as any).revision, 5)
})
