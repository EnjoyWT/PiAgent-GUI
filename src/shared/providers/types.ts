export type ProviderDocs = {
  keyHint: string
  basePlaceholder: string
  docUrl: string
  docLabel?: string
}

export type ProviderCapabilitySet = {
  imageInput?: boolean
  imageOutput?: boolean
  tools?: boolean
  reasoning?: boolean
  thinkingLevels?: string[]
}

export type ProviderModel = {
  modelId: string
  label: string
  contextWindowTokens?: number | null
  capabilities?: ProviderCapabilitySet
  raw?: unknown
}

export type ProviderSettingsField =
  | {
      key: string
      label: string
      type: 'text'
      placeholder?: string
      helpText?: string
      required?: boolean
    }
  | {
      key: string
      label: string
      type: 'password'
      placeholder?: string
      helpText?: string
      required?: boolean
    }
  | {
      key: string
      label: string
      type: 'switch'
      helpText?: string
      required?: boolean
    }
  | {
      key: string
      label: string
      type: 'select'
      options: { value: string; label: string }[]
      helpText?: string
      required?: boolean
    }

export type ProviderSettingsSpec = {
  extraFields: ProviderSettingsField[]
}

export type ProviderConnection = {
  providerId: string
  apiKey: string
  baseUrl: string
  settings: Record<string, unknown>
}

export type ProviderProbeResult = { ok: true; ms: number } | { ok: false; error: string }

export type ProviderAdapter = {
  providerId: string
  displayName: string
  docs: ProviderDocs
  defaultBaseUrl: string
  normalizeBaseUrl: (baseUrl?: string | null) => string
  settingsSpec: () => ProviderSettingsSpec
  listModels: (conn: ProviderConnection) => Promise<ProviderModel[]>
  probeInference: (conn: ProviderConnection, modelId: string) => Promise<ProviderProbeResult>
  speedTest: (conn: ProviderConnection, modelId: string) => Promise<ProviderProbeResult>
}
