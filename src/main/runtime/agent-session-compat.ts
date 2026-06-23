const SESSION_COMPAT_PATCHED = Symbol('piagent.agent-session-compat-patched')

export const DEFAULT_PROVIDER_CONTEXT_WINDOW_TOKENS = 128_000
export const DEFAULT_PROVIDER_MAX_TOKENS = 4_096

type ModelMetadataSource = {
  contextWindowTokens?: number | null
  rawJson?: string | null
}

type AgentSessionCompatMutable = {
  model?: {
    contextWindow?: number | null
    maxTokens?: number | null
  } | null
  _checkCompaction?: (assistantMessage: unknown, skipAbortedCheck?: boolean) => Promise<void>
  getContextUsage?: () => unknown
  [SESSION_COMPAT_PATCHED]?: boolean
}

const asPositiveInt = (value: unknown): number | null => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.trunc(parsed)
  return normalized > 0 ? normalized : null
}

const safeParseRawJson = (value?: string | null): Record<string, unknown> | null => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const extractFromRecord = (
  record: Record<string, unknown> | null,
  keys: string[]
): number | null => {
  if (!record) return null
  for (const key of keys) {
    const value = asPositiveInt(record[key])
    if (value) return value
  }
  return null
}

export const resolveProviderContextWindowTokens = (source: ModelMetadataSource): number => {
  const direct = asPositiveInt(source.contextWindowTokens)
  if (direct) return direct
  const parsed = safeParseRawJson(source.rawJson)
  return (
    extractFromRecord(parsed, [
      'context_window_tokens',
      'contextWindowTokens',
      'context_window',
      'contextWindow',
      'context_length',
      'contextLength',
      'max_context_length',
      'maxContextLength',
      'max_input_tokens',
      'maxInputTokens',
      'inputTokenLimit',
      'input_token_limit'
    ]) ?? DEFAULT_PROVIDER_CONTEXT_WINDOW_TOKENS
  )
}

export const resolveProviderMaxTokens = (
  source: Pick<ModelMetadataSource, 'rawJson'>,
  contextWindow?: number | null
): number => {
  const parsed = safeParseRawJson(source.rawJson)
  const direct = extractFromRecord(parsed, [
    'max_output_tokens',
    'maxOutputTokens',
    'max_tokens',
    'maxTokens',
    'max_completion_tokens',
    'maxCompletionTokens',
    'output_token_limit',
    'outputTokenLimit',
    'completion_token_limit',
    'completionTokenLimit'
  ])
  if (direct) return direct
  const normalizedContext = asPositiveInt(contextWindow)
  if (normalizedContext) return Math.min(DEFAULT_PROVIDER_MAX_TOKENS, normalizedContext)
  return DEFAULT_PROVIDER_MAX_TOKENS
}

const hasUsageMetrics = (usage: unknown): boolean => {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return false
  const record = usage as Record<string, unknown>
  return (
    asPositiveInt(record.totalTokens) != null ||
    asPositiveInt(record.input) != null ||
    asPositiveInt(record.output) != null ||
    asPositiveInt(record.cacheRead) != null ||
    asPositiveInt(record.cacheWrite) != null
  )
}

const isMissingUsageMetadataError = (error: unknown): boolean =>
  error instanceof TypeError && /totalTokens|input|output|cacheRead|cacheWrite/.test(error.message)

const IMAGE_TOKEN_ESTIMATE = 512

const estimateMessageTokens = (message: unknown): number => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return 0
  const msg = message as Record<string, unknown>
  const content = msg.content
  if (typeof content === 'string') {
    const normalized = String(content).replace(/\r\n/g, '\n').trim()
    return normalized ? Math.max(1, Math.ceil(normalized.length / 4)) : 0
  }
  if (!Array.isArray(content)) return 0
  let total = 0
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      const normalized = b.text.replace(/\r\n/g, '\n').trim()
      total += normalized ? Math.max(1, Math.ceil(normalized.length / 4)) : 0
    }
    if (b.type === 'image') {
      total += IMAGE_TOKEN_ESTIMATE
    }
  }
  return total
}

