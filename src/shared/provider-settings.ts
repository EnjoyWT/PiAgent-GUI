export type ProviderApiFormat = 'chat_completions' | 'responses' | 'anthropic_messages'
export type ProviderMaxTokensField = 'max_completion_tokens' | 'max_tokens'
export type ProviderThinkingFormat = 'openai' | 'zai' | 'qwen'

export type NormalizedProviderSettings = {
  apiFormat: ProviderApiFormat
  maxTokensField: ProviderMaxTokensField
  supportsDeveloperRole: boolean
  supportsReasoningEffort: boolean
  thinkingFormat: ProviderThinkingFormat
}

export type OpenAICompatSettings = {
  maxTokensField: ProviderMaxTokensField
  supportsDeveloperRole?: false
  supportsReasoningEffort?: false
  thinkingFormat?: Exclude<ProviderThinkingFormat, 'openai'>
}

type NormalizeProviderSettingsInput = {
  providerId?: string | null
  runtimeProvider?: string | null
  settings?: Record<string, unknown> | string | null
}

const parseBoolean = (value: unknown): boolean | null => {
  if (value === true || value === false) return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return null
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value) return {}
  if (typeof value === 'string') {
    const raw = value.trim()
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export const parseProviderSettings = (
  value: Record<string, unknown> | string | null | undefined
): Record<string, unknown> => asRecord(value)

export const isCustomProviderId = (providerId?: string | null): boolean =>
  String(providerId ?? '').startsWith('custom_')

export const isQwenProvider = (
  providerId?: string | null,
  runtimeProvider?: string | null
): boolean => {
  const normalizedProviderId = String(providerId ?? '')
    .trim()
    .toLowerCase()
  const normalizedRuntimeProvider = String(runtimeProvider ?? '')
    .trim()
    .toLowerCase()
  return normalizedProviderId === 'qwen' || normalizedRuntimeProvider === 'qwen'
}

export const isDeepSeekProvider = (
  providerId?: string | null,
  runtimeProvider?: string | null
): boolean => {
  const normalizedProviderId = String(providerId ?? '')
    .trim()
    .toLowerCase()
  const normalizedRuntimeProvider = String(runtimeProvider ?? '')
    .trim()
    .toLowerCase()
  return normalizedProviderId === 'deepseek' || normalizedRuntimeProvider === 'deepseek'
}

export const shouldRegisterDynamicProvider = (
  providerId?: string | null,
  runtimeProvider?: string | null
): boolean => isCustomProviderId(providerId) || isQwenProvider(providerId, runtimeProvider)

export const getDefaultProviderBaseUrl = (runtimeProvider?: string | null): string => {
  const normalized = String(runtimeProvider ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'google') return 'https://generativelanguage.googleapis.com/v1beta'
  if (normalized === 'anthropic') return 'https://api.anthropic.com'
  if (normalized === 'openai') return 'https://api.openai.com/v1'
  if (normalized === 'qwen') return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  return ''
}

export const normalizeProviderSettings = (
  input: NormalizeProviderSettingsInput
): NormalizedProviderSettings => {
  const settings = parseProviderSettings(input.settings)
  const isCustomProvider = isCustomProviderId(input.providerId)
  const isQwen = isQwenProvider(input.providerId, input.runtimeProvider)
  const isDeepSeek = isDeepSeekProvider(input.providerId, input.runtimeProvider)

  const apiFormatRaw = String(settings.apiFormat ?? 'chat_completions').trim()
  const apiFormat: ProviderApiFormat =
    apiFormatRaw === 'responses'
      ? 'responses'
      : apiFormatRaw === 'anthropic_messages'
        ? 'anthropic_messages'
        : 'chat_completions'

  const maxTokensFieldRaw = String(settings.maxTokensField ?? '').trim()
  const useMaxCompletionTokens = parseBoolean(settings.useMaxCompletionTokens)
  const maxTokensField: ProviderMaxTokensField =
    maxTokensFieldRaw === 'max_completion_tokens'
      ? 'max_completion_tokens'
      : maxTokensFieldRaw === 'max_tokens'
        ? 'max_tokens'
        : useMaxCompletionTokens === true
          ? 'max_completion_tokens'
          : 'max_tokens'

  const supportsDeveloperRole =
    parseBoolean(settings.supportsDeveloperRole) ??
    (isCustomProvider || isQwen || isDeepSeek ? false : true)
  const supportsReasoningEffort =
    parseBoolean(settings.supportsReasoningEffort) ?? (isQwen ? false : true)

  const thinkingFormatRaw = String(settings.thinkingFormat ?? '').trim()
  const thinkingFormat: ProviderThinkingFormat =
    thinkingFormatRaw === 'zai'
      ? 'zai'
      : thinkingFormatRaw === 'qwen'
        ? 'qwen'
        : isQwen
          ? 'qwen'
          : 'openai'

  return {
    apiFormat,
    maxTokensField,
    supportsDeveloperRole,
    supportsReasoningEffort,
    thinkingFormat
  }
}

export const buildOpenAICompatSettings = (
  settings: NormalizedProviderSettings
): OpenAICompatSettings => ({
  maxTokensField: settings.maxTokensField,
  ...(settings.supportsDeveloperRole ? {} : { supportsDeveloperRole: false as const }),
  ...(settings.supportsReasoningEffort ? {} : { supportsReasoningEffort: false as const }),
  ...(settings.thinkingFormat === 'openai' ? {} : { thinkingFormat: settings.thinkingFormat })
})
