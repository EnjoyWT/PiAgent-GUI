import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldShowThreadPlanPanel } from '../../../src/renderer/src/utils/thread-plan.ts'
import type { ThreadPlanState } from '../../../src/shared/thread-plan.ts'

const createState = (items: ThreadPlanState['items']): ThreadPlanState => ({
  threadId: 'thread-plan-ui',
  conversationId: 'conversation-plan-ui',
  revision: 1,
  activeRunId: null,
  sourceToolCallId: null,
  items,
  closed: false,
  updatedAt: '2026-05-11T00:00:00.000Z'
})

test('todo panel is visible while a plan has open work', () => {
  assert.equal(
    shouldShowThreadPlanPanel(
      createState([
        { id: '1', text: 'Done', status: 'completed' },
        { id: '2', text: 'Current', status: 'in_progress' },
        { id: '3', text: 'Next', status: 'pending' }
      ]),
      false
    ),
    true
  )
})

test('todo panel remains visible for completed snapshots until explicitly hidden', () => {
  const state = createState([{ id: '1', text: 'Done', status: 'completed' }])

  assert.equal(shouldShowThreadPlanPanel(state, false), true)
  assert.equal(shouldShowThreadPlanPanel(state, true), true)
})

test('todo panel hides only the user-dismissed revision', () => {
  const hiddenState = createState([{ id: '1', text: 'Current', status: 'in_progress' }])
  const nextState = { ...hiddenState, revision: hiddenState.revision + 1 }

  assert.equal(shouldShowThreadPlanPanel(hiddenState, false, hiddenState.revision), false)
  assert.equal(shouldShowThreadPlanPanel(nextState, false, hiddenState.revision), true)
})

test('todo panel hides when the plan tool explicitly closes it', () => {
  const state = {
    ...createState([{ id: '1', text: 'Done', status: 'completed' }]),
    closed: true
  }

  assert.equal(shouldShowThreadPlanPanel(state, false), false)
})
