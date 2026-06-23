import type { ProviderCapabilitySet } from './providers/types'

export type ProviderConfigModel = {
  providerId: string
  modelId: string
  label: string
  contextWindowTokens: number | null
  capabilities: ProviderCapabilitySet | null
  enabled: boolean
  rawJson: string | null
  updatedAt: string
}

export type ProviderConfigSummary = {
  id: string
  displayName: string
  runtimeProvider: string
  enabled: boolean
  baseUrl: string | null
  settings: Record<string, unknown>
  hasApiKey: boolean
  modelCount: number
}

export type ProviderConfigDetail = ProviderConfigSummary & {
  apiKey: string | null
  models: ProviderConfigModel[]
}

export type UpsertProviderConfigInput = {
  id: string
  displayName: string
  runtimeProvider: string
  enabled?: boolean
  baseUrl?: string | null
  settings?: Record<string, unknown> | null
}

export type ValidateProviderConfigInput = {
  providerId: string
  modelId?: string | null
  apiKey?: string | null
  baseUrl?: string | null
  settings?: Record<string, unknown> | null
}

export type ProviderValidationResult =
  | {
      ok: true
      providerId: string
      modelId: string | null
      message: string
      ms: number | null
      checkedAt: string
      discoveredModelCount: number
    }
  | {
      ok: false
      providerId: string
      modelId: string | null
      message: string
      ms: null
      checkedAt: string
      discoveredModelCount: number
      errorCode:
        | 'missing_provider'
        | 'missing_adapter'
        | 'missing_api_key'
        | 'list_models_failed'
        | 'probe_failed'
    }

export type FetchProviderModelsInput = {
  providerId: string
  apiKey?: string | null
  baseUrl?: string | null
  settings?: Record<string, unknown> | null
}

export type FetchProviderModelsResult = {
  providerId: string
  models: ProviderConfigModel[]
  modelCount: number
}

export type SetupProviderApiKeyInput = {
  providerId: string
  apiKey: string
  modelId?: string | null
  baseUrl?: string | null
  settings?: Record<string, unknown> | null
}

export type SetupProviderApiKeyResult = {
  providerId: string
  saved: boolean
  validation: ProviderValidationResult
  models: ProviderConfigModel[]
  modelCount: number
}

export type SetProviderModelEnabledInput = {
  providerId: string
  modelId: string
  enabled: boolean
}
