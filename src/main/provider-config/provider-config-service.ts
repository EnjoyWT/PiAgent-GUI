import type {
  FetchProviderModelsInput,
  FetchProviderModelsResult,
  ProviderConfigDetail,
  ProviderConfigModel,
  ProviderConfigSummary,
  ProviderValidationResult,
  SetProviderModelEnabledInput,
  SetupProviderApiKeyInput,
  SetupProviderApiKeyResult,
  UpsertProviderConfigInput,
  ValidateProviderConfigInput
} from '../../shared/provider-config'
import type { ProviderModel } from '../../shared/providers/types.ts'
import {
  clearProviderApiKey,
  deleteProvider,
  getProviderApiKey,
  listProviderModels,
  listProviders,
  replaceProviderModels,
  setProviderApiKey,
  setProviderModelEnabled,
  upsertProvider
} from '../db/config-db.ts'
import { parseProviderSettings } from '../../shared/provider-settings.ts'
import { resolveProviderConnection } from './provider-connection-service.ts'
import {
  probeProviderValidation,
  validateProviderConnection
} from './provider-validation-service.ts'
import { invalidateProviderRuntime } from './provider-runtime-refresh.ts'

const parseCapabilities = (value: string | null): ProviderConfigModel['capabilities'] => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const mapStoredModels = (providerId: string): ProviderConfigModel[] =>
  listProviderModels(providerId).map((model) => ({
    providerId: model.providerId,
    modelId: model.modelId,
    label: model.label,
    contextWindowTokens: model.contextWindowTokens,
    capabilities: parseCapabilities(model.capabilitiesJson),
    enabled: model.enabled,
    rawJson: model.rawJson,
    updatedAt: model.updatedAt
  }))

const persistProviderModels = (
  providerId: string,
  models: ProviderModel[]
): ProviderConfigModel[] => {
  replaceProviderModels(
    providerId,
    models.map((model) => ({
      modelId: model.modelId,
      label: model.label,
      contextWindowTokens: model.contextWindowTokens ?? null,
      capabilitiesJson: model.capabilities ? JSON.stringify(model.capabilities) : null,
      rawJson: model.raw ? JSON.stringify(model.raw) : null
    })),
    false
  )
  return mapStoredModels(providerId)
}

const mapProviderSummary = (providerId: string): ProviderConfigSummary => {
  const provider = listProviders().find((item) => item.id === providerId)
  if (!provider) throw new Error(`Unknown provider: ${providerId}`)
  const models = listProviderModels(providerId)
  return {
    id: provider.id,
    displayName: provider.displayName,
    runtimeProvider: provider.runtimeProvider,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl,
    settings: parseProviderSettings(provider.settingsJson),
    hasApiKey: Boolean(getProviderApiKey(providerId)?.trim()),
    modelCount: models.length
  }
}

export class ProviderConfigService {
  async listProviders(): Promise<ProviderConfigSummary[]> {
    return listProviders().map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      runtimeProvider: provider.runtimeProvider,
      enabled: provider.enabled,
      baseUrl: provider.baseUrl,
      settings: parseProviderSettings(provider.settingsJson),
      hasApiKey: Boolean(getProviderApiKey(provider.id)?.trim()),
      modelCount: listProviderModels(provider.id).length
    }))
  }

  async getProviderDetail(providerId: string): Promise<ProviderConfigDetail> {
    const summary = mapProviderSummary(providerId)
    return {
      ...summary,
      apiKey: getProviderApiKey(providerId),
      models: mapStoredModels(providerId)
    }
  }

  async upsertProvider(input: UpsertProviderConfigInput): Promise<ProviderConfigDetail> {
    upsertProvider({
      id: input.id,
      displayName: input.displayName,
      runtimeProvider: input.runtimeProvider,
      enabled: input.enabled,
      baseUrl: input.baseUrl ?? null,
      settingsJson: JSON.stringify(parseProviderSettings(input.settings ?? null))
    })
    await invalidateProviderRuntime(input.id)
    return await this.getProviderDetail(input.id)
  }

  async validate(input: ValidateProviderConfigInput): Promise<ProviderValidationResult> {
    return await validateProviderConnection(input)
  }

  async fetchModels(input: FetchProviderModelsInput): Promise<FetchProviderModelsResult> {
    const { adapter, connection } = resolveProviderConnection(input.providerId, {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      settings: input.settings
    })
    if (!connection.apiKey.trim()) throw new Error('请输入 API Key')
    const models = await adapter.listModels(connection)
    const storedModels = persistProviderModels(input.providerId, models)
    await invalidateProviderRuntime(input.providerId)
    return {
      providerId: input.providerId,
      models: storedModels,
      modelCount: storedModels.length
    }
  }

  async setupApiKey(input: SetupProviderApiKeyInput): Promise<SetupProviderApiKeyResult> {
    const { validation, models } = await probeProviderValidation({
      providerId: input.providerId,
      modelId: input.modelId,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      settings: input.settings
    })

    if (!validation.ok) {
      return {
        providerId: input.providerId,
        saved: false,
        validation,
        models: [],
        modelCount: 0
      }
    }

    upsertProvider({
      id: input.providerId,
      displayName: mapProviderSummary(input.providerId).displayName,
      runtimeProvider: mapProviderSummary(input.providerId).runtimeProvider,
      enabled: mapProviderSummary(input.providerId).enabled,
      baseUrl: input.baseUrl ?? mapProviderSummary(input.providerId).baseUrl,
      settingsJson: JSON.stringify(
        parseProviderSettings(input.settings ?? mapProviderSummary(input.providerId).settings)
      )
    })
    setProviderApiKey(input.providerId, input.apiKey.trim())
    const storedModels = persistProviderModels(input.providerId, models)
    await invalidateProviderRuntime(input.providerId)
    return {
      providerId: input.providerId,
      saved: true,
      validation,
      models: storedModels,
      modelCount: storedModels.length
    }
  }

  async clearApiKey(providerId: string): Promise<ProviderConfigDetail> {
    clearProviderApiKey(providerId)
    await invalidateProviderRuntime(providerId)
    return await this.getProviderDetail(providerId)
  }

  async setModelEnabled(input: SetProviderModelEnabledInput): Promise<ProviderConfigDetail> {
    setProviderModelEnabled(input.providerId, input.modelId, input.enabled)
    await invalidateProviderRuntime(input.providerId)
    return await this.getProviderDetail(input.providerId)
  }

  async deleteProvider(providerId: string): Promise<{ success: true }> {
    deleteProvider(providerId)
    await invalidateProviderRuntime(providerId)
    return { success: true }
  }
}

let providerConfigServiceSingleton: ProviderConfigService | null = null

export const getProviderConfigService = (): ProviderConfigService => {
  if (providerConfigServiceSingleton) return providerConfigServiceSingleton
  providerConfigServiceSingleton = new ProviderConfigService()
  return providerConfigServiceSingleton
}
