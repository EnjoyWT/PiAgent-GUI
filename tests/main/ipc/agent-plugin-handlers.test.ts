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

const { shouldStartAgentPluginBackgroundExtensions } = await import(
  '../../../src/main/ipc/agent-plugin-handlers.ts'
)

test('agent plugin handlers start background extensions after enabling extension-capable state', () => {
  assert.equal(
    shouldStartAgentPluginBackgroundExtensions({
      pluginId: 'memos-local-plugin',
      enabled: true
    }),
    true
  )
  assert.equal(
    shouldStartAgentPluginBackgroundExtensions({
      pluginId: 'memos-local-plugin',
      componentType: 'extensions',
      componentId: './dist/adapters/piagent/index.js',
      enabled: true
    }),
    true
  )
})

test('agent plugin handlers do not start background extensions for disable or non-extension changes', () => {
  assert.equal(
    shouldStartAgentPluginBackgroundExtensions({
      pluginId: 'memos-local-plugin',
      enabled: false
    }),
    false
  )
  assert.equal(
    shouldStartAgentPluginBackgroundExtensions({
      pluginId: 'memos-local-plugin',
      componentType: 'skills',
      componentId: './skills',
      enabled: true
    }),
    false
  )
})
