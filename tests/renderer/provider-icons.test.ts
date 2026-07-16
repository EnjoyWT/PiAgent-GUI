import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getProviders } from '@earendil-works/pi-ai'
import { listDefaultProviderDefinitions } from '../../src/shared/providers/registry.ts'
import {
  getProviderIconKey,
  getProviderIconUrl
} from '../../src/renderer/src/utils/providerIcons.ts'

test('provider icons cover every default provider by id and display name', () => {
  const providers = listDefaultProviderDefinitions()
  const expectedProviderIds = new Set([...getProviders(), 'qwen'])

  assert.equal(providers.length, expectedProviderIds.size)

  for (const provider of providers) {
    assert.ok(expectedProviderIds.has(provider.id), `unexpected provider ${provider.id}`)
    assert.ok(getProviderIconKey(provider.id), `missing icon key for provider id ${provider.id}`)
    assert.ok(
      getProviderIconKey(provider.displayName),
      `missing icon key for display name ${provider.displayName}`
    )
    const iconUrl = getProviderIconUrl(provider.id)
    assert.ok(iconUrl, `missing icon url for provider id ${provider.id}`)
    assert.ok(
      existsSync(fileURLToPath(iconUrl)),
      `missing icon asset for provider id ${provider.id}`
    )
  }
})

test('provider icons cover common custom provider names', () => {
  assert.equal(getProviderIconKey('anyrouter'), 'anyrouter')
  assert.equal(getProviderIconKey('codex'), 'openai')
  assert.equal(getProviderIconKey('sh-qwen'), 'qwen')
})
