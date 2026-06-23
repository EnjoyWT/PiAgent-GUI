import type { ContextEntry, ContextEngineConfig, ContextPressureEstimate } from './context-types.ts'
import type { PromptBudgetService } from './prompt-budget-service.ts'

type ContextUsageSnapshot = {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

type RuntimePressureState = {
  initialized: boolean
  contextWindow: number | null
  currentMessages: unknown[]
  systemPrompt: string
  contextUsage?: ContextUsageSnapshot
}

type EstimateContextDebugPressureInput = {
  config: ContextEngineConfig
  promptBudgetService: PromptBudgetService
  runtime: RuntimePressureState
  activeEntries: readonly ContextEntry[]
  fallbackContextWindow?: number | null
}

const normalizePositiveTokenCount = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.trunc(value)
}

const mapActiveEntryToPromptMessage = (entry: ContextEntry): { content: string } | null => {
  if (!entry.includeInModelContext) return null
  const content = String(entry.contentText ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
  if (!content) return null
  return { content }
}

export const estimateContextDebugPressure = ({
  config,
  promptBudgetService,
  runtime,
  activeEntries,
  fallbackContextWindow
}: EstimateContextDebugPressureInput): ContextPressureEstimate | null => {
  const runtimeContextWindow = normalizePositiveTokenCount(runtime.contextWindow)
  if (runtime.initialized && runtimeContextWindow) {
    return promptBudgetService.estimate({
      config,
      contextWindow: runtimeContextWindow,
      currentMessages: runtime.currentMessages,
      systemPrompt: runtime.systemPrompt,
      contextUsage: runtime.contextUsage
    })
  }

  const contextWindow = normalizePositiveTokenCount(fallbackContextWindow)
  if (!contextWindow) return null

  const currentMessages = activeEntries
    .map(mapActiveEntryToPromptMessage)
    .filter((message): message is { content: string } => Boolean(message))

  return promptBudgetService.estimate({
    config,
    contextWindow,
    currentMessages,
    systemPrompt: ''
  })
}
