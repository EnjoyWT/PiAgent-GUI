import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { ContextConfigService } from '../../../src/main/context/context-config-service.ts'

test('ContextConfigService normalizes and persists config values', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'piagent-context-config-'))
  const configPath = path.join(root, 'context-engine.json')

  try {
    const service = new ContextConfigService(configPath)
    service.writeConfig({
      version: 1,
      mode: 'auto',
      engine: 'summary-compressor',
      summaryModel: 'openai::gpt-4.1-mini',
      summaryFallbackModel: 'anthropic::claude-3-5-haiku',
      summaryTimeoutMs: 999_999,
      trigger: {
        thresholdPercent: 9,
        estimatedThresholdPercent: -1,
        reserveOutputTokens: 10
      },
      limits: {
        protectFirstEntries: -5,
        protectLastEntries: 9999,
        summaryBudgetCap: 200
      },
      engineConfig: {
        customFlag: true
      }
    })

    const config = service.getConfig()
    assert.equal(config.mode, 'auto')
    assert.equal(config.engine, 'summary-compressor')
    assert.equal(config.summaryTimeoutMs, 300_000)
    assert.equal(config.trigger.thresholdPercent, 0.95)
    assert.equal(config.trigger.estimatedThresholdPercent, 0.1)
    assert.equal(config.trigger.reserveOutputTokens, 256)
    assert.equal(config.limits.protectFirstEntries, 0)
    assert.equal(config.limits.protectLastEntries, 1000)
    assert.equal(config.limits.summaryBudgetCap, 256)
    assert.deepEqual(config.engineConfig, { customFlag: true })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
