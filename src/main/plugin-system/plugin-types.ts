import type {
  TransportPluginAccountSetupMethod,
  TransportPluginSettingsField,
  TransportPluginSettingsFieldDefaultValue,
  TransportPluginSettingsFieldOption,
  TransportPluginSettingsSchema
} from '../../shared/transport-plugins.ts'
import { sanitizeForLog } from '../logging/redaction.ts'

export type PluginKind =
  | 'transport'
  | 'runtime-surface'
  | 'context-engine'
  | 'memory-provider'
  | 'hook'
  | 'tool-extension'

export type PluginSourceKind = 'builtin' | 'user' | 'workspace'

export type PluginTransportContribution = Record<string, never>

export type PluginManifest = {
  id: string
  kind: PluginKind
  apiVersion: string
  version: string
  entry?: string
  displayName: string
  description?: string
  permissions?: {
    network?: string[]
    fs?: string[]
  }
  contributes?: {
    transport?: PluginTransportContribution
    settings?: TransportPluginSettingsSchema
  }
}

export type PluginRegistrationState = 'discovered' | 'activated' | 'deactivated' | 'failed'

export type PluginRegistration<TPlugin> = {
  manifest: PluginManifest
  sourceKind: PluginSourceKind
  state: PluginRegistrationState
  plugin?: TPlugin
  error?: string | null
}

