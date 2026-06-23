import type {
  ProviderCapabilitySet,
  ProviderConnection,
  ProviderModel,
  ProviderProbeResult
} from '../types'
import { fetchJson } from '../http.ts'
import { normalizeProviderSettings } from '../../provider-settings.ts'

type OpenAICompatibleOptions = {
  fallbackBaseUrl?: string
  runtimeProvider?: string
}

const bearer = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`
})

export const normalizeOpenAICompatibleBaseUrl = (
  baseUrl?: string | null,
  fallbackBaseUrl: string = ''
): string => {
  const raw = (baseUrl ?? '').trim()
  const next = raw || fallbackBaseUrl
  return next.replace(/\/+$/g, '')
}

const asPositiveInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) return null
  const x = Math.trunc(n)
  return x > 0 ? x : null
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const asBoolean = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return null
}

const firstBoolean = (
  records: Array<Record<string, unknown> | null>,
  keys: string[]
): boolean | null => {
  for (const record of records) {
    if (!record) continue
    for (const key of keys) {
      const value = asBoolean(record[key])
      if (value !== null) return value
    }
  }
  return null
}

export const extractContextWindowTokens = (x: any, modelId?: string): number | null => {
  if (x && typeof x === 'object') {
    const capabilities = asRecord(x.capabilities)
    const features = asRecord(x.features)
    const parsed =
      asPositiveInt(x.context_window_tokens) ??
      asPositiveInt(x.contextWindowTokens) ??
      asPositiveInt(x.context_window) ??
      asPositiveInt(x.contextWindow) ??
      asPositiveInt(x.context_length) ??
      asPositiveInt(x.contextLength) ??
      asPositiveInt(x.max_context_length) ??
      asPositiveInt(x.maxContextLength) ??
      asPositiveInt(x.max_context_window) ??
      asPositiveInt(x.maxContextWindow) ??
      asPositiveInt(x.max_model_len) ??
      asPositiveInt(x.maxModelLen) ??
      asPositiveInt(x.max_input_tokens) ??
      asPositiveInt(x.maxInputTokens) ??
      asPositiveInt(x.inputTokenLimit) ??
      asPositiveInt(x.input_token_limit) ??
      asPositiveInt(capabilities?.max_context_window) ??
      asPositiveInt(capabilities?.maxContextWindow) ??
      asPositiveInt(capabilities?.context_window_tokens) ??
      asPositiveInt(capabilities?.contextWindowTokens) ??
      asPositiveInt(features?.max_context_window) ??
      asPositiveInt(features?.maxContextWindow) ??
      asPositiveInt(features?.context_window_tokens) ??
      asPositiveInt(features?.contextWindowTokens) ??
      null
    if (parsed !== null) return parsed
  }
  const id = modelId || (x && typeof x === 'object' ? String(x.id ?? x.modelId ?? '') : '')
  if (id) {
    return resolveContextWindowTokensFromModelId(id)
  }
  return null
}

export const resolveContextWindowTokensFromModelId = (modelId: string): number | null => {
  const id = modelId.toLowerCase()

  // Gemini models
  if (/gemini-(?:1\.5|2\.[05])/i.test(id)) {
    if (id.includes('pro')) return 2097152 // 2M
    return 1048576 // 1M
  }
  if (id.includes('gemini')) return 1048576

  // Claude models
  if (/(?:claude-3|claude-3-5|claude-3\.5)/i.test(id)) {
    return 200000
  }
  if (id.includes('claude')) return 100000

  // GPT-5 models (mock/future)
  if (/gpt-5/i.test(id)) {
    if (id.includes('mini')) return 256000
    return 1048576 // 1M
  }

  // GPT-4 and derivatives
  if (/(?:gpt-4o|gpt-4-turbo|gpt-4o-mini|o1|o3)/i.test(id)) {
    return 128000
  }
  if (id.includes('gpt-4')) {
    if (id.includes('32k')) return 32768
    return 8192
  }

  // GPT-3/3.5
  if (id.includes('gpt-3.5') || id.includes('gpt-35')) {
    if (id.includes('16k')) return 16384
    return 16385
  }

  // DeepSeek
  if (id.includes('deepseek')) {
    return 128000 // DeepSeek-V3, R1, and Chat are all 128k now
  }

  // Qwen / QwQ
  if (id.includes('qwen') || id.includes('qwq')) {
    if (id.includes('1.5') || id.includes('15')) {
      return 32768
    }
    return 131072 // Qwen 2, 2.5, and QwQ default to 128k
  }

  // GLM / ChatGLM
  if (id.includes('glm') || id.includes('chatglm')) {
    if (id.includes('128k')) return 128000
    return 128000 // GLM-4 supports 128k
  }

  // Doubao
  if (id.includes('doubao')) {
    if (id.includes('128k')) return 128000
    if (id.includes('32k')) return 32000
    return 8000
  }

  // Yi
  if (id.includes('yi-')) {
    if (id.includes('34b') || id.includes('200k')) return 200000
    return 64000
  }

  // Moonshot / Kimi
  if (id.includes('moonshot') || id.includes('kimi')) {
    if (id.includes('128k')) return 128000
    if (id.includes('32k')) return 32000
    if (id.includes('8k')) return 8192
    return 128000
  }

  // Codex or custom
  if (id.includes('codex')) {
    return 16384
  }

  // Default fallback if we cannot match
  return null
}

export const resolveOpenAICompatibleCapabilities = (
  modelId: string,
  raw?: unknown
): ProviderCapabilitySet => {
  const id = modelId.toLowerCase()

  // 1. Try to read modalities from raw API response (OpenAI-compatible format)
  let imageInput = false
  const rawRec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const modalities = rawRec?.modalities
  if (modalities !== undefined) {
    // Format A: array of strings e.g. ["text", "image"]
    if (Array.isArray(modalities)) {
      imageInput = modalities.some((m: unknown) => String(m).toLowerCase() === 'image')
    }
    // Format B: { input: [...], output: [...] }
    else if (typeof modalities === 'object') {
      const inputMods = (modalities as Record<string, unknown>).input
      if (Array.isArray(inputMods)) {
        imageInput = inputMods.some((m: unknown) => String(m).toLowerCase() === 'image')
      }
    }
    // Format C: input_modalities / input_modality (some proxies)
    if (!imageInput) {
      const alt = rawRec?.input_modalities ?? rawRec?.input_modality
      if (Array.isArray(alt)) {
        imageInput = alt.some((m: unknown) => String(m).toLowerCase() === 'image')
      }
    }
  }

  // 2. Fallback: infer from modelId patterns
  if (!imageInput) {
    imageInput =
      /(?:vision|vl|ocr|qvq|omni|multimodal|pixtral|internvl|cogvlm|minicpm-v|image)/i.test(id) ||
      /^(?:gpt-4o|gpt-4-turbo|gpt-4-vision|gpt-4\.5|gpt-5)/i.test(id) ||
      /^(?:claude-3|claude-3-5|claude-3\.5)/i.test(id) ||
      /^(?:gemini-(?:1\.5|2\.[05]))/i.test(id)
  }

  const imageOutput = /(?:dall-e|stable-diffusion|flux|midjourney|imagen|cogview)/i.test(id)

  // 3. Try to read reasoning/tools from raw API response first
  const capabilities = asRecord(rawRec?.capabilities)
  const features = asRecord(rawRec?.features)
  const supports = asRecord(rawRec?.supports)
  let reasoning = firstBoolean(
    [capabilities, features, supports, rawRec],
    ['reasoning', 'supports_reasoning', 'supportsReasoning']
  )
  let tools = firstBoolean(
    [capabilities, features, supports, rawRec],
    [
      'tools',
      'function_calling',
      'functionCalling',
      'supports_tools',
      'supportsTools',
      'supports_function_calling',
      'supportsFunctionCalling'
    ]
  )

  if (rawRec && Array.isArray(rawRec.features)) {
    const featureSet = rawRec.features.map((f: unknown) => String(f).toLowerCase())
    if (
      reasoning === null &&
      featureSet.some((f) => ['reasoning', 'thinking', 'reasoning_effort'].includes(f))
    ) {
      reasoning = true
    }
    if (
      tools === null &&
      featureSet.some((f) => ['tools', 'function_calling', 'functions'].includes(f))
    ) {
      tools = true
    }
  }

  // 4. Fallback: infer from modelId patterns if API didn't provide the info
  if (reasoning === null) {
    reasoning =
      /^(?:o1|o3|r1|qwq)/i.test(id) ||
      /(?:reasoner|reasoning|thinking|preview)/i.test(id) ||
      /^(?:deepseek-(?:r1|reasoner|chat|v[34]))/i.test(id) ||
      /^deepseek-v4-/i.test(id)
  }

  if (tools === null) {
    const isSpecialtyModel =
      /(?:embedding|rerank|tts|whisper|speech|moderation|audio|dall-e|flux|midjourney|imagen|cogview|stable-diffusion)/i.test(
        id
      )
    tools = !isSpecialtyModel
  }

  return {
    imageInput,
    imageOutput,
    tools,
    reasoning
  }
}

export const listOpenAICompatibleModels = async (
  conn: ProviderConnection,
  options: OpenAICompatibleOptions = {}
): Promise<ProviderModel[]> => {
  const base = normalizeOpenAICompatibleBaseUrl(conn.baseUrl, options.fallbackBaseUrl)
  if (!base) return []

  const json = await fetchJson<any>(`${base}/models`, {
    headers: {
      ...bearer((conn.apiKey ?? '').trim())
    }
  })

  const data = Array.isArray(json?.data) ? json.data : null
  if (data) {
    return data
      .map((x: any) => {
        const mId = String(x?.id ?? '').trim()
        return {
          modelId: mId,
          label: String(x?.name ?? x?.display_name ?? x?.id ?? '').trim(),
          contextWindowTokens: extractContextWindowTokens(x, mId),
          capabilities: resolveOpenAICompatibleCapabilities(mId, x),
          raw: x ?? null
        }
      })
      .filter((m: ProviderModel) => Boolean(m.modelId))
  }

  if (Array.isArray(json)) {
    return json
      .map((x) => String(x ?? '').trim())
      .filter(Boolean)
      .map((id) => ({
        modelId: id,
        label: id,
        contextWindowTokens: extractContextWindowTokens(null, id),
        capabilities: resolveOpenAICompatibleCapabilities(id)
      }))
  }

  return []
}

export const probeOpenAICompatibleChat = async (
  conn: ProviderConnection,
  modelId: string,
  options: OpenAICompatibleOptions = {}
): Promise<ProviderProbeResult> => {
  const apiKey = (conn.apiKey ?? '').trim()
  if (!apiKey) return { ok: false, error: '请输入 API Key' }

  const base = normalizeOpenAICompatibleBaseUrl(conn.baseUrl, options.fallbackBaseUrl)
  if (!base) return { ok: false, error: '请输入 Base URL' }

  const settings = normalizeProviderSettings({
    providerId: conn.providerId,
    runtimeProvider: options.runtimeProvider,
    settings: conn.settings
  })

  const start = performance.now()

  try {
    const body: Record<string, unknown> = {
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      [settings.maxTokensField]: 1
    }

    if (settings.thinkingFormat === 'qwen') body.enable_thinking = false

    await fetchJson(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        ...bearer(apiKey),
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    return { ok: true, ms: Math.round(performance.now() - start) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg.slice(0, 180) }
  }
}
