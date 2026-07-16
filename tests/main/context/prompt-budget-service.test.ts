import test from 'node:test'
import assert from 'node:assert/strict'
import { PromptBudgetService } from '../../../src/main/context/prompt-budget-service.ts'
import type { ContextEngineConfig } from '../../../src/main/context/context-types.ts'
import type { Message } from '@earendil-works/pi-ai'

const createConfig = (): ContextEngineConfig => ({
  version: 1,
  mode: 'auto',
  engine: 'summary-compressor',
  summaryModel: '',
  summaryFallbackModel: '',
  summaryTimeoutMs: 20_000,
  trigger: {
    thresholdPercent: 0.5,
    estimatedThresholdPercent: 0.65,
    reserveOutputTokens: 200
  },
  limits: {
    protectFirstEntries: 1,
    protectLastEntries: 10,
    summaryBudgetCap: 4096
  },
  engineConfig: {}
})

test('PromptBudgetService uses context usage when available', () => {
  const service = new PromptBudgetService()
  const estimate = service.estimate({
    config: createConfig(),
    contextWindow: 1000,
    currentMessages: [],
    systemPrompt: 'system prompt',
    pendingUserText: 'x'.repeat(80),
    appendedSystemPrompt: 'y'.repeat(40),
    contextUsage: {
      tokens: 520,
      contextWindow: 1000,
      percent: 52
    }
  })

  assert.equal(estimate.estimateMode, 'usage_backed')
  assert.equal(estimate.currentContextTokens, 520)
  assert.ok((estimate.additionalTokens ?? 0) > 0)
  assert.equal(estimate.thresholdTokens, 500)
  assert.equal(estimate.warningLevel, 'critical')
})

test('PromptBudgetService does not let low runtime usage undercount active messages', () => {
  const service = new PromptBudgetService()
  const currentMessages = [
    {
      role: 'user',
      content: 'x'.repeat(400),
      timestamp: Date.now()
    }
  ] as Message[]

  const estimate = service.estimate({
    config: createConfig(),
    contextWindow: 1000,
    currentMessages,
    systemPrompt: 'system prompt',
    contextUsage: {
      tokens: 3,
      contextWindow: 1000,
      percent: 0.3
    }
  })

  assert.equal(estimate.estimateMode, 'usage_backed')
  assert.equal(estimate.currentContextTokens, 104)
  assert.equal(estimate.estimatedPromptTokens, 104)
})

test('PromptBudgetService falls back to heuristic message estimation', () => {
  const service = new PromptBudgetService()
  const currentMessages = [
    {
      role: 'user',
      content: 'hello world',
      timestamp: Date.now()
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'long assistant reply' }],
      timestamp: Date.now()
    }
  ] as Message[]

  const estimate = service.estimate({
    config: createConfig(),
    contextWindow: 1000,
    currentMessages,
    systemPrompt: 'system prompt that also counts',
    pendingUserText: 'follow-up request'
  })

  assert.equal(estimate.estimateMode, 'heuristic_only')
  assert.equal(estimate.currentContextTokens, null)
  assert.ok(estimate.estimatedPromptTokens > 0)
  assert.equal(estimate.thresholdTokens, 650)
})