export type PluginLogger = {
  debug(message: string, meta?: unknown): void
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

export type PluginRegisterContext = {
  logger: PluginLogger
  pluginId?: string
  manifest?: PluginManifest
  sourceKind?: PluginSourceKind
  pluginRootDir?: string
  pluginConfigDir?: string
  appConfigDir?: string
}

export type BuiltinPluginModule<
  TPlugin,
  TContext extends PluginRegisterContext = PluginRegisterContext
> = {
  manifest: PluginManifest
  register(ctx: TContext): TPlugin | Promise<TPlugin>
}

export const SUPPORTED_PLUGIN_API_VERSION = '1'

const requireNonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid plugin manifest: ${field} is required`)
  }
  return value.trim()
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const parseFieldDefaultValue = (
  value: unknown,
  field: TransportPluginSettingsField,
  path: string
): TransportPluginSettingsFieldDefaultValue | undefined => {
  if (value === undefined) return undefined
  if (value === null) return null

  if (field.type === 'secret') {
    throw new Error(`Invalid plugin manifest: ${path} is not supported for secret fields`)
  }
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`Invalid plugin manifest: ${path} must be boolean`)
    }
    return value
  }
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Invalid plugin manifest: ${path} must be number`)
    }
    return value
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid plugin manifest: ${path} must be string`)
  }
  return value
}

const parseSettingsFieldOption = (
  value: unknown,
  path: string
): TransportPluginSettingsFieldOption => {
  if (!isPlainRecord(value)) {
    throw new Error(`Invalid plugin manifest: ${path} must be object`)
  }
  return {
    value: requireNonEmptyString(value.value, `${path}.value`),
    label: requireNonEmptyString(value.label, `${path}.label`)
  }
}

const parseSettingsField = (value: unknown, index: number): TransportPluginSettingsField => {
  const path = `contributes.settings.fields[${index}]`
  if (!isPlainRecord(value)) {
    throw new Error(`Invalid plugin manifest: ${path} must be object`)
  }

  const type = requireNonEmptyString(value.type, `${path}.type`)
  if (
    type !== 'text' &&
    type !== 'secret' &&
    type !== 'select' &&
    type !== 'boolean' &&
    type !== 'number'
  ) {
    throw new Error(`Invalid plugin manifest: unsupported field type ${type}`)
  }

  const field: TransportPluginSettingsField = {
    key: requireNonEmptyString(value.key, `${path}.key`),
    type,
    label: requireNonEmptyString(value.label, `${path}.label`),
    description:
      typeof value.description === 'string' && value.description.trim()
        ? value.description.trim()
        : undefined,
    required: typeof value.required === 'boolean' ? value.required : undefined,
    placeholder:
      typeof value.placeholder === 'string' && value.placeholder.trim()
        ? value.placeholder.trim()
        : undefined
  }

  const defaultValue = parseFieldDefaultValue(value.defaultValue, field, `${path}.defaultValue`)
  if (defaultValue !== undefined) field.defaultValue = defaultValue

  if (type === 'select') {
    if (!Array.isArray(value.options) || value.options.length === 0) {
      throw new Error(`Invalid plugin manifest: ${path}.options must be a non-empty array`)
    }
    field.options = value.options.map((option, optionIndex) =>
      parseSettingsFieldOption(option, `${path}.options[${optionIndex}]`)
    )
  } else if (Array.isArray(value.options)) {
    field.options = value.options.map((option, optionIndex) =>
      parseSettingsFieldOption(option, `${path}.options[${optionIndex}]`)
    )
  }

  return field
}

const parseOptionalStringArray = (value: unknown, path: string): string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new Error(`Invalid plugin manifest: ${path} must be an array`)
  }
  return value.map((item, index) => requireNonEmptyString(item, `${path}[${index}]`))
}

const parseSetupMethod = (value: unknown, index: number): TransportPluginAccountSetupMethod => {
  const path = `contributes.settings.setupMethods[${index}]`
  if (!isPlainRecord(value)) {
    throw new Error(`Invalid plugin manifest: ${path} must be object`)
  }

  const kind = requireNonEmptyString(value.kind, `${path}.kind`)
  if (kind !== 'form' && kind !== 'qr' && kind !== 'redirect' && kind !== 'cli_import') {
    throw new Error(`Invalid plugin manifest: unsupported setup method kind ${kind}`)
  }

  return {
    id: requireNonEmptyString(value.id, `${path}.id`),
    kind,
    label: requireNonEmptyString(value.label, `${path}.label`),
    description:
      typeof value.description === 'string' && value.description.trim()
        ? value.description.trim()
        : undefined,
    recommended: typeof value.recommended === 'boolean' ? value.recommended : undefined,
    outputConfigKeys: parseOptionalStringArray(value.outputConfigKeys, `${path}.outputConfigKeys`),
    outputSecretKeys: parseOptionalStringArray(value.outputSecretKeys, `${path}.outputSecretKeys`),
    fields: parseOptionalStringArray(value.fields, `${path}.fields`)
  }
}

const parseTransportSettingsSchema = (value: unknown): TransportPluginSettingsSchema => {
  if (!isPlainRecord(value)) {
    throw new Error('Invalid plugin manifest: contributes.settings must be object')
  }

  const scope = requireNonEmptyString(value.scope, 'contributes.settings.scope')
  if (scope !== 'transport_account') {
    throw new Error(`Invalid plugin manifest: unsupported settings scope ${scope}`)
  }
  if (!Array.isArray(value.fields) || value.fields.length === 0) {
    throw new Error(
      'Invalid plugin manifest: contributes.settings.fields must be a non-empty array'
    )
  }

  const schema: TransportPluginSettingsSchema = {
    scope,
    supportsMultipleAccounts:
      typeof value.supportsMultipleAccounts === 'boolean'
        ? value.supportsMultipleAccounts
        : undefined,
    fields: value.fields.map((field, index) => parseSettingsField(field, index))
  }
  if (value.setupMethods !== undefined) {
    if (!Array.isArray(value.setupMethods) || value.setupMethods.length === 0) {
      throw new Error(
        'Invalid plugin manifest: contributes.settings.setupMethods must be a non-empty array'
      )
    }
    schema.setupMethods = value.setupMethods.map((method, index) => parseSetupMethod(method, index))
  }
  return schema
}

export const validatePluginManifest = (value: unknown): PluginManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid plugin manifest: expected object')
  }

  const record = value as Record<string, unknown>
  const kind = requireNonEmptyString(record.kind, 'kind') as PluginKind
  if (
    kind !== 'transport' &&
    kind !== 'runtime-surface' &&
    kind !== 'context-engine' &&
    kind !== 'memory-provider' &&
    kind !== 'hook' &&
    kind !== 'tool-extension'
  ) {
    throw new Error(`Invalid plugin manifest: unsupported kind ${kind}`)
  }

  const apiVersion = requireNonEmptyString(record.apiVersion, 'apiVersion')
  if (apiVersion !== SUPPORTED_PLUGIN_API_VERSION) {
    throw new Error(`Unsupported plugin apiVersion: ${apiVersion}`)
  }

  const permissionsRecord = isPlainRecord(record.permissions) ? record.permissions : undefined
  const contributesRecord = isPlainRecord(record.contributes) ? record.contributes : undefined
  const transportRecord = isPlainRecord(contributesRecord?.transport)
  const settingsSchema = contributesRecord?.settings
    ? parseTransportSettingsSchema(contributesRecord.settings)
    : undefined

  if (settingsSchema && kind !== 'transport') {
    throw new Error(
      'Invalid plugin manifest: contributes.settings currently only supports transport plugins'
    )
  }

  return {
    id: requireNonEmptyString(record.id, 'id'),
    kind,
    apiVersion,
    version: requireNonEmptyString(record.version, 'version'),
    entry:
      typeof record.entry === 'string' && record.entry.trim() ? record.entry.trim() : undefined,
    displayName: requireNonEmptyString(record.displayName, 'displayName'),
    description:
      typeof record.description === 'string' && record.description.trim()
        ? record.description.trim()
        : undefined,
    permissions: permissionsRecord
      ? {
          network: Array.isArray(permissionsRecord.network)
            ? permissionsRecord.network.filter((item): item is string => typeof item === 'string')
            : undefined,
          fs: Array.isArray(permissionsRecord.fs)
            ? permissionsRecord.fs.filter((item): item is string => typeof item === 'string')
            : undefined
        }
      : undefined,
    contributes:
      transportRecord || settingsSchema
        ? {
            transport: transportRecord ? {} : undefined,
            settings: settingsSchema
          }
        : undefined
  }
}

export const createConsolePluginLogger = (pluginId: string): PluginLogger => ({
  debug: (message, meta) =>
    console.debug(`[plugin:${pluginId}] ${message}`, sanitizeForLog(meta ?? '')),
  info: (message, meta) =>
    console.info(`[plugin:${pluginId}] ${message}`, sanitizeForLog(meta ?? '')),
  warn: (message, meta) =>
    console.warn(`[plugin:${pluginId}] ${message}`, sanitizeForLog(meta ?? '')),
  error: (message, meta) =>
    console.error(`[plugin:${pluginId}] ${message}`, sanitizeForLog(meta ?? ''))
})
