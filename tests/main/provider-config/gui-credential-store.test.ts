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

const {
  clearProviderApiKey,
  setProviderApiKey,
  upsertProvider
} = await import('../../../src/main/db/config-db.ts')
const { GuiCredentialStore } = await import(
  '../../../src/main/provider-config/gui-credential-store.ts'
)
const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')

test('GuiCredentialStore reads api keys by runtime provider id', async () => {
  upsertProvider({
    id: 'openai',
    displayName: 'OpenAI',
    runtimeProvider: 'openai',
    enabled: true,
    baseUrl: null,
    settingsJson: '{}'
  })
  setProviderApiKey('openai', 'sk-gui-test')

  const store = new GuiCredentialStore()
  const credential = await store.read('openai')
  assert.deepEqual(credential, { type: 'api_key', key: 'sk-gui-test' })

  const listed = await store.list()
  assert.ok(listed.some((entry) => entry.providerId === 'openai' && entry.type === 'api_key'))
})

test('GuiCredentialStore maps custom GUI id secrets under runtime_provider', async () => {
  upsertProvider({
    id: 'custom_acme',
    displayName: 'Acme',
    runtimeProvider: 'openai-compatible-acme',
    enabled: true,
    baseUrl: 'https://example.com/v1',
    settingsJson: '{}'
  })
  setProviderApiKey('custom_acme', 'sk-custom')

  const store = new GuiCredentialStore()
  assert.deepEqual(await store.read('openai-compatible-acme'), {
    type: 'api_key',
    key: 'sk-custom'
  })
  assert.equal(await store.read('custom_acme'), undefined)
})

test('GuiCredentialStore modify/delete persist through config.db', async () => {
  upsertProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    runtimeProvider: 'anthropic',
    enabled: true,
    baseUrl: null,
    settingsJson: '{}'
  })
  clearProviderApiKey('anthropic')

  const store = new GuiCredentialStore()
  await store.modify('anthropic', async () => ({ type: 'api_key', key: 'sk-from-modify' }))
  assert.deepEqual(await store.read('anthropic'), {
    type: 'api_key',
    key: 'sk-from-modify'
  })

  await store.delete('anthropic')
  assert.equal(await store.read('anthropic'), undefined)
})

test('ModelRuntime uses GuiCredentialStore without auth.json', async () => {
  upsertProvider({
    id: 'google',
    displayName: 'Google Gemini',
    runtimeProvider: 'google',
    enabled: true,
    baseUrl: null,
    settingsJson: '{}'
  })
  setProviderApiKey('google', 'sk-google-runtime')

  const runtime = await ModelRuntime.create({
    credentials: new GuiCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false
  })

  const auth = await runtime.getAuth('google')
  assert.ok(auth)
  assert.equal(auth?.auth.apiKey, 'sk-google-runtime')
  assert.equal(runtime.getProviderAuthStatus('google').configured, true)
})
