import type {
  ProviderAdapter,
  ProviderConnection,
  ProviderModel,
  ProviderProbeResult
} from '../types'
import { fetchJson } from '../http.ts'
import {
  listOpenAICompatibleModels,
  normalizeOpenAICompatibleBaseUrl
} from './openai-compatible.ts'

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

const probeInference = async (
  conn: ProviderConnection,
  modelId: string
): Promise<ProviderProbeResult> => {
  const apiKey = (conn.apiKey ?? '').trim()
  if (!apiKey) return { ok: false, error: '请输入 API Key' }

  const base = normalizeOpenAICompatibleBaseUrl(conn.baseUrl, OPENAI_DEFAULT_BASE_URL)
  if (!base) return { ok: false, error: '请输入 Base URL' }

  const start = performance.now()
  try {
    await fetchJson(`${base}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: modelId,
        input: 'ping',
        max_output_tokens: 1
      })
    })
    return { ok: true, ms: Math.round(performance.now() - start) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg.slice(0, 180) }
  }
}

export const openaiAdapter: ProviderAdapter = {
  providerId: 'openai',
  displayName: 'OpenAI',
  docs: {
    keyHint: '在 OpenAI Platform 创建 API Key',
    basePlaceholder: OPENAI_DEFAULT_BASE_URL,
    docUrl: 'https://platform.openai.com/api-keys',
    docLabel: 'OpenAI Platform'
  },
  defaultBaseUrl: OPENAI_DEFAULT_BASE_URL,
  normalizeBaseUrl: (baseUrl?: string | null) =>
    normalizeOpenAICompatibleBaseUrl(baseUrl, OPENAI_DEFAULT_BASE_URL),
  settingsSpec: () => ({ extraFields: [] }),
  listModels: async (conn: ProviderConnection): Promise<ProviderModel[]> =>
    await listOpenAICompatibleModels(conn, {
      fallbackBaseUrl: OPENAI_DEFAULT_BASE_URL,
      runtimeProvider: 'openai'
    }),
  probeInference,
  speedTest: probeInference
}
