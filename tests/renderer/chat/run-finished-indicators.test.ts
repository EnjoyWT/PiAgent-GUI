import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clearRunFinishedIndicator,
  markRunFinishedIndicatorIfNeeded
} from '../../../src/renderer/src/utils/app-run-finished-indicators.ts'

test('markRunFinishedIndicatorIfNeeded marks inactive threads', () => {
  const result = markRunFinishedIndicatorIfNeeded(
    {},
    {
      finishedThreadId: 'thread-2',
      activeThreadId: 'thread-1',
      notificationShown: false
    }
  )

  assert.deepEqual(result, { 'thread-2': true })
})

test('markRunFinishedIndicatorIfNeeded marks active thread when notification was shown', () => {
  const result = markRunFinishedIndicatorIfNeeded(
    {},
    {
      finishedThreadId: 'thread-1',
      activeThreadId: 'thread-1',
      notificationShown: true
    }
  )

  assert.deepEqual(result, { 'thread-1': true })
})

test('markRunFinishedIndicatorIfNeeded skips active foreground completions', () => {
  const previous = { 'thread-2': true }
  const result = markRunFinishedIndicatorIfNeeded(previous, {
    finishedThreadId: 'thread-1',
    activeThreadId: 'thread-1',
    notificationShown: false
  })

  assert.equal(result, previous)
})

test('clearRunFinishedIndicator removes one thread without mutating the previous map', () => {
  const previous = { 'thread-1': true, 'thread-2': true }
  const result = clearRunFinishedIndicator(previous, 'thread-1')

  assert.deepEqual(result, { 'thread-2': true })
  assert.deepEqual(previous, { 'thread-1': true, 'thread-2': true })
})
