import test from 'node:test'
import assert from 'node:assert/strict'
import { createThreadTitleCoordinator } from '../../../src/renderer/src/utils/thread-title-coordinator.ts'

test('reserving a new-thread title does not call the model before its run settles', async () => {
  const calls: string[] = []
  const coordinator = createThreadTitleCoordinator({
    buildFallbackTitle: () => '首条消息',
    generateTitle: async () => {
      calls.push('generate')
      return '精炼标题'
    },
    persistTitle: async () => {
      calls.push('persist')
    },
    getCurrentTitle: () => '首条消息',
    isThreadIdle: () => true
  })

  const fallbackTitle = coordinator.reserve({
    threadId: 'thread-1',
    currentTitle: 'newchat',
    text: '首条消息'
  })

  assert.equal(fallbackTitle, '首条消息')
  assert.deepEqual(calls, [])
})

test('refines the fallback title only after a finished idle run', async () => {
  const persisted: string[] = []
  const coordinator = createThreadTitleCoordinator({
    buildFallbackTitle: () => '首条消息',
    generateTitle: async () => '精炼标题',
    persistTitle: async (_threadId, title) => {
      persisted.push(title)
    },
    getCurrentTitle: () => '首条消息',
    isThreadIdle: () => true
  })

  coordinator.reserve({ threadId: 'thread-1', currentTitle: 'newchat', text: '首条消息' })
  await coordinator.refineAfterRun({ threadId: 'thread-1', status: 'finished' })

  assert.deepEqual(persisted, ['精炼标题'])
})

test('does not overwrite a title changed after fallback reservation', async () => {
  const persisted: string[] = []
  const coordinator = createThreadTitleCoordinator({
    buildFallbackTitle: () => '首条消息',
    generateTitle: async () => '精炼标题',
    persistTitle: async (_threadId, title) => {
      persisted.push(title)
    },
    getCurrentTitle: () => '用户修改的标题',
    isThreadIdle: () => true
  })

  coordinator.reserve({ threadId: 'thread-1', currentTitle: 'newchat', text: '首条消息' })
  await coordinator.refineAfterRun({ threadId: 'thread-1', status: 'finished' })

  assert.deepEqual(persisted, [])
})

test('drops pending refinement when the originating run does not finish', async () => {
  const calls: string[] = []
  const coordinator = createThreadTitleCoordinator({
    buildFallbackTitle: () => '首条消息',
    generateTitle: async () => {
      calls.push('generate')
      return '精炼标题'
    },
    persistTitle: async () => {
      calls.push('persist')
    },
    getCurrentTitle: () => '首条消息',
    isThreadIdle: () => true
  })

  coordinator.reserve({ threadId: 'thread-1', currentTitle: 'newchat', text: '首条消息' })
  await coordinator.refineAfterRun({ threadId: 'thread-1', status: 'failed' })

  assert.deepEqual(calls, [])
})
