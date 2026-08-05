import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { computed, ref } from 'vue'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@shared/')) {
      return {
        shortCircuit: true,
        url: pathToFileURL(
          resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`)
        ).href
      }
    }
    if (specifier.startsWith('.')) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) {
        return { shortCircuit: true, url: candidate.href }
      }
    }
    return nextResolve(specifier, context)
  }
})

const {
  canAbortFromRuntimeState,
  resetQueueControllerAfterAbort,
  shouldQueueComposerSend
} = await import('../../../src/renderer/src/utils/app-queue-state.ts')
const { useQueueDispatcher } = await import(
  '../../../src/renderer/src/utils/app-queue-dispatcher.ts'
)
const { createThreadTitleCoordinator } = await import(
  '../../../src/renderer/src/utils/thread-title-coordinator.ts'
)

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

test('aborting a first run clears its pending title refinement before a later run finishes', async () => {
  const titleLifecycleCalls: Array<{ threadId: string; status: string }> = []
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

  Object.assign(globalThis, {
    window: {
      api: {
        runtime: {
          getQueuedMessages: async () => []
        }
      }
    }
  })

  const dispatcher = useQueueDispatcher({
    activeThread: ref(null),
    messages: ref([]),
    inputText: ref(''),
    composerAttachments: ref([]),
    currentModelSupportsImageInput: computed(() => true),
    runtimeStatus: ref({ text: '', tone: 'idle' as const }),
    runtimeBinding: ref(null),
    activeRunByThreadId: new Map(),
    getAgentRunMap: () => new Map(),
    getThreadRowById: () => null,
    reserveThreadTitleFromText: () => {},
    refineThreadTitleAfterRun: (input) => {
      titleLifecycleCalls.push(input)
      void coordinator.refineAfterRun(input)
    },
    ensureThreadStarted: async (thread) => thread,
    ensureMessageBuffer: () => [],
    setThreadStreaming: () => {},
    scrollToBottom: () => {},
    loadLatestThreadWindow: async () => {},
    confirmTextOnlyFallback: async () => true,
    isStreaming: computed(() => false)
  })

  await dispatcher.onRunSettled('thread-1', 'run-1', 'aborted')
  await dispatcher.onRunSettled('thread-1', 'run-2', 'finished')
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(titleLifecycleCalls, [
    { threadId: 'thread-1', status: 'aborted' },
    { threadId: 'thread-1', status: 'finished' }
  ])
  assert.deepEqual(generatedTitles, [])
})
