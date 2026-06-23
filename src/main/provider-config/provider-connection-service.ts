import { getProvider, getProviderApiKey, type ProviderInfo } from '../db/config-db.ts'
import { getProviderAdapter } from '../../shared/providers/registry.ts'
import type { ProviderAdapter, ProviderConnection } from '../../shared/providers/types.ts'
import { parseProviderSettings } from '../../shared/provider-settings.ts'

type ProviderConnectionOverrides = {
  apiKey?: string | null
  baseUrl?: string | null
  settings?: Record<string, unknown> | null
}

export type ResolvedProviderConnection = {
  provider: ProviderInfo
  adapter: ProviderAdapter
  connection: ProviderConnection
}

export const resolveProviderConnection = (
  providerId: string,
  overrides: ProviderConnectionOverrides = {}
): ResolvedProviderConnection => {
  const provider = getProvider(providerId)
  if (!provider) throw new Error(`Unknown provider: ${providerId}`)

  const adapter = getProviderAdapter(provider.id)
  if (!adapter) throw new Error(`No adapter registered for provider: ${provider.id}`)

  const settings = parseProviderSettings(overrides.settings ?? provider.settingsJson)
  const baseUrl = adapter.normalizeBaseUrl(
    overrides.baseUrl ?? provider.baseUrl ?? adapter.defaultBaseUrl
  )
  const apiKey = String(overrides.apiKey ?? getProviderApiKey(provider.id) ?? '').trim()

  return {
    provider,
    adapter,
    connection: {
      providerId: provider.id,
      apiKey,
      baseUrl,
      settings
    }
  }
}
