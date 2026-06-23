import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const electronStubUrl = pathToFileURL(
  resolve(repoRoot, 'tests/main/ipc/electron-ipc-stub.mjs')
).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        shortCircuit: true,
        url: electronStubUrl
      }
    }
    if (specifier.startsWith('@shared/')) {
      const sharedPath = resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`)
      return {
        shortCircuit: true,
        url: pathToFileURL(sharedPath).href
      }
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:')
        ? fileURLToPath(context.parentURL)
        : ''
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) {
        return nextResolve(`${specifier}.ts`, context)
      }
    }
    return nextResolve(specifier, context)
  }
})

const { setupRuntimeHandlers } = await import('../../../src/main/ipc/runtime-handlers.ts')

test('setupRuntimeHandlers registers notify-run-finished and forwards the payload', async () => {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  const forwarded: Array<{ threadId: string; runId: string; preview: string }> = []

  setupRuntimeHandlers({
    ipcMainLike: {
      handle(channel, handler) {
        handlers.set(channel, handler as (...args: any[]) => Promise<any>)
        return undefined
      }
    },
    runtimeHostProvider: async () => ({}) as never,
    notifyRunFinished: async (payload) => {
      forwarded.push(payload)
      return true
    }
  })

  const handler = handlers.get('runtime:notify-run-finished')
  assert.ok(handler)

  const result = await handler!(null, {
    threadId: 'thread-1',
    runId: 'run-1',
    preview: 'summary text'
  })

  assert.deepEqual(forwarded, [
    {
      threadId: 'thread-1',
      runId: 'run-1',
      preview: 'summary text'
    }
  ])
  assert.deepEqual(result, { success: true, notificationShown: true })
})

test('setupRuntimeHandlers registers run-finished badge count updates', async () => {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  const badgeCounts: number[] = []

  setupRuntimeHandlers({
    ipcMainLike: {
      handle(channel, handler) {
        handlers.set(channel, handler as (...args: any[]) => Promise<any>)
        return undefined
      }
    },
    runtimeHostProvider: async () => ({}) as never,
    setRunFinishedBadgeCount: (count) => {
      badgeCounts.push(count)
    }
  })

  const handler = handlers.get('runtime:set-run-finished-badge-count')
  assert.ok(handler)

  const result = await handler!(null, 3)

  assert.deepEqual(badgeCounts, [3])
  assert.deepEqual(result, { success: true })
})
