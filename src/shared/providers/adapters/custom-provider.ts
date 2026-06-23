import type {
  ProviderAdapter,
  ProviderConnection,
  ProviderModel,
  ProviderProbeResult
} from '../types'
import { fetchJson } from '../http.ts'
import { normalizeProviderSettings } from '../../provider-settings.ts'
import { extractContextWindowTokens, resolveOpenAICompatibleCapabilities } from './openai-compatible.ts'

type CustomApiFormat = 'chat_completions' | 'responses' | 'anthropic_messages'

const normalizeBaseUrl = (baseUrl?: string | null) => {
  const raw = (baseUrl ?? '').trim()
  return raw.replace(/\/+$/g, '')
}

const bearer = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`
})

const resolveFormat = (conn: ProviderConnection): CustomApiFormat => {
  const raw = String((conn.settings as any)?.apiFormat ?? 'chat_completions')
  if (raw === 'responses') return 'responses'
  if (raw === 'anthropic_messages') return 'anthropic_messages'
  return 'chat_completions'
}

const resolveAnthropicMessagesUrl = (baseUrl: string) => {
  if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/messages`
  return `${baseUrl}/v1/messages`
}

const resolveModelsUrl = (baseUrl: string, format: CustomApiFormat) => {
  if (format === 'anthropic_messages') {
    if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/models`
    return `${baseUrl}/v1/models`
  }
  return `${baseUrl}/models`
}

const probeInference = async (
  conn: ProviderConnection,
  modelId: string
): Promise<ProviderProbeResult> => {
  const apiKey = (conn.apiKey ?? '').trim()
  if (!apiKey) return { ok: false, error: '请输入 API Key' }
  const base = normalizeBaseUrl(conn.baseUrl)
  if (!base) return { ok: false, error: '请输入 Base URL' }

  const format = resolveFormat(conn)
  const start = performance.now()

  try {
    if (format === 'responses') {
      await fetchJson(`${base}/responses`, {
        method: 'POST',
        headers: {
          ...bearer(apiKey),
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: modelId,
          input: 'ping',
          max_output_tokens: 1
        })
      })
    } else if (format === 'anthropic_messages') {
      await fetchJson(resolveAnthropicMessagesUrl(base), {
        method: 'POST',
        headers: {
          ...bearer(apiKey),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        })
      })
    } else {
      const settings = normalizeProviderSettings({
        providerId: conn.providerId,
        settings: conn.settings
      })
      await fetchJson(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          ...bearer(apiKey),
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'ping' }],
          [settings.maxTokensField]: 1,
          ...(settings.thinkingFormat === 'qwen' ? { enable_thinking: false } : {})
        })
      })
    }

    return { ok: true, ms: Math.round(performance.now() - start) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg.slice(0, 180) }
  }
}

export const customProviderAdapter: ProviderAdapter = {
  providerId: 'custom',
  displayName: 'Custom Provider',
  docs: {
    keyHint: '填写你的网关/代理 API Key（通常是 Bearer Token）',
    basePlaceholder: 'https://api.example.com/v1',
    docUrl: '#',
    docLabel: 'Custom Provider'
  },
  defaultBaseUrl: '',
  normalizeBaseUrl,
  settingsSpec: () => ({
    extraFields: [
      {
        key: 'apiFormat',
        label: 'API Format',
        type: 'select',
        options: [
          { value: 'chat_completions', label: 'Chat Completions (/chat/completions)' },
          { value: 'responses', label: 'Responses (/responses)' },
          { value: 'anthropic_messages', label: 'Anthropic Messages (/v1/messages)' }
        ],
        helpText: '选择你的供应商/网关使用的请求格式。'
      },
      {
        key: 'useMaxCompletionTokens',
        label: 'Use max_completion_tokens',
        type: 'switch',
        helpText: '部分新 OpenAI 模型需要 max_completion_tokens（仅 Chat Completions 时生效）。'
      },
      {
        key: 'supportsDeveloperRole',
        label: 'Supports developer role',
        type: 'switch',
        helpText:
          '关闭后会把 system prompt 作为 system 消息发送，适用于不兼容 developer role 的 OpenAI 兼容网关。'
      },
      {
        key: 'supportsReasoningEffort',
        label: 'Supports reasoning_effort',
        type: 'switch',
        helpText: '关闭后不发送 reasoning_effort，适用于不兼容该字段的兼容网关。'
      },
      {
        key: 'thinkingFormat',
        label: 'Thinking Format',
        type: 'select',
        options: [
          { value: 'openai', label: 'OpenAI (reasoning_effort)' },
          { value: 'zai', label: 'Z.AI (thinking)' },
          { value: 'qwen', label: 'Qwen (enable_thinking)' }
        ],
        helpText: '按供应商协议发送思考参数。'
      }
    ]
  }),
  listModels: async (conn: ProviderConnection): Promise<ProviderModel[]> => {
    const base = normalizeBaseUrl(conn.baseUrl)
    if (!base) return []
    const format = resolveFormat(conn)
    const url = resolveModelsUrl(base, format)
    const apiKey = (conn.apiKey ?? '').trim()
    const json = await fetchJson<any>(url, {
      headers: {
        ...bearer(apiKey)
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

    const models = Array.isArray(json?.models) ? json.models : null
    if (models) {
      return models
        .map((x: any) => {
          const mId = String(x?.id ?? x?.name ?? '')
            .replace(/^models\//, '')
            .trim()
          return {
            modelId: mId,
            label: String(x?.displayName ?? x?.name ?? x?.id ?? '')
              .replace(/^models\//, '')
              .trim(),
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
  },
  probeInference,
  speedTest: probeInference
}
