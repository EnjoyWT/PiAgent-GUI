export const XIAOMI_MIMO_ANTHROPIC_BASE_URL =
  'https://token-plan-ams.xiaomimimo.com/anthropic'

const XIAOMI_MIMO_ANTHROPIC_PATH = '/anthropic'
const XIAOMI_MIMO_OPENAI_COMPATIBLE_PATH_PATTERN = /\/v1$/i
const XIAOMI_MIMO_PREVIOUS_DEFAULT_ANTHROPIC_BASE_URL = 'https://api.mimo-v2.com/anthropic'

const isXiaomiProvider = (providerId: string): boolean => providerId === 'xiaomi'

const trimTrailingSlashes = (value: string): string => value.trim().replace(/\/+$/g, '')

const usesXiaomiAnthropicSurface = (baseUrl: string): boolean => {
  const trimmed = trimTrailingSlashes(baseUrl)
  if (!trimmed) return false

  try {
    const url = new URL(trimmed)
    return trimTrailingSlashes(url.pathname).toLowerCase().endsWith(XIAOMI_MIMO_ANTHROPIC_PATH)
  } catch {
    return trimmed.toLowerCase().endsWith(XIAOMI_MIMO_ANTHROPIC_PATH)
  }
}

const normalizeOpenAICompatiblePathToAnthropic = (baseUrl: string): string | null => {
  const trimmed = trimTrailingSlashes(baseUrl)
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    const pathname = trimTrailingSlashes(url.pathname)
    if (!XIAOMI_MIMO_OPENAI_COMPATIBLE_PATH_PATTERN.test(pathname)) return null

    url.pathname = pathname.replace(
      XIAOMI_MIMO_OPENAI_COMPATIBLE_PATH_PATTERN,
      XIAOMI_MIMO_ANTHROPIC_PATH
    )
    url.search = ''
    url.hash = ''
    return trimTrailingSlashes(url.toString())
  } catch {
    if (!XIAOMI_MIMO_OPENAI_COMPATIBLE_PATH_PATTERN.test(trimmed)) return null
    return trimmed.replace(
      XIAOMI_MIMO_OPENAI_COMPATIBLE_PATH_PATTERN,
      XIAOMI_MIMO_ANTHROPIC_PATH
    )
  }
}

const isKnownXiaomiDefaultAnthropicBaseUrl = (baseUrl: string): boolean => {
  const trimmed = trimTrailingSlashes(baseUrl).toLowerCase()
  return (
    trimmed === XIAOMI_MIMO_ANTHROPIC_BASE_URL ||
    trimmed === XIAOMI_MIMO_PREVIOUS_DEFAULT_ANTHROPIC_BASE_URL
  )
}

export const getProviderDefaultBaseUrlOverride = (providerId: string): string | null =>
  isXiaomiProvider(providerId) ? XIAOMI_MIMO_ANTHROPIC_BASE_URL : null

export const normalizeXiaomiConfiguredBaseUrlForModel = (
  providerId: string,
  configuredBaseUrl: string,
  modelBaseUrl: string
): string => {
  if (!isXiaomiProvider(providerId)) return configuredBaseUrl

  const trimmed = trimTrailingSlashes(configuredBaseUrl)
  if (!trimmed || !usesXiaomiAnthropicSurface(modelBaseUrl)) return trimmed

  const normalized = normalizeOpenAICompatiblePathToAnthropic(trimmed) ?? trimmed
  return isKnownXiaomiDefaultAnthropicBaseUrl(normalized)
    ? XIAOMI_MIMO_ANTHROPIC_BASE_URL
    : normalized
}

export const normalizeBuiltInProviderModelBaseUrl = <T extends { baseUrl?: string }>(
  providerId: string,
  model: T
): T =>
  isXiaomiProvider(providerId)
    ? {
        ...model,
        baseUrl: XIAOMI_MIMO_ANTHROPIC_BASE_URL
      }
    : model
