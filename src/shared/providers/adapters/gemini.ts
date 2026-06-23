import type {
  ProviderAdapter,
  ProviderConnection,
  ProviderModel,
  ProviderProbeResult
} from '../types'
import { fetchJson } from '../http.ts'

type GeminiRawModel = {
  name: string
  displayName?: string
  inputTokenLimit?: number
  supportedGenerationMethods?: string[]
  thinking?: boolean
}

type GeminiModelsResponse = {
  models?: GeminiRawModel[]
}

type ModelCapabilities = {
  imageInput: boolean
  imageOutput: boolean
  tools: boolean
  reasoning: boolean
}

const resolveSeriesCapabilities = (modelId: string): ModelCapabilities | null => {
  const id = modelId.toLowerCase()

  if (/^gemini-2\.0-flash-lite(?:$|-)/.test(id)) {
    return { imageInput: true, imageOutput: false, tools: false, reasoning: false }
  }

  if (/^gemini-2\.5-flash-image(?:$|-)/.test(id)) {
    return { imageInput: true, imageOutput: true, tools: false, reasoning: false }
  }

  if (/^(imagen-|nano-banana)/.test(id)) {
    return { imageInput: true, imageOutput: true, tools: false, reasoning: false }
  }

  if (/tts/.test(id) || /embedding/.test(id) || /^text-embedding/.test(id)) {
    return { imageInput: false, imageOutput: false, tools: false, reasoning: false }
  }

  if (/^gemini-(3(?:\.\d+)?|2\.5)-/.test(id)) {
    return { imageInput: true, imageOutput: false, tools: true, reasoning: true }
  }

  if (/^gemini-(2\.0|1\.5)-/.test(id)) {
    return { imageInput: true, imageOutput: false, tools: true, reasoning: false }
  }

  return null
}

const normalizeBaseUrl = (baseUrl?: string | null): string => {
  const fallback = 'https://generativelanguage.googleapis.com/v1beta'
  const raw = (baseUrl ?? '').trim()
  const next = raw || fallback
  return next.replace(/\/+$/g, '')
}

const withApiKey = (url: string, apiKey: string): string => {
  const next = new URL(url)
  next.searchParams.set('key', apiKey.trim())
  return next.toString()
}

const mapModel = (m: GeminiRawModel): ProviderModel => {
  const modelId = (m.name ?? '').replace(/^models\//, '')
  const methods = new Set((m.supportedGenerationMethods ?? []).map((x) => x.toLowerCase()))
  const seriesCaps = resolveSeriesCapabilities(modelId)

  const supportsImageOutputByMethod = methods.has('generateimage')
  const supportsImageInputByMethod =
    supportsImageOutputByMethod ||
    methods.has('bidigeneratecontent') ||
    methods.has('generatecontent')
  const supportsToolsByMethod = methods.has('functioncall')
  const supportsReasoningByField = Boolean(m.thinking)

  const imageInput =
    seriesCaps?.imageInput ??
    (supportsImageInputByMethod || /(image|vision|video|audio|pdf)/i.test(modelId))
  const imageOutput =
    seriesCaps?.imageOutput ??
    (supportsImageOutputByMethod || /(imagen|nano-banana|flash-image)/i.test(modelId))
  const tools = seriesCaps?.tools ?? supportsToolsByMethod
  const reasoning = seriesCaps?.reasoning ?? supportsReasoningByField

  return {
    modelId,
    label: m.displayName || modelId,
    contextWindowTokens: m.inputTokenLimit ?? null,
    capabilities: { imageInput, imageOutput, tools, reasoning },
    raw: m
  }
}

const probeInference = async (
  conn: ProviderConnection,
  modelId: string
): Promise<ProviderProbeResult> => {
  const apiKey = (conn.apiKey ?? '').trim()
  if (!apiKey) return { ok: false, error: '请输入 API Key' }
  const base = normalizeBaseUrl(conn.baseUrl)
  const start = performance.now()
  try {
    await fetchJson(withApiKey(`${base}/models/${modelId}:generateContent`, apiKey), {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: {
          maxOutputTokens: 1,
          temperature: 0
        }
      })
    })
    return { ok: true, ms: Math.round(performance.now() - start) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg.slice(0, 180) }
  }
}

export const geminiAdapter: ProviderAdapter = {
  providerId: 'google',
  displayName: 'Google Gemini',
  docs: {
    keyHint: '在 Google AI Studio 生成 API Key',
    basePlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
    docUrl: 'https://ai.google.dev/tutorials/setup',
    docLabel: 'Google AI Studio'
  },
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  normalizeBaseUrl,
  settingsSpec: () => ({ extraFields: [] }),
  listModels: async (conn: ProviderConnection): Promise<ProviderModel[]> => {
    const base = normalizeBaseUrl(conn.baseUrl)
    const url = withApiKey(`${base}/models`, conn.apiKey)
    const json = await fetchJson<GeminiModelsResponse>(url)
    const list = Array.isArray(json?.models) ? json.models : []
    return list.map(mapModel).filter((m) => Boolean(m.modelId))
  },
  probeInference,
  speedTest: probeInference
}
