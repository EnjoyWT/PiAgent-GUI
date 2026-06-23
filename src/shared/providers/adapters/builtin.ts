import { completeSimple, getModels } from '@enjoywt/pi-ai'
import type { Api, KnownProvider, Model } from '@enjoywt/pi-ai'
import type {
  ProviderAdapter,
  ProviderCapabilitySet,
  ProviderConnection,
  ProviderDocs,
  ProviderModel,
  ProviderSettingsField,
  ProviderSettingsSpec
} from '../types.ts'
import {
  getProviderDefaultBaseUrlOverride,
  normalizeBuiltInProviderModelBaseUrl,
  normalizeXiaomiConfiguredBaseUrlForModel
} from '../xiaomi.ts'

export type DefaultProviderDefinition = {
  id: string
  displayName: string
  runtimeProvider: string
  enabledByDefault: boolean
  defaultBaseUrl: string
  settings: Record<string, unknown>
  docs: ProviderDocs
  extraFields?: ProviderSettingsField[]
}

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const modelCapabilities = (model: Model<Api>): ProviderCapabilitySet => {
  const thinkingLevels = Object.entries(model.thinkingLevelMap ?? {})
    .filter(([, value]) => value !== null)
    .map(([key]) => key)

  return {
    imageInput: Array.isArray(model.input) && model.input.includes('image'),
    reasoning: Boolean(model.reasoning),
    ...(thinkingLevels.length > 0 ? { thinkingLevels } : {})
  }
}

const toProviderModel = (model: Model<Api>): ProviderModel => ({
  modelId: model.id,
  label: model.name || model.id,
  contextWindowTokens: model.contextWindow ?? null,
  capabilities: modelCapabilities(model),
  raw: model
})

export const resolveProviderModelBaseUrl = (
  providerId: string,
  configuredBaseUrl: string | null | undefined,
  settings: Record<string, unknown>,
  modelBaseUrl: string | null | undefined,
  fallbackBaseUrl: string
): string => {
  const providerOverride = getProviderDefaultBaseUrlOverride(providerId)
  const normalizedConfiguredBaseUrl = normalizeXiaomiConfiguredBaseUrlForModel(
    providerId,
    asString(configuredBaseUrl),
    asString(modelBaseUrl) || providerOverride || fallbackBaseUrl
  )
  let baseUrl =
    normalizedConfiguredBaseUrl || providerOverride || asString(modelBaseUrl) || fallbackBaseUrl
  if (!baseUrl && providerId === 'azure-openai-responses') {
    const resourceName = asString(settings.azureResourceName)
    if (resourceName) baseUrl = `https://${resourceName}.openai.azure.com/openai/v1`
  }
  if (!baseUrl) return ''

  if (providerId === 'google-vertex') {
    const location = asString(settings.location)
    if (location) baseUrl = baseUrl.replace(/\{location\}/g, location)
  }

  if (providerId === 'cloudflare-ai-gateway' || providerId === 'cloudflare-workers-ai') {
    const accountId = asString(settings.cloudflareAccountId)
    const gatewayId = asString(settings.cloudflareGatewayId)
    if (accountId) baseUrl = baseUrl.replace(/\{CLOUDFLARE_ACCOUNT_ID\}/g, accountId)
    if (gatewayId) baseUrl = baseUrl.replace(/\{CLOUDFLARE_GATEWAY_ID\}/g, gatewayId)
  }

  return baseUrl.replace(/\/+$/g, '')
}

export const createBuiltInProviderAdapter = (
  definition: DefaultProviderDefinition
): ProviderAdapter => {
  const settingsSpec = (): ProviderSettingsSpec => ({
    extraFields: definition.extraFields ?? []
  })

  const getProviderModels = (): Model<Api>[] =>
    (getModels(definition.runtimeProvider as KnownProvider) as Model<Api>[]).map((model) =>
      normalizeBuiltInProviderModelBaseUrl(definition.id, model)
    )

  const normalizeBaseUrl = (baseUrl?: string | null): string =>
    resolveProviderModelBaseUrl(
      definition.id,
      baseUrl,
      definition.settings,
      null,
      definition.defaultBaseUrl
    )

  const probeInference = async (
    conn: ProviderConnection,
    modelId: string
  ): Promise<{ ok: true; ms: number } | { ok: false; error: string }> => {
    const model = getProviderModels().find((item) => item.id === modelId) ?? getProviderModels()[0]
    if (!model) return { ok: false, error: '未找到可用模型' }

    const start = performance.now()
    try {
      const requestModel = {
        ...model,
        baseUrl: resolveProviderModelBaseUrl(
          definition.id,
          conn.baseUrl,
          conn.settings,
          model.baseUrl,
          definition.defaultBaseUrl
        )
      } as Model<Api>

      await completeSimple(
        requestModel,
        { messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }] },
        {
          apiKey: conn.apiKey,
          maxTokens: 1,
          azureApiVersion: asString(conn.settings.azureApiVersion) || undefined,
          azureBaseUrl: definition.id === 'azure-openai-responses' ? requestModel.baseUrl : undefined,
          azureDeploymentName: asString(conn.settings.azureDeploymentName) || undefined,
          azureResourceName: asString(conn.settings.azureResourceName) || undefined,
          region: asString(conn.settings.region) || undefined,
          profile: asString(conn.settings.profile) || undefined,
          project: asString(conn.settings.project) || undefined,
          location: asString(conn.settings.location) || undefined
        } as any
      )
      return { ok: true, ms: Math.round(performance.now() - start) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message.slice(0, 180) }
    }
  }

  return {
    providerId: definition.id,
    displayName: definition.displayName,
    docs: definition.docs,
    defaultBaseUrl: definition.defaultBaseUrl,
    normalizeBaseUrl,
    settingsSpec,
    listModels: async (): Promise<ProviderModel[]> => getProviderModels().map(toProviderModel),
    probeInference,
    speedTest: probeInference
  }
}
