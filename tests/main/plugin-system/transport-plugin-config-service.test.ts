import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { validatePluginManifest } from '../../../src/main/plugin-system/plugin-types.ts'
import { TransportPluginConfigService } from '../../../src/main/plugin-system/transport-plugin-config-service.ts'

const createManifest = (supportsMultipleAccounts = true) =>
  validatePluginManifest({
    id: 'feishu',
    kind: 'transport',
    apiVersion: '1',
    version: '0.1.0',
    displayName: 'Feishu',
    entry: './dist/index.mjs',
    contributes: {
      settings: {
        scope: 'transport_account',
        supportsMultipleAccounts,
        fields: [
          {
            key: 'appId',
            type: 'text',
            label: 'App ID',
            required: true
          },
          {
            key: 'mode',
            type: 'select',
            label: 'Connection Mode',
            options: [
              { value: 'websocket', label: 'WebSocket' },
              { value: 'webhook', label: 'Webhook' }
            ],
            defaultValue: 'websocket'
          },
          {
            key: 'appSecret',
            type: 'secret',
            label: 'App Secret',
            required: true
          }
        ]
      }
    }
  })

test('transport plugin config service stores non-secret config and secret presence separately', () => {
  const db = new Database(':memory:')
  const service = new TransportPluginConfigService(db)
  const manifest = createManifest()

  const saved = service.saveAccount(manifest, {
    pluginId: 'feishu',
    accountId: 'team-a',
    enabled: true,
    config: {
      appId: 'cli_123',
      mode: 'websocket'
    },
    secrets: {
      appSecret: 'secret-123'
    }
  })

  assert.equal(saved.pluginId, 'feishu')
  assert.equal(saved.accountId, 'team-a')
  assert.equal(saved.enabled, true)
  assert.deepEqual(saved.config, {
    appId: 'cli_123',
    mode: 'websocket'
  })
  assert.deepEqual(saved.hasSecrets, {
    appSecret: true
  })
  assert.deepEqual(saved.secrets, {
    appSecret: 'secret-123'
  })
  assert.equal(saved.validationStatus, 'unknown')
  assert.equal(saved.lastValidatedAt, null)
  assert.equal(saved.validationError, null)

  const row = db
    .prepare(
      `SELECT config_json, secrets_blob
       FROM transport_plugin_accounts
       WHERE plugin_id = ? AND account_id = ?`
    )
    .get('feishu', 'team-a') as { config_json: string; secrets_blob: Buffer | null } | undefined

  assert.ok(row)
  assert.equal(row?.config_json.includes('secret-123'), false)
  assert.ok(row?.secrets_blob)

  const loaded = service.getAccount('feishu', 'team-a', manifest.contributes?.settings)
  assert.deepEqual(loaded?.hasSecrets, {
    appSecret: true
  })
  assert.deepEqual(loaded?.secrets, {
    appSecret: 'secret-123'
  })
  assert.equal(loaded?.validationStatus, 'unknown')
  assert.deepEqual(loaded?.config, {
    appId: 'cli_123',
    mode: 'websocket'
  })
})

test('transport plugin config service tracks validation result separately from saved credentials', () => {
  const db = new Database(':memory:')
  const service = new TransportPluginConfigService(db)
  const manifest = createManifest()

  service.saveAccount(manifest, {
    pluginId: 'feishu',
    accountId: 'team-a',
    enabled: true,
    config: {
      appId: 'cli_123',
      mode: 'websocket'
    },
    secrets: {
      appSecret: 'secret-123'
    }
  })

  const checkedAt = '2026-04-23T13:00:00.000Z'
  const updated = service.setAccountValidationResult({
    pluginId: 'feishu',
    accountId: 'team-a',
    status: 'invalid',
    checkedAt,
    error: 'invalid credentials'
  })

  assert.equal(updated.validationStatus, 'invalid')
  assert.equal(updated.lastValidatedAt, checkedAt)
  assert.equal(updated.validationError, 'invalid credentials')

  const loaded = service.getAccount('feishu', 'team-a', manifest.contributes?.settings)
  assert.equal(loaded?.validationStatus, 'invalid')
  assert.equal(loaded?.lastValidatedAt, checkedAt)
  assert.equal(loaded?.validationError, 'invalid credentials')
})

test('transport plugin config service resolves startup accounts only from explicit enabled state', () => {
  const db = new Database(':memory:')
  const service = new TransportPluginConfigService(db)
  const manifest = createManifest()

  assert.deepEqual(service.resolveStartupAccountIds(manifest), [])

  service.saveAccount(manifest, {
    pluginId: 'feishu',
    accountId: 'team-a',
    enabled: true,
    config: { appId: 'cli_123' },
    secrets: { appSecret: 'secret-123' }
  })
  service.saveAccount(manifest, {
    pluginId: 'feishu',
    accountId: 'team-b',
    enabled: false,
    config: { appId: 'cli_456' },
    secrets: { appSecret: 'secret-456' }
  })

  assert.deepEqual(service.resolveStartupAccountIds(manifest), [])

  service.setPluginEnabled({
    pluginId: 'feishu',
    enabled: true
  })

  assert.deepEqual(service.resolveStartupAccountIds(manifest), ['team-a'])

  service.setPluginEnabled({
    pluginId: 'feishu',
    enabled: false
  })

  assert.deepEqual(service.resolveStartupAccountIds(manifest), [])
})

test('transport plugin config service limits single-account plugins to one startup account', () => {
  const db = new Database(':memory:')
  const service = new TransportPluginConfigService(db)
  const manifest = createManifest(false)

  service.saveAccount(manifest, {
    pluginId: 'feishu',
    accountId: 'default',
    enabled: true,
    config: { appId: 'cli_default' },
    secrets: { appSecret: 'secret-default' }
  })

  service.setPluginEnabled({
    pluginId: 'feishu',
    enabled: true
  })

  assert.deepEqual(service.resolveStartupAccountIds(manifest), ['default'])
})
