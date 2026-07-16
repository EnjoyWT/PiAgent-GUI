import test from 'node:test'
import assert from 'node:assert/strict'
import { getProviders } from '@earendil-works/pi-ai/compat'
import { resolveProviderModelBaseUrl } from '../../src/shared/providers/adapters/builtin.ts'
import {
  getDefaultProviderDefinition,
  getProviderAdapter,
  listDefaultProviderDefinitions
} from '../../src/shared/providers/registry.ts'

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test('default provider catalog covers every built-in pi-ai provider', () => {
  const builtInProviders = getProviders().sort()
  const defaults = listDefaultProviderDefinitions()
  const defaultIds = defaults.map((provider) => provider.id).sort()

  for (const providerId of builtInProviders) {
    assert.ok(defaultIds.includes(providerId), `missing default provider ${providerId}`)
    const definition = getDefaultProviderDefinition(providerId)
    const adapter = getProviderAdapter(providerId)
    assert.ok(definition, `missing default definition for ${providerId}`)
    assert.ok(adapter, `missing adapter for ${providerId}`)
    assert.equal(definition.runtimeProvider, providerId)
    assert.equal(adapter.providerId, providerId)
  }
})

test('provider catalog exposes provider-specific settings fields', () => {
  assert.deepEqual(
    getProviderAdapter('azure-openai-responses')
      ?.settingsSpec()
      .extraFields.map((field) => field.key),
    ['azureResourceName', 'azureApiVersion', 'azureDeploymentName']
  )
  assert.deepEqual(
    getProviderAdapter('amazon-bedrock')
      ?.settingsSpec()
      .extraFields.map((field) => field.key),
    ['region', 'profile']
  )
  assert.deepEqual(
    getProviderAdapter('google-vertex')
      ?.settingsSpec()
      .extraFields.map((field) => field.key),
    ['project', 'location']
  )
  assert.deepEqual(
    getProviderAdapter('cloudflare-ai-gateway')
      ?.settingsSpec()
      .extraFields.map((field) => field.key),
    ['cloudflareAccountId', 'cloudflareGatewayId', 'cloudflareBackend']
  )
})

test('built-in provider adapters expose pi-ai model metadata without network discovery', async () => {
  const adapter = getProviderAdapter('deepseek')
  assert.ok(adapter)

  const models = await adapter.listModels({
    providerId: 'deepseek',
    apiKey: 'test-key',
    baseUrl: adapter.defaultBaseUrl,
    settings: {}
  })

  assert.ok(models.length > 0)
  assert.ok(models.some((model) => model.modelId === 'deepseek-v4-flash'))
  assert.equal(models[0]?.raw && typeof models[0].raw, 'object')
})

test('xiaomi built-in provider uses the reachable MiMo Anthropic endpoint', async () => {
  const expectedBaseUrl = 'https://token-plan-ams.xiaomimimo.com/anthropic'
  const definition = getDefaultProviderDefinition('xiaomi')
  const adapter = getProviderAdapter('xiaomi')

  assert.ok(definition)
  assert.ok(adapter)
  assert.equal(definition.defaultBaseUrl, expectedBaseUrl)
  assert.equal(adapter.defaultBaseUrl, expectedBaseUrl)

  const models = await adapter.listModels({
    providerId: 'xiaomi',
    apiKey: 'test-key',
    baseUrl: adapter.defaultBaseUrl,
    settings: {}
  })

  assert.ok(models.length > 0)
  for (const model of models) {
    const raw = model.raw as { baseUrl?: unknown } | null | undefined
    assert.equal(raw?.baseUrl, expectedBaseUrl)
  }
})

test('xiaomi base URL resolver ignores stale persisted model endpoint when no custom base URL is set', () => {
  const expectedBaseUrl = 'https://token-plan-ams.xiaomimimo.com/anthropic'
  const staleBaseUrl = 'https://api.mimo-v2.com/anthropic'

  assert.equal(
    resolveProviderModelBaseUrl('xiaomi', null, {}, staleBaseUrl, expectedBaseUrl),
    expectedBaseUrl
  )
  assert.equal(
    resolveProviderModelBaseUrl(
      'xiaomi',
      'https://custom.example.com/anthropic',
      {},
      staleBaseUrl,
      expectedBaseUrl
    ),
    'https://custom.example.com/anthropic'
  )
})

test('xiaomi base URL resolver normalizes configured OpenAI-compatible endpoint for Anthropic models', () => {
  const modelBaseUrl = 'https://token-plan-ams.xiaomimimo.com/anthropic'
  const fallbackBaseUrl = 'https://token-plan-ams.xiaomimimo.com/anthropic'

  assert.equal(
    resolveProviderModelBaseUrl(
      'xiaomi',
      'https://api.mimo-v2.com/v1',
      {},
      modelBaseUrl,
      fallbackBaseUrl
    ),
    'https://token-plan-ams.xiaomimimo.com/anthropic'
  )

  assert.equal(
    resolveProviderModelBaseUrl(
      'xiaomi',
      'https://proxy.example.com/v1',
      {},
      modelBaseUrl,
      fallbackBaseUrl
    ),
    'https://proxy.example.com/anthropic'
  )
})

test('custom provider anthropic_messages model discovery appends /v1/models when base URL has no /v1 suffix', async () => {
  const adapter = getProviderAdapter('custom_demo')
  assert.ok(adapter)

  let requestedUrl = ''
  globalThis.fetch = async (input: string | URL | Request) => {
    requestedUrl = String(input)
    return new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }

  const models = await adapter.listModels({
    providerId: 'custom_demo',
    apiKey: 'test-key',
    baseUrl: 'https://proxy.example.com',
    settings: { apiFormat: 'anthropic_messages' }
  })

  assert.equal(requestedUrl, 'https://proxy.example.com/v1/models')
  assert.equal(models[0]?.modelId, 'claude-sonnet-4')
})

test('custom provider anthropic_messages model discovery keeps /v1/models when base URL already ends with /v1', async () => {
  const adapter = getProviderAdapter('custom_demo')
  assert.ok(adapter)

  let requestedUrl = ''
  globalThis.fetch = async (input: string | URL | Request) => {
    requestedUrl = String(input)
    return new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }

  const models = await adapter.listModels({
    providerId: 'custom_demo',
    apiKey: 'test-key',
    baseUrl: 'https://proxy.example.com/v1',
    settings: { apiFormat: 'anthropic_messages' }
  })

  assert.equal(requestedUrl, 'https://proxy.example.com/v1/models')
  assert.equal(models[0]?.modelId, 'claude-sonnet-4')
})
