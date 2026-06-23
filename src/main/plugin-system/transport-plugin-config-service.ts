import type Database from 'better-sqlite3'
import type { PluginManifest } from './plugin-types.ts'
import { ensureTransportPluginConfigSchema } from './transport-plugin-config-db.ts'
import type {
  SaveTransportPluginAccountInput,
  SetTransportPluginEnabledInput,
  TransportPluginAccount,
  TransportPluginAccountConfigValue,
  TransportPluginAccountRuntimeConfig,
  TransportPluginValidationStatus,
  TransportPluginSettingsField,
  TransportPluginSettingsSchema
} from '../../shared/transport-plugins.ts'

type TransportPluginStateRow = {
  plugin_id: string
  enabled: number
  updated_at: string
}

type TransportPluginAccountRow = {
  plugin_id: string
  account_id: string
  enabled: number
  config_json: string | null
  secrets_blob: Buffer | null
  validation_status: string | null
  validation_checked_at: string | null
  validation_error: string | null
  created_at: string
  updated_at: string
}

type TransportPluginAccountSnapshot = {
  config: Record<string, TransportPluginAccountConfigValue>
  secrets: Record<string, string>
  enabled: boolean
  validationStatus: TransportPluginValidationStatus
  lastValidatedAt: string | null
  validationError: string | null
  createdAt: string
  updatedAt: string
}

export type TransportPluginSecretCodec = {
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const parseStoredConfigJson = (
  value: string | null,
  schema?: TransportPluginSettingsSchema
): Record<string, TransportPluginAccountConfigValue> => {
  if (!value) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return {}
  }

  if (!isPlainRecord(parsed)) return {}

  const record = parsed as Record<string, unknown>
  if (!schema) {
    const normalized: Record<string, TransportPluginAccountConfigValue> = {}
    for (const [key, item] of Object.entries(record)) {
      if (
        item === null ||
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean'
      ) {
        normalized[key] = item
      }
    }
    return normalized
  }

  const normalized: Record<string, TransportPluginAccountConfigValue> = {}
  for (const field of schema.fields) {
    if (field.type === 'secret') continue
    const valueForField = normalizeNonSecretFieldValue(field, record[field.key], false)
    if (valueForField !== undefined) normalized[field.key] = valueForField
  }
  return normalized
}

const decodeSecretsRecord = (value: string): Record<string, string> => {
  if (!value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    if (!isPlainRecord(parsed)) return {}

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  } catch {
    return {}
  }
}

const decryptSecrets = (
  value: Buffer | null,
  secretCodec?: TransportPluginSecretCodec
): Record<string, string> => {
  if (!value) return {}

  try {
    return decodeSecretsRecord(secretCodec ? secretCodec.decrypt(value) : value.toString('utf8'))
  } catch {
    return {}
  }
}

const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return undefined
}

const normalizeNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const normalizeNonSecretFieldValue = (
  field: TransportPluginSettingsField,
  value: unknown,
  strict: boolean
): TransportPluginAccountConfigValue | undefined => {
  if (value === undefined) return undefined
  if (value === null) return undefined
  if (typeof value === 'string' && !value.trim()) return undefined

  if (field.type === 'text') {
    if (typeof value !== 'string') {
      if (strict) throw new Error(`${field.label} must be a string`)
      return undefined
    }
    const trimmed = value.trim()
    return trimmed ? trimmed : undefined
  }

  if (field.type === 'select') {
    if (typeof value !== 'string') {
      if (strict) throw new Error(`${field.label} must be a string`)
      return undefined
    }
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const allowed = new Set((field.options ?? []).map((option) => option.value))
    if (allowed.size > 0 && !allowed.has(trimmed)) {
      if (strict) throw new Error(`${field.label} must be one of: ${[...allowed].join(', ')}`)
      return undefined
    }
    return trimmed
  }

  if (field.type === 'boolean') {
    const normalized = normalizeBoolean(value)
    if (normalized === undefined && strict) {
      throw new Error(`${field.label} must be boolean`)
    }
    return normalized
  }

  if (field.type === 'number') {
    const normalized = normalizeNumber(value)
    if (normalized === undefined && strict) {
      throw new Error(`${field.label} must be number`)
    }
    return normalized
  }

  return undefined
}

