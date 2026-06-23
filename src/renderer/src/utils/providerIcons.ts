export type ProviderIconKey =
  | 'amazon-bedrock'
  | 'openai'
  | 'azure-openai'
  | 'anthropic'
  | 'google'
  | 'vertex-ai'
  | 'xai'
  | 'deepseek'
  | 'moonshot'
  | 'qwen'
  | 'baichuan'
  | 'minimax'
  | 'mistral'
  | 'cohere'
  | 'perplexity'
  | 'anyrouter'
  | 'openrouter'
  | 'together'
  | 'fireworks'
  | 'replicate'
  | 'groq'
  | 'cerebras'
  | 'cloudflare'
  | 'github-copilot'
  | 'huggingface'
  | 'opencode'
  | 'vercel'
  | 'xiaomi'
  | 'zai'

const iconUrls: Record<ProviderIconKey, string> = {
  'amazon-bedrock': new URL('../assets/provider-icons/amazon-bedrock.svg', import.meta.url).href,
  openai: new URL('../assets/provider-icons/openai.svg', import.meta.url).href,
  'azure-openai': new URL('../assets/provider-icons/azure-openai.svg', import.meta.url).href,
  anthropic: new URL('../assets/provider-icons/anthropic.svg', import.meta.url).href,
  google: new URL('../assets/provider-icons/gemini.svg', import.meta.url).href,
  'vertex-ai': new URL('../assets/provider-icons/vertex-ai.svg', import.meta.url).href,
  xai: new URL('../assets/provider-icons/xai.svg', import.meta.url).href,
  deepseek: new URL('../assets/provider-icons/deepseek.svg', import.meta.url).href,
  moonshot: new URL('../assets/provider-icons/moonshot.svg', import.meta.url).href,
  qwen: new URL('../assets/provider-icons/qwen.svg', import.meta.url).href,
  baichuan: new URL('../assets/provider-icons/baichuan.svg', import.meta.url).href,
  minimax: new URL('../assets/provider-icons/minimax.svg', import.meta.url).href,
  mistral: new URL('../assets/provider-icons/mistral.svg', import.meta.url).href,
  cohere: new URL('../assets/provider-icons/cohere.svg', import.meta.url).href,
  perplexity: new URL('../assets/provider-icons/perplexity.svg', import.meta.url).href,
  anyrouter: new URL('../assets/provider-icons/anyrouter.svg', import.meta.url).href,
  openrouter: new URL('../assets/provider-icons/openrouter.svg', import.meta.url).href,
  together: new URL('../assets/provider-icons/together.svg', import.meta.url).href,
  fireworks: new URL('../assets/provider-icons/fireworks.svg', import.meta.url).href,
  replicate: new URL('../assets/provider-icons/replicate.svg', import.meta.url).href,
  groq: new URL('../assets/provider-icons/groq.svg', import.meta.url).href,
  cerebras: new URL('../assets/provider-icons/cerebras.svg', import.meta.url).href,
  cloudflare: new URL('../assets/provider-icons/cloudflare.svg', import.meta.url).href,
  'github-copilot': new URL('../assets/provider-icons/github-copilot.svg', import.meta.url).href,
  huggingface: new URL('../assets/provider-icons/huggingface.svg', import.meta.url).href,
  opencode: new URL('../assets/provider-icons/opencode.svg', import.meta.url).href,
  vercel: new URL('../assets/provider-icons/vercel.svg', import.meta.url).href,
  xiaomi: new URL('../assets/provider-icons/xiaomi.svg', import.meta.url).href,
  zai: new URL('../assets/provider-icons/zai.svg', import.meta.url).href
}

const compactLower = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

const aliasToKey: Record<string, ProviderIconKey> = {
  // AWS
  amazonbedrock: 'amazon-bedrock',
  bedrock: 'amazon-bedrock',
  // OpenAI family
  openai: 'openai',
  openaicodex: 'openai',
  codex: 'openai',
  // Azure
  azureopenai: 'azure-openai',
  azureopenairesponses: 'azure-openai',
  // Anthropic
  anthropic: 'anthropic',
  // Google / Gemini
  google: 'google',
  googlegemini: 'google',
  gemini: 'google',
  googlecloud: 'vertex-ai',
  googlevertex: 'vertex-ai',
  googlevertexai: 'vertex-ai',
  vertexai: 'vertex-ai',
  // xAI
  xai: 'xai',
  // China providers
  deepseek: 'deepseek',
  moonshot: 'moonshot',
  moonshotai: 'moonshot',
  moonshotaicn: 'moonshot',
  kimicoding: 'moonshot',
  qwen: 'qwen',
  shqwen: 'qwen',
  tongyiqianwen: 'qwen',
  baichuan: 'baichuan',
  minimax: 'minimax',
  minimaxcn: 'minimax',
  xiaomi: 'xiaomi',
  xiaomimimo: 'xiaomi',
  zai: 'zai',
  zhipu: 'zai',
  zhipuai: 'zai',
  // Others
  mistral: 'mistral',
  cohere: 'cohere',
  perplexity: 'perplexity',
  anyrouter: 'anyrouter',
  openrouter: 'openrouter',
  together: 'together',
  togetherai: 'together',
  fireworks: 'fireworks',
  fireworksai: 'fireworks',
  replicate: 'replicate',
  groq: 'groq',
  cerebras: 'cerebras',
  cloudflare: 'cloudflare',
  cloudflareaigateway: 'cloudflare',
  cloudflareworkersai: 'cloudflare',
  githubcopilot: 'github-copilot',
  huggingface: 'huggingface',
  opencode: 'opencode',
  opencodego: 'opencode',
  vercel: 'vercel',
  vercelaigateway: 'vercel'
}

export const getProviderIconKey = (providerName?: string | null): ProviderIconKey | null => {
  if (!providerName) return null
  const compact = compactLower(providerName.trim())
  return aliasToKey[compact] ?? null
}

export const getProviderIconUrl = (providerName?: string | null): string | null => {
  const key = getProviderIconKey(providerName)
  return key ? iconUrls[key] : null
}
