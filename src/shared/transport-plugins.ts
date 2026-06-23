export type TransportPluginSettingsFieldType = 'text' | 'secret' | 'select' | 'boolean' | 'number'

export type TransportPluginSettingsFieldOption = {
  value: string
  label: string
}

export type TransportPluginSettingsFieldDefaultValue = string | number | boolean | null

export type TransportPluginSettingsField = {
  key: string
  type: TransportPluginSettingsFieldType
  label: string
  description?: string
  required?: boolean
  placeholder?: string
  defaultValue?: TransportPluginSettingsFieldDefaultValue
  options?: TransportPluginSettingsFieldOption[]
}

export type TransportPluginAccountSetupMethodKind = 'form' | 'qr' | 'redirect' | 'cli_import'

export type TransportPluginAccountSetupMethod = {
  id: string
  kind: TransportPluginAccountSetupMethodKind
  label: string
  description?: string
  recommended?: boolean
  outputConfigKeys?: string[]
  outputSecretKeys?: string[]
  fields?: string[]
}

export type TransportPluginSettingsSchema = {
  scope: 'transport_account'
  supportsMultipleAccounts?: boolean
  setupMethods?: TransportPluginAccountSetupMethod[]
  fields: TransportPluginSettingsField[]
}

export type TransportPluginAccountSetupEventState =
  | 'waiting_scan'
  | 'scanned'
  | 'waiting_confirm'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'failed'

export type TransportPluginAccountSetupEventBase = {
  pluginId?: string
  accountId?: string
  methodId?: string
  sessionId: string
}

export type TransportPluginAccountSetupEvent =
  | (TransportPluginAccountSetupEventBase & {
      type: 'qr'
      qrText?: string
      qrImageDataUrl?: string
      qrUrl?: string
      expiresAt: string
    })
  | (TransportPluginAccountSetupEventBase & {
      type: 'status'
      state: TransportPluginAccountSetupEventState
      message?: string
    })
  | (TransportPluginAccountSetupEventBase & {
      type: 'completed'
      config: Record<string, TransportPluginAccountConfigValue>
      secrets?: Record<string, string>
    })
  | (TransportPluginAccountSetupEventBase & {
      type: 'expired'
      reason?: string
    })
  | (TransportPluginAccountSetupEventBase & {
      type: 'failed'
      retryable: boolean
      error: string
    })

export type StartTransportPluginAccountSetupInput = {
  pluginId: string
  accountId: string
  methodId: string
  initialValues?: Record<string, unknown>
  validateAfterSave?: boolean
}

export type TransportPluginAccountSetupStartInput = {
  accountId: string
  methodId: string
  initialValues?: Record<string, unknown>
}

export type TransportPluginAccountSetupStartResult = {
  pluginId?: string
  accountId: string
  methodId: string
  sessionId: string
  startedAt: string
  expiresAt?: string | null
  events?: TransportPluginAccountSetupEvent[]
}

export type TransportPluginValidationStatus = 'unknown' | 'validated' | 'invalid'

export type InstalledTransportPlugin = {
  pluginId: string
  displayName: string
  description?: string
  version: string
  sourceKind: 'builtin' | 'user' | 'workspace'
  state: 'discovered' | 'activated' | 'deactivated' | 'failed'
  error?: string | null
  enabled: boolean
  configurable: boolean
  accountCount: number
  validationStatus: TransportPluginValidationStatus
  lastValidatedAt?: string | null
  validationError?: string | null
  settingsSchema?: TransportPluginSettingsSchema
}

export type TransportPluginAccountConfigValue = string | number | boolean | null

export type TransportPluginAccount = {
  pluginId: string
  accountId: string
  enabled: boolean
  config: Record<string, TransportPluginAccountConfigValue>
  hasSecrets: Record<string, boolean>
  secrets: Record<string, string>
  validationStatus: TransportPluginValidationStatus
  lastValidatedAt?: string | null
  validationError?: string | null
  createdAt: string
  updatedAt: string
}

export type TransportPluginAccountRuntimeConfig = {
  config: Record<string, TransportPluginAccountConfigValue>
  secrets: Record<string, string>
  enabled: boolean
}

export type SetTransportPluginEnabledInput = {
  pluginId: string
  enabled: boolean
}

export type SaveTransportPluginAccountInput = {
  pluginId: string
  accountId: string
  enabled?: boolean
  config?: Record<string, unknown>
  secrets?: Record<string, string | null | undefined>
}

export type TestTransportPluginAccountInput = {
  pluginId: string
  accountId: string
}

export type TestTransportPluginAccountResult = {
  pluginId: string
  accountId: string
  success: true
  checkedAt: string
}
