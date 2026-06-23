import test from 'node:test'
import assert from 'node:assert/strict'
const {
  canAbortFromRuntimeState,
  resetQueueControllerAfterAbort,
  shouldQueueComposerSend
} = await import('../../../src/renderer/src/utils/app-queue-state.ts')

test('canAbortFromRuntimeState disables repeat abort while aborting', () => {
  assert.equal(canAbortFromRuntimeState('running', false), true)
  assert.equal(canAbortFromRuntimeState('idle', true), true)
  assert.equal(canAbortFromRuntimeState('aborting', true), false)
  assert.equal(canAbortFromRuntimeState('aborting', false), false)
})

test('shouldQueueComposerSend blocks sends while aborting', () => {
  assert.equal(shouldQueueComposerSend('running', false), true)
  assert.equal(shouldQueueComposerSend('dispatching', false), true)
  assert.equal(shouldQueueComposerSend('aborting', true), false)
  assert.equal(shouldQueueComposerSend('aborting', false), false)
  assert.equal(shouldQueueComposerSend('idle', false), false)
})

test('resetQueueControllerAfterAbort restores idle auto dispatch', () => {
  const controller = {
    activeRunId: 'run-1',
    runtimeState: 'aborting' as const,
    dispatchPolicy: 'paused' as const,
    postRunAction: { type: 'hold' }
  }
  resetQueueControllerAfterAbort(controller)
  assert.equal(controller.activeRunId, null)
  assert.equal(controller.runtimeState, 'idle')
  assert.equal(controller.dispatchPolicy, 'auto')
  assert.equal(controller.postRunAction.type, 'none')
})
