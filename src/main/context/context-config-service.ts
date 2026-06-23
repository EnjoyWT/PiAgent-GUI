import path from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { getPreferredAppConfigDir } from '../paths.ts'
import type { ContextEngineConfig, ContextEngineMode } from './context-types.ts'

const DEFAULT_CONFIG: ContextEngineConfig = {
  version: 1,
  mode: 'manual',
  engine: 'noop',
  summaryModel: '',
  summaryFallbackModel: '',
  summaryTimeoutMs: 20_000,
  trigger: {
    thresholdPercent: 0.5,
    estimatedThresholdPercent: 0.65,
    reserveOutputTokens: 13_000
  },
  limits: {
    protectFirstEntries: 3,
    protectLastEntries: 20,
    summaryBudgetCap: 12_000
  },
  engineConfig: {}
}

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

const normalizeMode = (value: unknown): ContextEngineMode =>
  value === 'off' || value === 'auto' ? value : 'manual'

const normalizeConfig = (raw: unknown): ContextEngineConfig => {
  const record =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const trigger =
    record.trigger && typeof record.trigger === 'object' && !Array.isArray(record.trigger)
      ? (record.trigger as Record<string, unknown>)
      : {}
  const limits =
    record.limits && typeof record.limits === 'object' && !Array.isArray(record.limits)
      ? (record.limits as Record<string, unknown>)
      : {}
  return {
    version: 1,
    mode: normalizeMode(record.mode),
    engine:
      typeof record.engine === 'string' && record.engine.trim() ? record.engine.trim() : 'noop',
    summaryModel: typeof record.summaryModel === 'string' ? record.summaryModel.trim() : '',
    summaryFallbackModel:
      typeof record.summaryFallbackModel === 'string' ? record.summaryFallbackModel.trim() : '',
    summaryTimeoutMs: clampNumber(
      record.summaryTimeoutMs,
      DEFAULT_CONFIG.summaryTimeoutMs,
      1000,
      300_000
    ),
    trigger: {
      thresholdPercent: clampNumber(
        trigger.thresholdPercent,
        DEFAULT_CONFIG.trigger.thresholdPercent,
        0.1,
        0.95
      ),
      estimatedThresholdPercent: clampNumber(
        trigger.estimatedThresholdPercent,
        DEFAULT_CONFIG.trigger.estimatedThresholdPercent,
        0.1,
        0.99
      ),
      reserveOutputTokens: clampNumber(
        trigger.reserveOutputTokens,
        DEFAULT_CONFIG.trigger.reserveOutputTokens,
        256,
        200_000
      )
    },
    limits: {
      protectFirstEntries: clampNumber(
        limits.protectFirstEntries,
        DEFAULT_CONFIG.limits.protectFirstEntries,
        0,
        500
      ),
      protectLastEntries: clampNumber(
        limits.protectLastEntries,
        DEFAULT_CONFIG.limits.protectLastEntries,
        1,
        1000
      ),
      summaryBudgetCap: clampNumber(
        limits.summaryBudgetCap,
        DEFAULT_CONFIG.limits.summaryBudgetCap,
        256,
        200_000
      )
    },
    engineConfig:
      record.engineConfig &&
      typeof record.engineConfig === 'object' &&
      !Array.isArray(record.engineConfig)
        ? (record.engineConfig as Record<string, unknown>)
        : {}
  }
}

export class ContextConfigService {
  private readonly configPath: string

  constructor(configPath = path.join(getPreferredAppConfigDir(), 'context-engine.json')) {
    this.configPath = configPath
  }

  getPath(): string {
    return this.configPath
  }

  getConfig(): ContextEngineConfig {
    if (!existsSync(this.configPath)) {
      this.writeConfig(DEFAULT_CONFIG)
      return { ...DEFAULT_CONFIG }
    }

    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf8')) as unknown
      const config = normalizeConfig(raw)
      if (JSON.stringify(config) !== JSON.stringify(raw)) this.writeConfig(config)
      return config
    } catch {
      this.writeConfig(DEFAULT_CONFIG)
      return { ...DEFAULT_CONFIG }
    }
  }

  writeConfig(config: ContextEngineConfig): void {
    const normalized = normalizeConfig(config)
    mkdirSync(path.dirname(this.configPath), { recursive: true })
    writeFileSync(this.configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  }
}
