import { getSetting, setSetting } from '../db/config-db.ts'

export interface KnowledgeSettings {
  enabled: boolean
  autoExtractEnabled: boolean
  autoInjectEnabled: boolean
  embeddingModel: string
  injectionTokenBudget: number
  extractionModel: string
  consolidationModel: string
  dreamModel: string
}

export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  enabled: true,
  autoExtractEnabled: true,
  autoInjectEnabled: true,
  embeddingModel: 'BAAI/bge-small-zh-v1.5',
  injectionTokenBudget: 8000,
  extractionModel: '',
  consolidationModel: '',
  dreamModel: ''
}

const KEYS = {
  enabled: 'knowledge_enabled',
  autoExtractEnabled: 'knowledge_auto_extract_enabled',
  autoInjectEnabled: 'knowledge_auto_inject_enabled',
  embeddingModel: 'knowledge_embedding_model',
  injectionTokenBudget: 'knowledge_injection_token_budget',
  extractionModel: 'knowledge_extraction_model',
  consolidationModel: 'knowledge_consolidation_model',
  dreamModel: 'knowledge_dream_model'
} as const

const parseBool = (value: string | null, fallback: boolean): boolean => {
  if (value === null || value === undefined || value === '') return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

const parseBudget = (value: string | null): number => {
  if (value === null || value === undefined || value.trim() === '') {
    return DEFAULT_KNOWLEDGE_SETTINGS.injectionTokenBudget
  }
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_KNOWLEDGE_SETTINGS.injectionTokenBudget
  return Math.min(16000, Math.max(1000, Math.round(n)))
}

export const getKnowledgeSettings = (): KnowledgeSettings => ({
  enabled: parseBool(getSetting(KEYS.enabled), DEFAULT_KNOWLEDGE_SETTINGS.enabled),
  autoExtractEnabled: true,
  autoInjectEnabled: true,
  embeddingModel: getSetting(KEYS.embeddingModel) || DEFAULT_KNOWLEDGE_SETTINGS.embeddingModel,
  injectionTokenBudget: parseBudget(getSetting(KEYS.injectionTokenBudget)),
  extractionModel: getSetting(KEYS.extractionModel) || DEFAULT_KNOWLEDGE_SETTINGS.extractionModel,
  consolidationModel: getSetting(KEYS.consolidationModel) || DEFAULT_KNOWLEDGE_SETTINGS.consolidationModel,
  dreamModel: getSetting(KEYS.dreamModel) || DEFAULT_KNOWLEDGE_SETTINGS.dreamModel
})

export const isThreadKnowledgeCaptureEnabled = (threadId: string | null | undefined): boolean => {
  const id = String(threadId || '').trim()
  if (!id) return true
  return parseBool(getSetting(`knowledge_thread_capture_enabled:${id}`), true)
}

export const setThreadKnowledgeCaptureEnabled = (threadId: string, enabled: boolean): { threadId: string; enabled: boolean } => {
  const id = String(threadId || '').trim()
  if (!id) throw new Error('threadId is required')
  setSetting(`knowledge_thread_capture_enabled:${id}`, enabled ? '1' : '0')
  return { threadId: id, enabled }
}

export const resolveKnowledgeModel = (purpose: 'extraction' | 'dedup' | 'consolidation' | 'dream'): string => {
  const settings = getKnowledgeSettings()
  const toolModel = String(getSetting('tool_model') || '').trim()
  if (purpose === 'extraction') return settings.extractionModel || toolModel
  if (purpose === 'dedup') return settings.extractionModel || toolModel
  if (purpose === 'consolidation') return settings.consolidationModel || settings.extractionModel || toolModel
  return settings.dreamModel || settings.consolidationModel || settings.extractionModel || toolModel
}

export const setKnowledgeSettings = (patch: Partial<KnowledgeSettings>): KnowledgeSettings => {
  if (typeof patch.enabled === 'boolean') setSetting(KEYS.enabled, patch.enabled ? '1' : '0')
  setSetting(KEYS.autoExtractEnabled, '1')
  setSetting(KEYS.autoInjectEnabled, '1')
  if (typeof patch.embeddingModel === 'string' && patch.embeddingModel.trim()) {
    setSetting(KEYS.embeddingModel, patch.embeddingModel.trim())
  }
  if (typeof patch.injectionTokenBudget === 'number') {
    setSetting(KEYS.injectionTokenBudget, String(parseBudget(String(patch.injectionTokenBudget))))
  }
  if (typeof patch.extractionModel === 'string') setSetting(KEYS.extractionModel, patch.extractionModel.trim())
  if (typeof patch.consolidationModel === 'string') setSetting(KEYS.consolidationModel, patch.consolidationModel.trim())
  if (typeof patch.dreamModel === 'string') setSetting(KEYS.dreamModel, patch.dreamModel.trim())
  return getKnowledgeSettings()
}
