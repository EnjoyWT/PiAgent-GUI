import test from 'node:test'
import assert from 'node:assert/strict'
import { createThreadTitleCoordinator } from '../../../src/renderer/src/utils/thread-title-coordinator.ts'
import { scheduleThreadTitleRefinement } from '../../../src/renderer/src/utils/thread-title-lifecycle.ts'

test('aborted refinements bypass the timer and clear the pending title synchronously', async () => {
  const generatedTitles: string[] = []
  const coordinator = createThreadTitleCoordinator({
    buildFallbackTitle: () => '首条消息',
    generateTitle: async ({ text }) => {
      generatedTitles.push(text)
      return '精炼标题'
    },
    persistTitle: async () => {},
    getCurrentTitle: () => '首条消息',
    isThreadIdle: () => true
  })
  coordinator.reserve({ threadId: 'thread-1', currentTitle: 'newchat', text: '首条消息' })

  const scheduledCallbacks: Array<{ callback: () => void; delay: number }> = []
  scheduleThreadTitleRefinement(
    { threadId: 'thread-1', status: 'aborted' },
    (input) => coordinator.refineAfterRun(input),
    (callback, delay) => {
      scheduledCallbacks.push({ callback, delay })
    }
  )

  assert.deepEqual(scheduledCallbacks, [])

  await coordinator.refineAfterRun({ threadId: 'thread-1', status: 'finished' })
  assert.deepEqual(generatedTitles, [])
})

test('finished refinements remain scheduled with the 250ms delay', async () => {
  const generatedTitles: string[] = []
  const coordinator = createThreadTitleCoordinator({
    buildFallbackTitle: () => '首条消息',
    generateTitle: async ({ text }) => {
      generatedTitles.push(text)
      return '精炼标题'
    },
    persistTitle: async () => {},
    getCurrentTitle: () => '首条消息',
    isThreadIdle: () => true
  })
  coordinator.reserve({ threadId: 'thread-1', currentTitle: 'newchat', text: '首条消息' })

  const scheduledCallbacks: Array<{ callback: () => void; delay: number }> = []
  scheduleThreadTitleRefinement(
    { threadId: 'thread-1', status: 'finished' },
    (input) => coordinator.refineAfterRun(input),
    (callback, delay) => {
      scheduledCallbacks.push({ callback, delay })
    }
  )

  assert.equal(scheduledCallbacks.length, 1)
  assert.equal(scheduledCallbacks[0]?.delay, 250)
  assert.deepEqual(generatedTitles, [])

  scheduledCallbacks[0]?.callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(generatedTitles, ['首条消息'])
})
