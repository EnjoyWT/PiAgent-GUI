import { complete, type Api, type Context, type Model } from '@earendil-works/pi-ai/compat'
import {
  getProviderApiKey,
  listProviderModels,
  listProviders,
  type ProviderInfo
} from '../db/config-db.ts'
import {
  buildOpenAICompatSettings,
  getDefaultProviderBaseUrl,
  normalizeProviderSettings,
  parseProviderSettings,
  shouldRegisterDynamicProvider
} from '@shared/provider-settings'

type ResolvedOneShotModel = {
  provider: ProviderInfo
  providerId: string
  modelId: string
  modelKey: string
  model: Model<Api>
  apiKey: string
}

export type OneShotTextInput = {
  modelKeys: string[]
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  timeoutMs: number
  temperature?: number
}

export type OneShotTextResult = {
  modelKey: string
  text: string
}

const DEFAULT_CONTEXT_WINDOW = 128000
const DEFAULT_MAX_TOKENS = 4096

const parseJsonRecord = (value: string | null | undefined): Record<string, unknown> => {
  const raw = String(value ?? '').trim()
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const parseModelKey = (value: string): { providerId: string; modelId: string } | null => {
  const raw = String(value ?? '').trim()
  if (!raw.includes('::')) return null
  const [providerId, ...rest] = raw.split('::')
  const modelId = rest.join('::').trim()
  if (!providerId?.trim() || !modelId) return null
  return {
    providerId: providerId.trim(),
    modelId
  }
}

const resolveBaseUrl = (provider: ProviderInfo): string => {
  const configured = String(provider.baseUrl ?? '')
    .trim()
    .replace(/\/+$/g, '')
  if (configured) return configured
  return getDefaultProviderBaseUrl(provider.runtimeProvider)
}

const parseReasoningCapability = (value: string | null | undefined): boolean => {
  const parsed = parseJsonRecord(value)
  return Boolean(parsed.reasoning)
}

const buildModel = (
  provider: ProviderInfo,
  modelId: string,
  contextWindow: number | null,
  reasoning: boolean
): Model<Api> | null => {
  const settings = parseProviderSettings(provider.settingsJson)
  const baseUrl = resolveBaseUrl(provider)
  if (!baseUrl) return null

  if (shouldRegisterDynamicProvider(provider.id, provider.runtimeProvider)) {
    const normalizedSettings = normalizeProviderSettings({
      providerId: provider.id,
      runtimeProvider: provider.runtimeProvider,
      settings
    })
    const api: Api =
      normalizedSettings.apiFormat === 'responses'
        ? 'openai-responses'
        : normalizedSettings.apiFormat === 'anthropic_messages'
          ? 'anthropic-messages'
          : 'openai-completions'

    return {
      id: modelId,
      name: modelId,
      api,
      provider: provider.runtimeProvider || provider.id,
      baseUrl: api === 'anthropic-messages' ? baseUrl.replace(/\/v1$/i, '') : baseUrl,
      reasoning,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
      headers: api === 'anthropic-messages' ? { 'anthropic-version': '2023-06-01' } : undefined,
      compat:
        api === 'openai-completions' ? buildOpenAICompatSettings(normalizedSettings) : undefined
    }
  }

  if (provider.runtimeProvider === 'google') {
    return {
      id: modelId,
      name: modelId,
      api: 'google-generative-ai',
      provider: 'google',
      baseUrl,
      reasoning,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS
    }
  }

  if (provider.runtimeProvider === 'anthropic') {
    return {
      id: modelId,
      name: modelId,
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl,
      reasoning,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
      headers: { 'anthropic-version': '2023-06-01' }
    }
  }

  if (provider.runtimeProvider === 'openai') {
    return {
      id: modelId,
      name: modelId,
      api: 'openai-responses',
      provider: 'openai',
      baseUrl,
      reasoning,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS
    }
  }

  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: provider.runtimeProvider || provider.id,
    baseUrl,
    reasoning,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS
  }
}

const resolveConfiguredModel = (modelKey: string): ResolvedOneShotModel | null => {
  const parsed = parseModelKey(modelKey)
  if (!parsed) return null

  const provider = listProviders().find((item) => item.id === parsed.providerId)
  if (!provider) return null

  const apiKey = String(getProviderApiKey(provider.id) ?? '').trim()
  if (!apiKey) return null

  const modelRow =
    listProviderModels(provider.id).find((item) => item.modelId === parsed.modelId) ?? null

  const model = buildModel(
    provider,
    parsed.modelId,
    modelRow?.contextWindowTokens ?? null,
    parseReasoningCapability(modelRow?.capabilitiesJson ?? null)
  )
  if (!model) return null

  model.name = modelRow?.label?.trim() || parsed.modelId

  return {
    provider,
    providerId: parsed.providerId,
    modelId: parsed.modelId,
    modelKey: `${parsed.providerId}::${parsed.modelId}`,
    model,
    apiKey
  }
}

const extractAssistantText = (content: Array<{ type: string; text?: string }>): string =>
  content
    .filter((block) => block.type === 'text')
    .map((block) => String(block.text ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()

const withTimeout = async <T>(timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>) => {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('One-shot model request timed out')),
    timeoutMs
  )

  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

const normalizeModelKeyList = (items: string[]): string[] =>
  Array.from(new Set(items.map((item) => String(item ?? '').trim()).filter(Boolean)))

export const runOneShotText = async (
  input: OneShotTextInput
): Promise<OneShotTextResult | null> => {
  const candidateModelKeys = normalizeModelKeyList(input.modelKeys)
  if (candidateModelKeys.length === 0) return null

  const failures: Array<{ modelKey: string; reason: string }> = []

  for (const modelKey of candidateModelKeys) {
    const resolved = resolveConfiguredModel(modelKey)
    if (!resolved) {
      failures.push({ modelKey, reason: 'model resolution failed (provider not found, API key missing, or model not configured)' })
      continue
    }

    const context: Context = {
      systemPrompt: input.systemPrompt,
      messages: [
        {
          role: 'user',
          content: input.userPrompt,
          timestamp: Date.now()
        }
      ]
    }

    try {
      const response = await withTimeout(input.timeoutMs, async (signal) =>
        complete(resolved.model, context, {
          apiKey: resolved.apiKey,
          maxTokens: Math.min(input.maxTokens, resolved.model.maxTokens),
          temperature: input.temperature ?? 0,
          signal
        })
      )

      const text = extractAssistantText(response.content)
      if (!text) {
        const contentTypes = Array.isArray(response.content)
          ? response.content.map((block: { type: string }) => block.type).join(', ')
          : typeof response.content
        failures.push({
          modelKey: resolved.modelKey,
          reason: `model returned empty text (content block types: [${contentTypes || 'none'}])`
        })
        continue
      }

      return {
        modelKey: resolved.modelKey,
        text
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      failures.push({ modelKey: resolved.modelKey, reason })
      continue
    }
  }

  const failureSummary = failures
    .map((f) => `  - ${f.modelKey}: ${f.reason}`)
    .join('\n')
  console.error(
    `[one-shot] All ${candidateModelKeys.length} model(s) failed for one-shot completion:\n${failureSummary}`
  )

  return null
}
