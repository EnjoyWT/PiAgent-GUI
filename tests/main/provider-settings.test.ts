import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildOpenAICompatSettings,
  normalizeProviderSettings,
  shouldRegisterDynamicProvider
} from '../../src/shared/provider-settings.ts'

test('Qwen provider defaults to Qwen-compatible OpenAI settings', () => {
  const settings = normalizeProviderSettings({
    providerId: 'qwen',
    runtimeProvider: 'qwen',
    settings: {}
  })

  assert.deepEqual(settings, {
    apiFormat: 'chat_completions',
    maxTokensField: 'max_tokens',
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    thinkingFormat: 'qwen'
  })

  assert.deepEqual(buildOpenAICompatSettings(settings), {
    maxTokensField: 'max_tokens',
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    thinkingFormat: 'qwen'
  })
})

test('DeepSeek provider defaults to system role for OpenAI-compatible chat completions', () => {
  const settings = normalizeProviderSettings({
    providerId: 'deepseek',
    runtimeProvider: 'deepseek',
    settings: {}
  })

  assert.equal(settings.supportsDeveloperRole, false)
  assert.equal(buildOpenAICompatSettings(settings).supportsDeveloperRole, false)
})

test('custom provider preserves legacy useMaxCompletionTokens flag and defaults to system role', () => {
  const settings = normalizeProviderSettings({
    providerId: 'custom_demo',
    settings: { useMaxCompletionTokens: true }
  })

  assert.equal(settings.maxTokensField, 'max_completion_tokens')
  assert.equal(settings.supportsDeveloperRole, false)
  assert.equal(settings.supportsReasoningEffort, true)
  assert.equal(settings.thinkingFormat, 'openai')
})

test('dynamic provider registration includes custom providers and qwen', () => {
  assert.equal(shouldRegisterDynamicProvider('custom_demo', 'custom_demo'), true)
  assert.equal(shouldRegisterDynamicProvider('qwen', 'qwen'), true)
  assert.equal(shouldRegisterDynamicProvider('openai', 'openai'), false)
})
