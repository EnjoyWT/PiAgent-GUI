import { getModels, getProviders } from '@enjoywt/pi-ai'
import type { KnownProvider } from '@enjoywt/pi-ai'
import type { ProviderAdapter } from './types.ts'
import { anthropicAdapter } from './adapters/anthropic.ts'
import { createBuiltInProviderAdapter, type DefaultProviderDefinition } from './adapters/builtin.ts'
import { customProviderAdapter } from './adapters/custom-provider.ts'
import { geminiAdapter } from './adapters/gemini.ts'
import { openaiAdapter } from './adapters/openai.ts'
import { qwenAdapter } from './adapters/qwen.ts'
import { getProviderDefaultBaseUrlOverride } from './xiaomi.ts'

const displayNames: Record<string, string> = {
  'amazon-bedrock': 'Amazon Bedrock',
  anthropic: 'Anthropic',
  'azure-openai-responses': 'Azure OpenAI',
  cerebras: 'Cerebras',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  deepseek: 'DeepSeek',
  fireworks: 'Fireworks',
  'github-copilot': 'GitHub Copilot',
  google: 'Google Gemini',
  'google-vertex': 'Google Vertex AI',
  groq: 'Groq',
  huggingface: 'Hugging Face',
  'kimi-coding': 'Kimi Coding',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax CN',
  mistral: 'Mistral',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI CN',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go',
  openrouter: 'OpenRouter',
  qwen: 'Qwen',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  xai: 'xAI',
  xiaomi: 'Xiaomi MiMo',
  zai: 'Z.ai'
}

const docUrls: Record<string, string> = {
  'amazon-bedrock': 'https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started.html',
  anthropic: 'https://console.anthropic.com/settings/keys',
  'azure-openai-responses': 'https://learn.microsoft.com/azure/ai-services/openai/',
  cerebras: 'https://cloud.cerebras.ai/platform/',
  'cloudflare-ai-gateway': 'https://developers.cloudflare.com/ai-gateway/',
  'cloudflare-workers-ai': 'https://developers.cloudflare.com/workers-ai/',
  deepseek: 'https://platform.deepseek.com/api_keys',
  fireworks: 'https://fireworks.ai/account/api-keys',
  'github-copilot': 'https://github.com/features/copilot',
  google: 'https://aistudio.google.com/apikey',
  'google-vertex': 'https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts',
  groq: 'https://console.groq.com/keys',
  huggingface: 'https://huggingface.co/settings/tokens',
  'kimi-coding': 'https://platform.moonshot.ai/console/api-keys',
  minimax: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  'minimax-cn': 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  mistral: 'https://console.mistral.ai/api-keys',
  moonshotai: 'https://platform.moonshot.ai/console/api-keys',
  'moonshotai-cn': 'https://platform.moonshot.cn/console/api-keys',
  openai: 'https://platform.openai.com/api-keys',
  'openai-codex': 'https://chatgpt.com/',
  opencode: 'https://opencode.ai/',
  'opencode-go': 'https://opencode.ai/',
  openrouter: 'https://openrouter.ai/settings/keys',
  qwen: 'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope',
  'vercel-ai-gateway': 'https://vercel.com/docs/ai-gateway',
  xai: 'https://console.x.ai/',
  xiaomi: 'https://platform.mimov2.cn/',
  zai: 'https://z.ai/'
}

const defaultSettings: Record<string, Record<string, unknown>> = {
  deepseek: {
    supportsDeveloperRole: false
  },
  qwen: {
    apiFormat: 'chat_completions',
    maxTokensField: 'max_tokens',
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    thinkingFormat: 'qwen'
  }
}

