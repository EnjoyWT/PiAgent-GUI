import type {
  ProviderAdapter,
  ProviderConnection,
  ProviderModel,
  ProviderProbeResult
} from '../types'
import {
  listOpenAICompatibleModels,
  normalizeOpenAICompatibleBaseUrl,
  probeOpenAICompatibleChat
} from './openai-compatible.ts'

const QWEN_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

const inferQwenCapabilities = (modelId: string) => {
  const id = modelId.toLowerCase()

  if (/embedding/.test(id)) {
    return { imageInput: false, imageOutput: false, tools: false, reasoning: false }
  }

  const imageInput = /(vl|vision|ocr|qvq|omni)/.test(id)
  const reasoning =
    /^qwen3(?:\.5)?[-.]/.test(id) ||
    /^qwen3(?:\.5)?$/.test(id) ||
    /^qwq/.test(id) ||
    /^qvq/.test(id) ||
    /thinking/.test(id)

  return {
    imageInput,
    imageOutput: false,
    tools: !/audio|video|livetranslate/.test(id),
    reasoning
  }
}

const mapQwenModel = (model: ProviderModel): ProviderModel => ({
  ...model,
  capabilities: {
    ...inferQwenCapabilities(model.modelId),
    ...(model.capabilities ?? {})
  }
})

const probeInference = async (
  conn: ProviderConnection,
  modelId: string
): Promise<ProviderProbeResult> =>
  await probeOpenAICompatibleChat(conn, modelId, {
    fallbackBaseUrl: QWEN_DEFAULT_BASE_URL,
    runtimeProvider: 'qwen'
  })

export const qwenAdapter: ProviderAdapter = {
  providerId: 'qwen',
  displayName: 'Qwen',
  docs: {
    keyHint: '填写阿里云 Model Studio / DashScope API Key（按区域区分）',
    basePlaceholder: QWEN_DEFAULT_BASE_URL,
    docUrl:
      'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope',
    docLabel: 'Model Studio OpenAI Compatible'
  },
  defaultBaseUrl: QWEN_DEFAULT_BASE_URL,
  normalizeBaseUrl: (baseUrl?: string | null) =>
    normalizeOpenAICompatibleBaseUrl(baseUrl, QWEN_DEFAULT_BASE_URL),
  settingsSpec: () => ({ extraFields: [] }),
  listModels: async (conn: ProviderConnection): Promise<ProviderModel[]> =>
    (
      await listOpenAICompatibleModels(conn, {
        fallbackBaseUrl: QWEN_DEFAULT_BASE_URL,
        runtimeProvider: 'qwen'
      })
    ).map(mapQwenModel),
  probeInference,
  speedTest: probeInference
}
