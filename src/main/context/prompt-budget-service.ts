import type { ContextEngineConfig, ContextPressureEstimate } from './context-types.ts'

type PromptBudgetInput = {
  config: ContextEngineConfig
  contextWindow: number
  currentMessages: unknown[]
  systemPrompt?: string
  appendedSystemPrompt?: string
  pendingUserText?: string
  pendingImageCount?: number
  contextUsage?: {
    tokens: number | null
    contextWindow: number
    percent: number | null
  }
}

const IMAGE_TOKEN_ESTIMATE = 512

const normalizeText = (value: string): string => value.replace(/\r\n/g, '\n').trim()

const estimateTextTokens = (value: string): number => {
  const normalized = normalizeText(value)
  if (!normalized) return 0
  return Math.max(1, Math.ceil(normalized.length / 4))
}

const estimateMessageTokens = (message: unknown): number => {
  const content =
    message && typeof message === 'object' && !Array.isArray(message)
      ? (message as { content?: unknown }).content
      : undefined
  if (typeof content === 'string') return estimateTextTokens(content)
  if (!Array.isArray(content)) return 0

  let total = 0
  try {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      if ('type' in block && block.type === 'text' && typeof block.text === 'string') {
        total += estimateTextTokens(block.text)
        continue
      }
      if ('type' in block && block.type === 'image') {
        total += IMAGE_TOKEN_ESTIMATE
      }
    }
  } catch {
    // Content was somehow not iterable despite the Array.isArray guard
  }
  return total
}

const computeThresholdTokens = (
  contextWindow: number,
  config: ContextEngineConfig,
  mode: ContextPressureEstimate['estimateMode']
): number => {
  const percent =
    mode === 'usage_backed'
      ? config.trigger.thresholdPercent
      : config.trigger.estimatedThresholdPercent
  const byPercent = Math.floor(contextWindow * percent)
  const withReserve = Math.max(1, contextWindow - config.trigger.reserveOutputTokens)
  return Math.max(1, Math.min(byPercent, withReserve))
}

const resolveWarningLevel = (
  estimatedPromptTokens: number,
  thresholdTokens: number
): ContextPressureEstimate['warningLevel'] => {
  if (estimatedPromptTokens >= thresholdTokens) return 'critical'
  if (estimatedPromptTokens >= Math.floor(thresholdTokens * 0.85)) return 'warning'
  return 'normal'
}

export class PromptBudgetService {
  estimate(input: PromptBudgetInput): ContextPressureEstimate {
    const contextWindow = Math.max(
      0,
      Math.trunc(input.contextUsage?.contextWindow ?? input.contextWindow ?? 0)
    )
    const additionalTokens =
      estimateTextTokens(input.pendingUserText ?? '') +
      estimateTextTokens(input.appendedSystemPrompt ?? '') +
      Math.max(0, Math.trunc(input.pendingImageCount ?? 0)) * IMAGE_TOKEN_ESTIMATE
    const basePromptTokens =
      estimateTextTokens(input.systemPrompt ?? '') +
      input.currentMessages.reduce<number>(
        (sum, message) => sum + estimateMessageTokens(message),
        0
      )

    const usageTokens = input.contextUsage?.tokens
    if (
      contextWindow > 0 &&
      typeof usageTokens === 'number' &&
      Number.isFinite(usageTokens) &&
      usageTokens > 0
    ) {
      const currentContextTokens = Math.max(0, Math.trunc(usageTokens), basePromptTokens)
      const estimatedPromptTokens = currentContextTokens + additionalTokens
      const thresholdTokens = computeThresholdTokens(contextWindow, input.config, 'usage_backed')
      return {
        contextWindow,
        estimatedPromptTokens,
        thresholdTokens,
        estimateMode: 'usage_backed',
        currentContextTokens,
        additionalTokens,
        warningLevel: resolveWarningLevel(estimatedPromptTokens, thresholdTokens)
      }
    }

    const estimatedPromptTokens = basePromptTokens + additionalTokens
    const thresholdTokens = computeThresholdTokens(
      contextWindow || 1,
      input.config,
      'heuristic_only'
    )
    return {
      contextWindow,
      estimatedPromptTokens,
      thresholdTokens,
      estimateMode: 'heuristic_only',
      currentContextTokens: null,
      additionalTokens,
      warningLevel: resolveWarningLevel(estimatedPromptTokens, thresholdTokens)
    }
  }
}