const extraFieldsByProvider: Record<string, DefaultProviderDefinition['extraFields']> = {
  'azure-openai-responses': [
    {
      key: 'azureResourceName',
      label: 'Azure Resource Name',
      type: 'text',
      placeholder: 'my-openai-resource',
      helpText: '填写后会生成 Azure OpenAI Base URL；也可以直接填写 Base URL'
    },
    {
      key: 'azureApiVersion',
      label: 'Azure API Version',
      type: 'text',
      placeholder: 'v1',
      helpText: '留空使用底层默认 v1'
    },
    {
      key: 'azureDeploymentName',
      label: 'Deployment Name',
      type: 'text',
      placeholder: '默认使用模型 ID',
      helpText: '当 Azure deployment 名称和模型 ID 不一致时填写'
    }
  ],
  'amazon-bedrock': [
    {
      key: 'region',
      label: 'AWS Region',
      type: 'text',
      placeholder: 'us-east-1',
      helpText: '留空使用 AWS_REGION、AWS_DEFAULT_REGION 或 AWS profile'
    },
    {
      key: 'profile',
      label: 'AWS Profile',
      type: 'text',
      placeholder: 'default',
      helpText: '留空使用默认 AWS credential chain'
    }
  ],
  'google-vertex': [
    {
      key: 'project',
      label: 'Project ID',
      type: 'text',
      placeholder: 'my-gcp-project',
      helpText: '使用 API Key 时可留空；使用 ADC 时需要'
    },
    {
      key: 'location',
      label: 'Location',
      type: 'text',
      placeholder: 'us-central1',
      helpText: '例如 us-central1、asia-northeast1'
    }
  ],
  'cloudflare-ai-gateway': [
    {
      key: 'cloudflareAccountId',
      label: 'Account ID',
      type: 'text',
      placeholder: 'Cloudflare Account ID',
      required: true
    },
    {
      key: 'cloudflareGatewayId',
      label: 'Gateway ID',
      type: 'text',
      placeholder: 'AI Gateway ID',
      required: true
    },
    {
      key: 'cloudflareBackend',
      label: 'Backend',
      type: 'select',
      options: [
        { value: 'anthropic', label: 'Anthropic passthrough' },
        { value: 'openai', label: 'OpenAI passthrough' },
        { value: 'compat', label: 'OpenAI compatible' }
      ],
      helpText: '模型自带的底层 API 会决定实际后端；此项用于配置默认 Base URL'
    }
  ],
  'cloudflare-workers-ai': [
    {
      key: 'cloudflareAccountId',
      label: 'Account ID',
      type: 'text',
      placeholder: 'Cloudflare Account ID',
      required: true
    }
  ]
}

const firstModelBaseUrl = (providerId: string): string => {
  if (providerId === 'qwen') return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  const override = getProviderDefaultBaseUrlOverride(providerId)
  if (override) return override
  try {
    return String(getModels(providerId as KnownProvider)[0]?.baseUrl ?? '').trim()
  } catch {
    return ''
  }
}

export const listDefaultProviderDefinitions = (): DefaultProviderDefinition[] =>
  Array.from(new Set([...getProviders(), 'qwen'])).map((providerId) => ({
    id: providerId,
    displayName: displayNames[providerId] ?? providerId,
    runtimeProvider: providerId,
    enabledByDefault: providerId === 'google',
    defaultBaseUrl: firstModelBaseUrl(providerId),
    settings: defaultSettings[providerId] ?? {},
    docs: {
      keyHint: `填写 ${displayNames[providerId] ?? providerId} 凭证`,
      basePlaceholder: firstModelBaseUrl(providerId),
      docUrl: docUrls[providerId] ?? '#',
      docLabel: '打开供应商文档'
    },
    extraFields: extraFieldsByProvider[providerId]
  }))

export const getDefaultProviderDefinition = (
  providerId: string
): DefaultProviderDefinition | null =>
  listDefaultProviderDefinitions().find((provider) => provider.id === providerId) ?? null

const builtInAdapters = listDefaultProviderDefinitions().map(createBuiltInProviderAdapter)

const explicitAdapters: ProviderAdapter[] = [
  geminiAdapter,
  anthropicAdapter,
  openaiAdapter,
  qwenAdapter
]

const adapters: ProviderAdapter[] = [
  ...explicitAdapters,
  ...builtInAdapters.filter(
    (adapter) => !explicitAdapters.some((explicit) => explicit.providerId === adapter.providerId)
  )
]

const byId = new Map(adapters.map((adapter) => [adapter.providerId, adapter]))

export const listProviderAdapters = (): ProviderAdapter[] => adapters.slice()

export const getProviderAdapter = (providerId: string): ProviderAdapter | null => {
  if (providerId?.startsWith('custom_')) return customProviderAdapter
  return byId.get(providerId) ?? null
}
