import type {
  ProviderAdapter,
  ProviderConnection,
  ProviderModel,
  ProviderProbeResult
} from '../types'
import { fetchJson } from '../http.ts'

type AnthropicModelsResponse = {
  data?: Array<{
    id?: string
    display_name?: string
  }>
}

const normalizeBaseUrl = (baseUrl?: string | null) => {
  const fallback = 'https://api.anthropic.com'
  const raw = (baseUrl ?? '').trim()
  const next = raw || fallback
  return next.replace(/\/+$/g, '')
}

const headers = (apiKey: string) => ({
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01'
})

const probeInference = async (
  conn: ProviderConnection,
  modelId: string
): Promise<ProviderProbeResult> => {
  const apiKey = (conn.apiKey ?? '').trim()
  if (!apiKey) return { ok: false, error: '请输入 API Key' }
  const base = normalizeBaseUrl(conn.baseUrl)
  const start = performance.now()
  try {
    await fetchJson(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        ...headers(apiKey),
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      })
    })
    return { ok: true, ms: Math.round(performance.now() - start) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg.slice(0, 180) }
  }
}

export const anthropicAdapter: ProviderAdapter = {
  providerId: 'anthropic',
  displayName: 'Anthropic',
  docs: {
    keyHint: '在 Anthropic Console 创建 API Key',
    basePlaceholder: 'https://api.anthropic.com',
    docUrl: 'https://console.anthropic.com/settings/keys',
    docLabel: 'Anthropic Console'
  },
  defaultBaseUrl: 'https://api.anthropic.com',
  normalizeBaseUrl,
  settingsSpec: () => ({ extraFields: [] }),
  listModels: async (conn: ProviderConnection): Promise<ProviderModel[]> => {
    const base = normalizeBaseUrl(conn.baseUrl)
    const url = `${base}/v1/models`
    const json = await fetchJson<AnthropicModelsResponse>(url, {
      headers: {
        ...headers(conn.apiKey)
      }
    })
    const list = Array.isArray(json?.data) ? json.data : []
    return list
      .map((m) => ({
        modelId: String(m?.id ?? '').trim(),
        label: String(m?.display_name ?? m?.id ?? '').trim(),
        raw: m ?? null
      }))
      .filter((m) => Boolean(m.modelId))
  },
  probeInference,
  speedTest: probeInference
}
