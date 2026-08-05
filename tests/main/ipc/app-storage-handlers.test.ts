import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const electronStubUrl = pathToFileURL(resolve(repoRoot, 'tests/main/ipc/electron-ipc-stub.mjs')).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return { shortCircuit: true, url: electronStubUrl }
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

const { setupAppStorageHandlers } = await import('../../../src/main/ipc/app-storage-handlers.ts')

test('registers app-storage:get-summary and returns the storage summary', async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

  setupAppStorageHandlers({
    ipcMainLike: {
      handle(channel, handler) {
        handlers.set(channel, handler as (...args: unknown[]) => Promise<unknown>)
      }
    },
    getUserDataPath: () => '/data',
    getSummary: async (userDataPath) => ({
      userDataPath,
      totalBytes: 42,
      unavailable: false,
      databases: [],
      conversationDatabase: {
        fileName: 'core-v2.db',
        label: '对话数据库',
        databaseBytes: 42,
        sidecarBytes: 0,
        totalBytes: 42,
        unavailable: false
      }
    })
  })

  const handler = handlers.get('app-storage:get-summary')
  assert.ok(handler)
  assert.equal((await handler(null) as { totalBytes: number }).totalBytes, 42)
})
