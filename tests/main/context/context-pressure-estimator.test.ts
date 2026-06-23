import test from 'node:test'
import assert from 'node:assert/strict'
import { PromptBudgetService } from '../../../src/main/context/prompt-budget-service.ts'
import { estimateContextDebugPressure } from '../../../src/main/context/context-pressure-estimator.ts'
import type { ContextEngineConfig, ContextEntry } from '../../../src/main/context/context-types.ts'

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

const createEntry = (
  contentText: string,
  overrides: Partial<ContextEntry> = {}
): ContextEntry => ({
  id: `entry-${contentText.length}`,
  threadId: 'thread-1',
  seq: 1,
  agentRunId: null,
  agentTurnId: null,
  sourceKind: 'message',
  sourceRef: null,
  groupId: null,
  role: 'assistant',
  semanticKind: 'tool_result_summary',
  includeInModelContext: true,
  includeInMemory: false,
  compactPolicy: 'summarize',
  contentText,
  contentJson: null,
  tokenEstimate: null,
  createdAt: '2026-06-09T10:00:00.000+08:00',
  ...overrides
})

test('estimateContextDebugPressure estimates active entries when runtime is idle', () => {
  const pressure = estimateContextDebugPressure({
    config: createConfig(),
    promptBudgetService: new PromptBudgetService(),
    runtime: {
      initialized: false,
      contextWindow: null,
      currentMessages: [],
      systemPrompt: '',
      contextUsage: undefined
    },
    activeEntries: [
      createEntry('x'.repeat(400)),
      createEntry('excluded'.repeat(20), { includeInModelContext: false })
    ],
    fallbackContextWindow: 1000
  })

  assert.ok(pressure)
  assert.equal(pressure.estimateMode, 'heuristic_only')
  assert.equal(pressure.contextWindow, 1000)
  assert.equal(pressure.estimatedPromptTokens, 100)
  assert.equal(pressure.currentContextTokens, null)
})
