import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const electronStubUrl = pathToFileURL(
  resolve(repoRoot, 'tests/main/webfetch/electron-webfetch-stub.mjs')
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

const electronStub = await import('./electron-webfetch-stub.mjs')
const { runHiddenWebFetch, WEBFETCH_SESSION_PARTITION } =
  await import('../../../src/main/webfetch/hidden-webfetch-runner.ts')

test('runHiddenWebFetch creates a hidden sandboxed BrowserWindow and destroys it after extraction', async () => {
  electronStub.reset()
  electronStub.setNextJavaScriptResult({ title: 'Example' })

  const result = await runHiddenWebFetch<{ title: string }>({
    url: 'https://example.com/page',
    script: 'document.title',
    timeoutMs: 1000
  })

  assert.deepEqual(result, { title: 'Example' })
  assert.equal(electronStub.sessions[0].partition, WEBFETCH_SESSION_PARTITION)
  assert.equal(electronStub.windows.length, 1)
  assert.equal(electronStub.windows[0].options.show, false)
  assert.equal(electronStub.windows[0].options.webPreferences.partition, WEBFETCH_SESSION_PARTITION)
  assert.equal(electronStub.windows[0].options.webPreferences.nodeIntegration, false)
  assert.equal(electronStub.windows[0].options.webPreferences.contextIsolation, true)
  assert.equal(electronStub.windows[0].options.webPreferences.sandbox, true)
  assert.equal(electronStub.windows[0].destroyed, true)
})
