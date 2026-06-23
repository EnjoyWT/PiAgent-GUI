export type ContextEngineMode = 'off' | 'manual' | 'auto'

export type ContextEngineConfig = {
  version: 1
  mode: ContextEngineMode
  engine: string
  summaryModel: string
  summaryFallbackModel: string
  summaryTimeoutMs: number
  trigger: {
    thresholdPercent: number
    estimatedThresholdPercent: number
    reserveOutputTokens: number
  }
  limits: {
    protectFirstEntries: number
    protectLastEntries: number
    summaryBudgetCap: number
  }
  engineConfig: Record<string, unknown>
}

export type ContextPressureEstimate = {
  contextWindow: number
  estimatedPromptTokens: number
  thresholdTokens: number
  estimateMode: 'usage_backed' | 'heuristic_only'
  currentContextTokens?: number | null
  additionalTokens?: number
  warningLevel?: 'normal' | 'warning' | 'critical'
}

export type ContextDebugEntryPreview = {
  id: string
  seq: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  semanticKind: string
  compactPolicy: 'keep' | 'summarize'
  includeInModelContext: boolean
  includeInMemory: boolean
  createdAt: string
  preview: string
  fullText: string
}

export type ContextDebugCompactionPreview = {
  id: string
  engineName: string
  reason: 'preflight' | 'after_run' | 'manual' | 'rebuild'
  compactedUntilSeq: number
  protectedTailStartSeq?: number | null
  estimatedInputTokens?: number | null
  estimatedOutputTokens?: number | null
  createdAt: string
}

export type ContextDebugStatePreview = {
  previousSummaryPreview: string | null
  failureCount: number
  lastFailureAt: string | null
  cooldownUntil: string | null
}

export type ContextDebugManualCompactionPreview = {
  available: boolean
  reasonCode:
    | 'ready'
    | 'mode_off'
    | 'unsupported_engine'
    | 'missing_summary_model'
    | 'no_active_entries'
    | 'no_compactable_entries'
  reasonText: string
  activeEntryCount: number
  nonSummaryActiveEntryCount: number
  protectedHeadCount: number
  protectedTailCount: number
  summarizableCount: number
  protectFirstEntries: number
  protectLastEntries: number
  hasActiveSummary: boolean
}

export type ContextThreadDebugSnapshot = {
  threadId: string
  configPath: string
  config: ContextEngineConfig
  managedThread: {
    initialized: boolean
    modelKey: string | null
    contextWindow: number | null
    isStreaming: boolean
  }
  waitingForInput: {
    question: boolean
    questionnaire: boolean
  }
  head: {
    engineName: string
    activeSummaryEntryId?: string | null
    compactedUntilSeq?: number | null
    revision: number
    updatedAt: string
  } | null
  pressure: ContextPressureEstimate | null
  entries: {
    total: number
    active: number
    summaries: number
  }
  engineState: ContextDebugStatePreview | null
  manualCompaction: ContextDebugManualCompactionPreview
  recentCompactions: ContextDebugCompactionPreview[]
  activeEntriesPreview: ContextDebugEntryPreview[]
}
