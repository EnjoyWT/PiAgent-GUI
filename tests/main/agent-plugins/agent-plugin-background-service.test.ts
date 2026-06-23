import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolve(repoRoot, 'tests/main/runtime-host/electron-stub.mjs')).href
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

const { AgentPluginBackgroundExtensionService } = await import(
  '../../../src/main/agent-plugins/agent-plugin-background-service.ts'
)

test('agent plugin background service loads enabled extension paths at app startup', async () => {
  const createdLoaders: Array<Record<string, unknown>> = []
  let reloadCount = 0

  const service = new AgentPluginBackgroundExtensionService({
    cwd: () => '/tmp/piagent-user-data',
    agentDir: () => '/tmp/piagent-agent',
    resolveResources: async () => ({
      skillPaths: [],
      mcpServers: [],
      tools: [],
      extensionPaths: ['/plugins/memos/dist/adapters/piagent/index.js'],
      extensionFactories: [],
      diagnostics: [],
      signature: 'extensions:memos'
    }),
    createLoader: (options) => {
      createdLoaders.push(options as unknown as Record<string, unknown>)
      return {
        reload: async () => {
          reloadCount += 1
        },
        getExtensions: () => ({ errors: [] })
      }
    }
  })

  const first = await service.start()
  const second = await service.start()

  assert.equal(first.loaded, true)
  assert.equal(first.extensionPathCount, 1)
  assert.equal(second.loaded, false)
  assert.equal(reloadCount, 1)
  assert.equal(createdLoaders.length, 1)
  assert.deepEqual(createdLoaders[0].additionalExtensionPaths, [
    '/plugins/memos/dist/adapters/piagent/index.js'
  ])
  assert.equal(createdLoaders[0].cwd, '/tmp/piagent-user-data')
  assert.equal(createdLoaders[0].agentDir, '/tmp/piagent-agent')
  assert.equal(createdLoaders[0].noExtensions, true)
})

test('agent plugin background service skips loader when no enabled extensions exist', async () => {
  let createLoaderCalled = false
  const service = new AgentPluginBackgroundExtensionService({
    cwd: () => '/tmp/piagent-user-data',
    agentDir: () => '/tmp/piagent-agent',
    resolveResources: async () => ({
      skillPaths: [],
      mcpServers: [],
      tools: [],
      extensionPaths: [],
      extensionFactories: [],
      diagnostics: [],
      signature: 'empty'
    }),
    createLoader: () => {
      createLoaderCalled = true
      return {
        reload: async () => undefined,
        getExtensions: () => ({ errors: [] })
      }
    }
  })

  const result = await service.start()

  assert.equal(result.loaded, false)
  assert.equal(result.extensionPathCount, 0)
  assert.equal(createLoaderCalled, false)
})