const estimateHeuristicTokens = (session: Record<string, unknown>): number => {
  let total = 0
  const systemPrompt = session.systemPrompt as string | undefined
  if (typeof systemPrompt === 'string') {
    const normalized = systemPrompt.replace(/\r\n/g, '\n').trim()
    total += normalized ? Math.max(1, Math.ceil(normalized.length / 4)) : 0
  }
  const messages = session.messages
  if (Array.isArray(messages)) {
    for (const message of messages) {
      total += estimateMessageTokens(message)
    }
  }
  return total
}

export const applyAgentSessionCompat = <T extends object>(
  session: T,
  defaults?: {
    contextWindow?: number | null
    maxTokens?: number | null
  }
): T => {
  const compat = session as T & AgentSessionCompatMutable
  const defaultContextWindow =
    asPositiveInt(defaults?.contextWindow) ?? DEFAULT_PROVIDER_CONTEXT_WINDOW_TOKENS
  const defaultMaxTokens =
    asPositiveInt(defaults?.maxTokens) ?? resolveProviderMaxTokens({}, defaultContextWindow)

  const model =
    compat.model && typeof compat.model === 'object'
      ? compat.model
      : ((compat.model = {}), compat.model)
  if (!model) return session

  if (asPositiveInt(model.contextWindow) == null) {
    model.contextWindow = defaultContextWindow
  }
  if (asPositiveInt(model.maxTokens) == null) {
    model.maxTokens = Math.min(
      defaultMaxTokens,
      asPositiveInt(model.contextWindow) ?? defaultMaxTokens
    )
  }

  if (compat[SESSION_COMPAT_PATCHED]) return session

  const originalCheckCompaction =
    typeof compat._checkCompaction === 'function' ? compat._checkCompaction.bind(compat) : null
  if (originalCheckCompaction) {
    compat._checkCompaction = async (
      assistantMessage: unknown,
      skipAbortedCheck?: boolean
    ): Promise<void> => {
      const currentContextWindow = asPositiveInt(compat.model?.contextWindow)
      if (currentContextWindow == null) return

      const record =
        assistantMessage && typeof assistantMessage === 'object' && !Array.isArray(assistantMessage)
          ? (assistantMessage as Record<string, unknown>)
          : null
      const stopReason = typeof record?.stopReason === 'string' ? record.stopReason : ''

      if (stopReason !== 'error' && !hasUsageMetrics(record?.usage)) {
        return
      }

      try {
        await originalCheckCompaction(assistantMessage, skipAbortedCheck)
      } catch (error) {
        if (isMissingUsageMetadataError(error)) return
        throw error
      }
    }
  }

  const originalGetContextUsage =
    typeof compat.getContextUsage === 'function' ? compat.getContextUsage.bind(compat) : null
  if (originalGetContextUsage) {
    compat.getContextUsage = () => {
      try {
        const result = originalGetContextUsage()
        // Sanity-check: when the API-reported usage is far below a heuristic
        // estimate of session tokens, the API data is unreliable (e.g. the
        // provider doesn't support stream_options.include_usage correctly).
        // Fall back to the heuristic to avoid misleadingly low percentages.
        if (result && typeof result === 'object' && 'tokens' in result) {
          const raw = result as { tokens: number | null; contextWindow: number; percent: number | null }
          const apiTokens = raw.tokens
          if (typeof apiTokens === 'number' && apiTokens > 0) {
            const contextWindow = raw.contextWindow ?? asPositiveInt(compat.model?.contextWindow) ?? 0
            if (contextWindow > 0) {
              const heuristicTokens = estimateHeuristicTokens(
                compat as unknown as Record<string, unknown>
              )
              if (heuristicTokens > 0 && apiTokens < heuristicTokens * 0.5) {
                const percent = (heuristicTokens / contextWindow) * 100
                return { tokens: heuristicTokens, contextWindow, percent }
              }
            }
          }
        }
        return result
      } catch (error) {
        if (!isMissingUsageMetadataError(error)) throw error
        const currentContextWindow = asPositiveInt(compat.model?.contextWindow)
        if (currentContextWindow == null) return undefined
        return { tokens: null, contextWindow: currentContextWindow, percent: null }
      }
    }
  }

  compat[SESSION_COMPAT_PATCHED] = true
  return session
}