const normalizeSecretFieldValue = (
  field: TransportPluginSettingsField,
  value: unknown,
  strict: boolean
): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    if (strict) throw new Error(`${field.label} must be a string`)
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const normalizeValidationStatus = (
  value: string | null | undefined
): TransportPluginValidationStatus =>
  value === 'validated' || value === 'invalid' ? value : 'unknown'

export class TransportPluginConfigService {
  private readonly db: Database.Database
  private readonly secretCodec?: TransportPluginSecretCodec

  constructor(db: Database.Database, options?: { secretCodec?: TransportPluginSecretCodec }) {
    this.db = db
    this.secretCodec = options?.secretCodec
    ensureTransportPluginConfigSchema(this.db)
  }

  isPluginEnabled(pluginId: string): boolean {
    const row = this.getPluginStateRow(pluginId)

    return row ? row.enabled === 1 : false
  }

  isTransportPluginEnabled(manifest: PluginManifest): boolean {
    return this.isPluginEnabled(manifest.id)
  }

  setPluginEnabled(input: SetTransportPluginEnabledInput): { pluginId: string; enabled: boolean } {
    const pluginId = String(input.pluginId ?? '').trim()
    if (!pluginId) throw new Error('pluginId is required')

    this.db
      .prepare(
        `INSERT INTO transport_plugins (plugin_id, enabled, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(plugin_id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(pluginId, input.enabled ? 1 : 0)

    return { pluginId, enabled: input.enabled }
  }

  listAccounts(
    pluginId: string,
    settingsSchema?: TransportPluginSettingsSchema
  ): TransportPluginAccount[] {
    const normalizedPluginId = String(pluginId ?? '').trim()
    if (!normalizedPluginId) throw new Error('pluginId is required')

    const rows = this.db
      .prepare(
        `SELECT plugin_id, account_id, enabled, config_json, secrets_blob,
                validation_status, validation_checked_at, validation_error,
                created_at, updated_at
         FROM transport_plugin_accounts
         WHERE plugin_id = ?
         ORDER BY created_at ASC, account_id ASC`
      )
      .all(normalizedPluginId) as TransportPluginAccountRow[]

    return rows.map((row) => this.mapAccountRow(row, settingsSchema))
  }

  getAccount(
    pluginId: string,
    accountId: string,
    settingsSchema?: TransportPluginSettingsSchema
  ): TransportPluginAccount | null {
    const row = this.getAccountRow(pluginId, accountId)
    return row ? this.mapAccountRow(row, settingsSchema) : null
  }

  getRuntimeAccountConfig(
    manifest: PluginManifest,
    accountId: string
  ): TransportPluginAccountRuntimeConfig | null {
    if (!this.getAccountRow(manifest.id, accountId)) return null
    const snapshot = this.readAccountSnapshot(
      manifest.id,
      accountId,
      manifest.contributes?.settings
    )
    return {
      config: { ...snapshot.config },
      secrets: { ...snapshot.secrets },
      enabled: snapshot.enabled
    }
  }

  saveAccount(
    manifest: PluginManifest,
    input: SaveTransportPluginAccountInput
  ): TransportPluginAccount {
    const settingsSchema = manifest.contributes?.settings
    if (!settingsSchema) {
      throw new Error(`Transport plugin ${manifest.id} does not declare contributes.settings`)
    }

    const pluginId = String(input.pluginId ?? '').trim()
    if (!pluginId) throw new Error('pluginId is required')
    if (pluginId !== manifest.id) {
      throw new Error(`pluginId mismatch: expected ${manifest.id}, got ${pluginId}`)
    }

    const accountId = String(input.accountId ?? '').trim()
    if (!accountId) throw new Error('accountId is required')

    const existing = this.readAccountSnapshot(pluginId, accountId, settingsSchema)
    const existingAccounts = this.listAccounts(pluginId, settingsSchema)
    if (
      settingsSchema.supportsMultipleAccounts === false &&
      existingAccounts.some((item) => item.accountId !== accountId)
    ) {
      throw new Error(`${manifest.displayName} only supports a single account`)
    }

    const configInput = isPlainRecord(input.config) ? input.config : {}
    const secretInput = isPlainRecord(input.secrets) ? input.secrets : {}
    const nextConfig: Record<string, TransportPluginAccountConfigValue> = {}
    const nextSecrets: Record<string, string> = {}

    for (const field of settingsSchema.fields) {
      if (field.type === 'secret') {
        const provided = hasOwn(secretInput, field.key)
          ? normalizeSecretFieldValue(field, secretInput[field.key], true)
          : existing.secrets[field.key]
        if (provided !== undefined) {
          nextSecrets[field.key] = provided
        }
        if (field.required && !provided) {
          throw new Error(`${field.label} is required`)
        }
        continue
      }

      const rawValue = hasOwn(configInput, field.key)
        ? configInput[field.key]
        : (existing.config[field.key] ?? field.defaultValue)
      const normalizedValue = normalizeNonSecretFieldValue(
        field,
        rawValue,
        hasOwn(configInput, field.key)
      )
      if (normalizedValue !== undefined) {
        nextConfig[field.key] = normalizedValue
      }
      const missingRequired =
        normalizedValue === undefined ||
        normalizedValue === null ||
        (typeof normalizedValue === 'string' && !normalizedValue.trim())
      if (field.required && missingRequired) {
        throw new Error(`${field.label} is required`)
      }
    }

    const enabled = input.enabled ?? existing.enabled ?? true
    this.db
      .prepare(
        `INSERT INTO transport_plugin_accounts
          (plugin_id, account_id, enabled, config_json, secrets_blob,
           validation_status, validation_checked_at, validation_error,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL,
           COALESCE((SELECT created_at FROM transport_plugin_accounts WHERE plugin_id = ? AND account_id = ?), datetime('now')),
           datetime('now'))
         ON CONFLICT(plugin_id, account_id) DO UPDATE SET
           enabled = excluded.enabled,
           config_json = excluded.config_json,
           secrets_blob = excluded.secrets_blob,
           validation_status = excluded.validation_status,
           validation_checked_at = excluded.validation_checked_at,
           validation_error = excluded.validation_error,
           updated_at = excluded.updated_at`
      )
      .run(
        pluginId,
        accountId,
        enabled ? 1 : 0,
        JSON.stringify(nextConfig),
        this.encryptSecrets(nextSecrets),
        pluginId,
        accountId
      )

    const saved = this.getAccount(pluginId, accountId, settingsSchema)
    if (!saved) throw new Error(`Failed to persist transport account ${pluginId}:${accountId}`)
    return saved
  }

  deleteAccount(pluginId: string, accountId: string): { success: true } {
    const normalizedPluginId = String(pluginId ?? '').trim()
    const normalizedAccountId = String(accountId ?? '').trim()
    if (!normalizedPluginId) throw new Error('pluginId is required')
    if (!normalizedAccountId) throw new Error('accountId is required')

    this.db
      .prepare(
        `DELETE FROM transport_plugin_accounts
         WHERE plugin_id = ? AND account_id = ?`
      )
      .run(normalizedPluginId, normalizedAccountId)

    return { success: true }
  }

  setAccountValidationResult(input: {
    pluginId: string
    accountId: string
    status: Exclude<TransportPluginValidationStatus, 'unknown'>
    checkedAt?: string
    error?: string | null
  }): TransportPluginAccount {
    const pluginId = String(input.pluginId ?? '').trim()
    const accountId = String(input.accountId ?? '').trim()
    if (!pluginId) throw new Error('pluginId is required')
    if (!accountId) throw new Error('accountId is required')

    const checkedAt = input.checkedAt?.trim() || new Date().toISOString()
    this.db
      .prepare(
        `UPDATE transport_plugin_accounts
         SET validation_status = ?,
             validation_checked_at = ?,
             validation_error = ?,
             updated_at = datetime('now')
         WHERE plugin_id = ? AND account_id = ?`
      )
      .run(input.status, checkedAt, input.error?.trim() || null, pluginId, accountId)

    const updated = this.getAccount(pluginId, accountId)
    if (!updated) throw new Error(`Transport account not found: ${pluginId}:${accountId}`)
    return updated
  }

  resolveStartupAccountIds(manifest: PluginManifest): string[] {
    if (!this.isTransportPluginEnabled(manifest)) return []

    const settingsSchema = manifest.contributes?.settings
    if (!settingsSchema) return []

    const accounts = this.listAccounts(manifest.id, settingsSchema).filter(
      (account) => account.enabled && this.accountHasRequiredSettings(account, settingsSchema)
    )

    if (settingsSchema.supportsMultipleAccounts === false) {
      const preferredAccount =
        accounts.find((account) => account.accountId === 'default') ?? accounts[0]
      return preferredAccount ? [preferredAccount.accountId] : []
    }

    return accounts.map((item) => item.accountId)
  }

  private getPluginStateRow(pluginId: string): TransportPluginStateRow | null {
    const normalizedPluginId = String(pluginId ?? '').trim()
    if (!normalizedPluginId) throw new Error('pluginId is required')

    return (
      (this.db
        .prepare(
          `SELECT plugin_id, enabled, updated_at
           FROM transport_plugins
           WHERE plugin_id = ?
           LIMIT 1`
        )
        .get(normalizedPluginId) as TransportPluginStateRow | undefined) ?? null
    )
  }

  private accountHasRequiredSettings(
    account: TransportPluginAccount,
    settingsSchema: TransportPluginSettingsSchema
  ): boolean {
    return settingsSchema.fields.every((field) => {
      if (!field.required) return true
      if (field.type === 'secret') return account.hasSecrets[field.key] === true

      const value = account.config[field.key]
      if (value === undefined || value === null) return false
      return typeof value === 'string' ? value.trim().length > 0 : true
    })
  }

  private getAccountRow(pluginId: string, accountId: string): TransportPluginAccountRow | null {
    const normalizedPluginId = String(pluginId ?? '').trim()
    const normalizedAccountId = String(accountId ?? '').trim()
    if (!normalizedPluginId) throw new Error('pluginId is required')
    if (!normalizedAccountId) throw new Error('accountId is required')

    return (
      (this.db
        .prepare(
          `SELECT plugin_id, account_id, enabled, config_json, secrets_blob,
                  validation_status, validation_checked_at, validation_error,
                  created_at, updated_at
           FROM transport_plugin_accounts
           WHERE plugin_id = ? AND account_id = ?
           LIMIT 1`
        )
        .get(normalizedPluginId, normalizedAccountId) as TransportPluginAccountRow | undefined) ??
      null
    )
  }

  private readAccountSnapshot(
    pluginId: string,
    accountId: string,
    settingsSchema?: TransportPluginSettingsSchema
  ): TransportPluginAccountSnapshot {
    const row = this.getAccountRow(pluginId, accountId)
    if (!row) {
      return {
        config: {},
        secrets: {},
        enabled: true,
        validationStatus: 'unknown',
        lastValidatedAt: null,
        validationError: null,
        createdAt: '',
        updatedAt: ''
      }
    }

    return {
      config: parseStoredConfigJson(row.config_json, settingsSchema),
      secrets: decryptSecrets(row.secrets_blob, this.secretCodec),
      enabled: row.enabled === 1,
      validationStatus: normalizeValidationStatus(row.validation_status),
      lastValidatedAt: row.validation_checked_at ?? null,
      validationError: row.validation_error ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapAccountRow(
    row: TransportPluginAccountRow,
    settingsSchema?: TransportPluginSettingsSchema
  ): TransportPluginAccount {
    const secrets = decryptSecrets(row.secrets_blob, this.secretCodec)
    const hasSecrets = Object.fromEntries(Object.keys(secrets).map((key) => [key, true])) as Record<
      string,
      boolean
    >

    return {
      pluginId: row.plugin_id,
      accountId: row.account_id,
      enabled: row.enabled === 1,
      config: parseStoredConfigJson(row.config_json, settingsSchema),
      hasSecrets,
      secrets,
      validationStatus: normalizeValidationStatus(row.validation_status),
      lastValidatedAt: row.validation_checked_at ?? null,
      validationError: row.validation_error ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private encryptSecrets(value: Record<string, string>): Buffer | null {
    if (Object.keys(value).length === 0) return null
    const raw = JSON.stringify(value)
    return this.secretCodec ? this.secretCodec.encrypt(raw) : Buffer.from(raw, 'utf8')
  }
}
