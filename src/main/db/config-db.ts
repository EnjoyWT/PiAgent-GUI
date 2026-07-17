import Database from 'better-sqlite3'
import path from 'path'
import { app, safeStorage } from 'electron'
import { ensureTransportPluginConfigSchema } from '../plugin-system/transport-plugin-config-db.ts'
import { listDefaultProviderDefinitions } from '../../shared/providers/registry.ts'

let _db: Database.Database | null = null

export function getConfigDb(): Database.Database {
  if (_db) return _db
  const dbPath = path.join(app.getPath('userData'), 'config.db')
  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')
  migrateConfigDb(_db)
  return _db
}

function getUserVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

function setUserVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`)
}

function seedDefaultProviders(db: Database.Database): void {
  const insertProvider = db.prepare(
    `INSERT OR IGNORE INTO providers (id, display_name, runtime_provider, enabled)
     VALUES (?, ?, ?, ?)`
  )
  const insertSettings = db.prepare(
    `INSERT OR IGNORE INTO provider_settings (provider_id, base_url, settings_json)
     VALUES (?, ?, ?)`
  )

  for (const provider of listDefaultProviderDefinitions()) {
    insertProvider.run(
      provider.id,
      provider.displayName,
      provider.runtimeProvider,
      provider.enabledByDefault ? 1 : 0
    )
    insertSettings.run(
      provider.id,
      provider.defaultBaseUrl || null,
      JSON.stringify(provider.settings ?? {})
    )
  }
}

function migrateConfigDb(db: Database.Database): void {
  // Enforce FK constraints for this connection (even though cross-db FKs won't work).
  db.pragma('foreign_keys = ON')
  const latestVersion = 11

  const migrate = db.transaction(() => {
    let v = getUserVersion(db)

    if (v === 0) {
      initConfigSchema(db)
      v = latestVersion
      setUserVersion(db, v)
      return
    }

    // v2: provider model cache
    if (v < 2) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_model_cache (
          provider    TEXT PRIMARY KEY,
          data_json   TEXT NOT NULL,
          updated_at  TEXT DEFAULT (datetime('now'))
        );
      `)
      v = 2
      setUserVersion(db, v)
    }

    // v3: providers v2 schema (modular providers + per-model enablement)
    if (v < 3) {
      // This project intentionally does not preserve v1/v2 provider data.
      // We upgrade to a normalized schema that supports different provider
      // settings and per-model toggles.
      db.exec(`
        DROP TABLE IF EXISTS provider_model_cache;
        DROP TABLE IF EXISTS providers;

        CREATE TABLE IF NOT EXISTS providers (
          id              TEXT PRIMARY KEY,
          display_name    TEXT NOT NULL,
          runtime_provider TEXT NOT NULL,
          enabled         INTEGER DEFAULT 1,
          created_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_runtime_provider
          ON providers(runtime_provider);

        CREATE TABLE IF NOT EXISTS provider_secrets (
          provider_id TEXT PRIMARY KEY,
          api_key     BLOB,
          FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS provider_settings (
          provider_id   TEXT PRIMARY KEY,
          base_url      TEXT,
          settings_json TEXT,
          updated_at    TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS provider_models (
          provider_id          TEXT NOT NULL,
          model_id             TEXT NOT NULL,
          label                TEXT NOT NULL,
          context_window_tokens INTEGER,
          capabilities_json    TEXT,
          enabled              INTEGER DEFAULT 0,
          raw_json             TEXT,
          updated_at           TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (provider_id, model_id),
          FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_provider_models_enabled
          ON provider_models(provider_id, enabled);
      `)

      seedDefaultProviders(db)

      v = 3
      setUserVersion(db, v)
    }

    // v4: workspace-scoped MCP server enablement
    if (v < 4) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspace_mcp_servers (
          workspace_path TEXT NOT NULL,
          server_id      TEXT NOT NULL,
          enabled        INTEGER DEFAULT 1,
          updated_at     TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (workspace_path, server_id),
          FOREIGN KEY (workspace_path) REFERENCES workspaces(path) ON DELETE CASCADE,
          FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_mcp_servers_workspace
          ON workspace_mcp_servers(workspace_path, enabled);
      `)
      v = 4
      setUserVersion(db, v)
    }

    // v5: remote MCP server support
    if (v < 5) {
      db.exec(`
        ALTER TABLE mcp_servers ADD COLUMN transport_type TEXT DEFAULT 'stdio';
        ALTER TABLE mcp_servers ADD COLUMN url TEXT;
        ALTER TABLE mcp_servers ADD COLUMN headers TEXT;
        ALTER TABLE mcp_servers ADD COLUMN description TEXT;
      `)
      v = 5
      setUserVersion(db, v)
    }

    // v6: cascade workspace_settings cleanup on workspace delete
    if (v < 6) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspace_settings_v2 (
          workspace_path TEXT PRIMARY KEY,
          model          TEXT,
          mcp_enabled    TEXT,
          FOREIGN KEY (workspace_path) REFERENCES workspaces(path) ON DELETE CASCADE
        );

        INSERT OR REPLACE INTO workspace_settings_v2 (workspace_path, model, mcp_enabled)
        SELECT workspace_path, model, mcp_enabled
        FROM workspace_settings
        WHERE workspace_path IN (SELECT path FROM workspaces);

        DROP TABLE workspace_settings;
        ALTER TABLE workspace_settings_v2 RENAME TO workspace_settings;
      `)
      v = 6
      setUserVersion(db, v)
    }

    // v7: seed first-class Qwen provider
    if (v < 7) {
      db.prepare(
        `INSERT OR IGNORE INTO providers (id, display_name, runtime_provider, enabled)
         VALUES (?, ?, ?, ?)`
      ).run('qwen', 'Qwen', 'qwen', 0)

      db.prepare(
        `INSERT OR IGNORE INTO provider_settings (provider_id, base_url, settings_json)
         VALUES (?, ?, ?)`
      ).run(
        'qwen',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        JSON.stringify({
          apiFormat: 'chat_completions',
          maxTokensField: 'max_tokens',
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          thinkingFormat: 'qwen'
        })
      )

      v = 7
      setUserVersion(db, v)
    }

    // v8: transport plugin settings and accounts
    if (v < 8) {
      ensureTransportPluginConfigSchema(db)
      v = 8
      setUserVersion(db, v)
    }

    // v9: transport plugin account validation status
    if (v < 9) {
      ensureTransportPluginConfigSchema(db)
      v = 9
      setUserVersion(db, v)
    }

    // v10: seed all first-class providers supported by the bundled pi-ai runtime.
    if (v < 10) {
      seedDefaultProviders(db)
      v = 10
      setUserVersion(db, v)
    }

    // v11: workspace-scoped external filesystem grants for sandbox mode.
    if (v < 11) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspace_sandbox_grants (
          workspace_path TEXT NOT NULL,
          granted_path   TEXT NOT NULL,
          access_mode    TEXT NOT NULL CHECK (access_mode IN ('read', 'write')),
          created_at     TEXT DEFAULT (datetime('now')),
          updated_at     TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (workspace_path, granted_path),
          FOREIGN KEY (workspace_path) REFERENCES workspaces(path) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_sandbox_grants_workspace
          ON workspace_sandbox_grants(workspace_path);
      `)
      v = 11
      setUserVersion(db, v)
    }
  })

  migrate()
}

function initConfigSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS providers (
      id               TEXT PRIMARY KEY,
      display_name     TEXT NOT NULL,
      runtime_provider TEXT NOT NULL,
      enabled          INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_runtime_provider
      ON providers(runtime_provider);

    CREATE TABLE IF NOT EXISTS provider_secrets (
      provider_id TEXT PRIMARY KEY,
      api_key     BLOB,
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS provider_settings (
      provider_id   TEXT PRIMARY KEY,
      base_url      TEXT,
      settings_json TEXT,
      updated_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS provider_models (
      provider_id           TEXT NOT NULL,
      model_id              TEXT NOT NULL,
      label                 TEXT NOT NULL,
      context_window_tokens INTEGER,
      capabilities_json     TEXT,
      enabled               INTEGER DEFAULT 0,
      raw_json              TEXT,
      updated_at            TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (provider_id, model_id),
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_provider_models_enabled
      ON provider_models(provider_id, enabled);

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      description    TEXT,
      transport_type TEXT DEFAULT 'stdio',
      command        TEXT,
      args           TEXT,
      env            TEXT,
      url            TEXT,
      headers        TEXT,
      enabled        INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      path           TEXT PRIMARY KEY,
      name           TEXT,
      last_opened_at TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_mcp_servers (
      workspace_path TEXT NOT NULL,
      server_id      TEXT NOT NULL,
      enabled        INTEGER DEFAULT 1,
      updated_at     TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_path, server_id),
      FOREIGN KEY (workspace_path) REFERENCES workspaces(path) ON DELETE CASCADE,
      FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_mcp_servers_workspace
      ON workspace_mcp_servers(workspace_path, enabled);

    CREATE TABLE IF NOT EXISTS workspace_settings (
      workspace_path TEXT PRIMARY KEY,
      model          TEXT,
      mcp_enabled    TEXT,
      FOREIGN KEY (workspace_path) REFERENCES workspaces(path) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_sandbox_grants (
      workspace_path TEXT NOT NULL,
      granted_path   TEXT NOT NULL,
      access_mode    TEXT NOT NULL CHECK (access_mode IN ('read', 'write')),
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_path, granted_path),
      FOREIGN KEY (workspace_path) REFERENCES workspaces(path) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_sandbox_grants_workspace
      ON workspace_sandbox_grants(workspace_path);
  `)

  ensureTransportPluginConfigSchema(db)

  seedDefaultProviders(db)
}

// ── global_settings ──────────────────────────────────────────────
export function getSetting(key: string): string | null {
  const db = getConfigDb()
  const row = db.prepare('SELECT value FROM global_settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getConfigDb()
    .prepare('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)')
    .run(key, value)
}

export function getAllSettings(): Record<string, string> {
  const rows = getConfigDb().prepare('SELECT key, value FROM global_settings').all() as {
    key: string
    value: string
  }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

// ── providers ────────────────────────────────────────────────────
export interface ProviderRow {
  id: string
  display_name: string
  runtime_provider: string
  enabled: number
}

export type ProviderInfo = {
  id: string
  displayName: string
  runtimeProvider: string
  enabled: boolean
  baseUrl: string | null
  settingsJson: string | null
}

export type ProviderModelRow = {
  providerId: string
  modelId: string
  label: string
  contextWindowTokens: number | null
  capabilitiesJson: string | null
  enabled: boolean
  rawJson: string | null
  updatedAt: string
}

export function listProviders(): ProviderInfo[] {
  const rows = getConfigDb()
    .prepare(
      `
      SELECT
        p.id as id,
        p.display_name as display_name,
        p.runtime_provider as runtime_provider,
        p.enabled as enabled,
        s.base_url as base_url,
        s.settings_json as settings_json
      FROM providers p
      LEFT JOIN provider_settings s ON s.provider_id = p.id
      ORDER BY p.created_at ASC
      `
    )
    .all() as {
    id: string
    display_name: string
    runtime_provider: string
    enabled: number
    base_url: string | null
    settings_json: string | null
  }[]
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    runtimeProvider: r.runtime_provider,
    enabled: r.enabled === 1,
    baseUrl: r.base_url ?? null,
    settingsJson: r.settings_json ?? null
  }))
}

export function getProvider(providerId: string): ProviderInfo | null {
  const row = getConfigDb()
    .prepare(
      `
      SELECT
        p.id as id,
        p.display_name as display_name,
        p.runtime_provider as runtime_provider,
        p.enabled as enabled,
        s.base_url as base_url,
        s.settings_json as settings_json
      FROM providers p
      LEFT JOIN provider_settings s ON s.provider_id = p.id
      WHERE p.id = ?
      LIMIT 1
      `
    )
    .get(providerId) as
    | {
        id: string
        display_name: string
        runtime_provider: string
        enabled: number
        base_url: string | null
        settings_json: string | null
      }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    displayName: row.display_name,
    runtimeProvider: row.runtime_provider,
    enabled: row.enabled === 1,
    baseUrl: row.base_url ?? null,
    settingsJson: row.settings_json ?? null
  }
}

export function upsertProvider(provider: {
  id: string
  displayName: string
  runtimeProvider: string
  enabled?: boolean
  baseUrl?: string | null
  settingsJson?: string | null
}): void {
  const db = getConfigDb()
  const enabled = provider.enabled ?? true

  db.prepare(
    `INSERT INTO providers (id, display_name, runtime_provider, enabled, created_at)
     VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM providers WHERE id = ?), datetime('now')))
     ON CONFLICT(id) DO UPDATE SET
       display_name = excluded.display_name,
       runtime_provider = excluded.runtime_provider,
       enabled = excluded.enabled`
  ).run(provider.id, provider.displayName, provider.runtimeProvider, enabled ? 1 : 0, provider.id)

  const baseUrl = provider.baseUrl ?? null
  const settingsJson = provider.settingsJson ?? null
  db.prepare(
    `INSERT INTO provider_settings (provider_id, base_url, settings_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(provider_id) DO UPDATE SET
       base_url = excluded.base_url,
       settings_json = excluded.settings_json,
       updated_at = excluded.updated_at`
  ).run(provider.id, baseUrl, settingsJson)
}

export function setProviderApiKey(providerId: string, apiKey: string): void {
  const db = getConfigDb()
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(apiKey)
    : Buffer.from(apiKey)
  db.prepare(
    `INSERT INTO provider_secrets (provider_id, api_key)
     VALUES (?, ?)
     ON CONFLICT(provider_id) DO UPDATE SET
       api_key = excluded.api_key`
  ).run(providerId, encrypted)
}

export function getProviderApiKey(providerId: string): string | null {
  const db = getConfigDb()
  const row = db
    .prepare('SELECT api_key FROM provider_secrets WHERE provider_id = ?')
    .get(providerId) as { api_key: Buffer | null } | undefined
  if (!row?.api_key) return null
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(row.api_key)
    : row.api_key.toString()
}

export function clearProviderApiKey(providerId: string): void {
  getConfigDb().prepare('DELETE FROM provider_secrets WHERE provider_id = ?').run(providerId)
}

export function getProviderApiKeyByRuntimeProvider(runtimeProvider: string): string | null {
  const row = getConfigDb()
    .prepare('SELECT id FROM providers WHERE runtime_provider = ? LIMIT 1')
    .get(runtimeProvider) as { id: string } | undefined
  if (!row?.id) return null
  return getProviderApiKey(row.id)
}

export function getProviderByRuntimeProvider(runtimeProvider: string): ProviderInfo | null {
  const row = getConfigDb()
    .prepare(
      `
      SELECT
        p.id as id,
        p.display_name as display_name,
        p.runtime_provider as runtime_provider,
        p.enabled as enabled,
        s.base_url as base_url,
        s.settings_json as settings_json
      FROM providers p
      LEFT JOIN provider_settings s ON s.provider_id = p.id
      WHERE p.runtime_provider = ?
      LIMIT 1
      `
    )
    .get(runtimeProvider) as
    | {
        id: string
        display_name: string
        runtime_provider: string
        enabled: number
        base_url: string | null
        settings_json: string | null
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    displayName: row.display_name,
    runtimeProvider: row.runtime_provider,
    enabled: row.enabled === 1,
    baseUrl: row.base_url ?? null,
    settingsJson: row.settings_json ?? null
  }
}

export function deleteProvider(providerId: string): void {
  getConfigDb().prepare('DELETE FROM providers WHERE id = ?').run(providerId)
}

// ── provider models ─────────────────────────────────────────────
export function listProviderModels(providerId: string): ProviderModelRow[] {
  const rows = getConfigDb()
    .prepare(
      `SELECT
        provider_id,
        model_id,
        label,
        context_window_tokens,
        capabilities_json,
        enabled,
        raw_json,
        updated_at
       FROM provider_models
       WHERE provider_id = ?
       ORDER BY label ASC`
    )
    .all(providerId) as {
    provider_id: string
    model_id: string
    label: string
    context_window_tokens: number | null
    capabilities_json: string | null
    enabled: number
    raw_json: string | null
    updated_at: string
  }[]
  return rows.map((r) => ({
    providerId: r.provider_id,
    modelId: r.model_id,
    label: r.label,
    contextWindowTokens: r.context_window_tokens ?? null,
    capabilitiesJson: r.capabilities_json ?? null,
    enabled: r.enabled === 1,
    rawJson: r.raw_json ?? null,
    updatedAt: r.updated_at
  }))
}

export function replaceProviderModels(
  providerId: string,
  models: Array<{
    modelId: string
    label: string
    contextWindowTokens?: number | null
    capabilitiesJson?: string | null
    rawJson?: string | null
  }>,
  enabledByDefault: boolean = false
): void {
  const db = getConfigDb()
  const tx = db.transaction(() => {
    const existingEnabledRows = db
      .prepare(
        `SELECT model_id, enabled
         FROM provider_models
         WHERE provider_id = ?`
      )
      .all(providerId) as { model_id: string; enabled: number }[]
    const existingEnabled = new Map(
      existingEnabledRows.map((row) => [row.model_id, row.enabled === 1])
    )

    db.prepare('DELETE FROM provider_models WHERE provider_id = ?').run(providerId)
    const stmt = db.prepare(
      `INSERT INTO provider_models
        (provider_id, model_id, label, context_window_tokens, capabilities_json, enabled, raw_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    for (const m of models) {
      stmt.run(
        providerId,
        m.modelId,
        m.label,
        m.contextWindowTokens ?? null,
        m.capabilitiesJson ?? null,
        (existingEnabled.get(m.modelId) ?? enabledByDefault) ? 1 : 0,
        m.rawJson ?? null
      )
    }
  })
  tx()
}

export function setProviderModelEnabled(
  providerId: string,
  modelId: string,
  enabled: boolean
): void {
  getConfigDb()
    .prepare(
      `UPDATE provider_models
       SET enabled = ?, updated_at = datetime('now')
       WHERE provider_id = ? AND model_id = ?`
    )
    .run(enabled ? 1 : 0, providerId, modelId)
}

export function updateProviderModelCapabilities(
  providerId: string,
  modelId: string,
  capabilitiesJson: string
): void {
  getConfigDb()
    .prepare(
      `UPDATE provider_models
       SET capabilities_json = ?, updated_at = datetime('now')
       WHERE provider_id = ? AND model_id = ?`
    )
    .run(capabilitiesJson, providerId, modelId)
}

// ── mcp_servers ─────────────────────────────────────────────────
export interface McpServerRow {
  id: string
  name: string
  description: string | null
  transport_type: 'stdio' | 'sse' | 'http'
  command: string | null
  args: string | null
  env: string | null
  url: string | null
  headers: string | null
  enabled: number
  created_at: string
}

export function listMcpServers(): McpServerRow[] {
  return getConfigDb()
    .prepare(
      'SELECT id, name, description, transport_type, command, args, env, url, headers, enabled, created_at FROM mcp_servers'
    )
    .all() as McpServerRow[]
}

export function upsertMcpServer(server: {
  id: string
  name: string
  description?: string | null
  transport_type?: 'stdio' | 'sse' | 'http'
  command?: string | null
  args?: string | null
  env?: string | null
  url?: string | null
  headers?: string | null
  enabled?: boolean
}): void {
  const db = getConfigDb()
  const enabled = server.enabled ?? true

  db.prepare(
    `INSERT INTO mcp_servers (id, name, description, transport_type, command, args, env, url, headers, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(
       (SELECT created_at FROM mcp_servers WHERE id = ?),
       datetime('now')
     ))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       transport_type = excluded.transport_type,
       command = excluded.command,
       args = excluded.args,
       env = excluded.env,
       url = excluded.url,
       headers = excluded.headers,
       enabled = excluded.enabled`
  ).run(
    server.id,
    server.name,
    server.description ?? null,
    server.transport_type ?? 'stdio',
    server.command ?? null,
    server.args ?? null,
    server.env ?? null,
    server.url ?? null,
    server.headers ?? null,
    enabled ? 1 : 0,
    server.id
  )
}

export function deleteMcpServer(id: string): void {
  getConfigDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
}

// ── workspaces ───────────────────────────────────────────────────
export interface WorkspaceRow {
  path: string
  name: string | null
  last_opened_at: string | null
  created_at: string
}

export function listWorkspaces(): WorkspaceRow[] {
  return getConfigDb()
    .prepare('SELECT * FROM workspaces ORDER BY last_opened_at DESC')
    .all() as WorkspaceRow[]
}

export function upsertWorkspace(workspacePath: string, name?: string): void {
  getConfigDb()
    .prepare(
      `INSERT INTO workspaces (path, name, last_opened_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(path) DO UPDATE SET
         name = COALESCE(excluded.name, workspaces.name),
         last_opened_at = excluded.last_opened_at`
    )
    .run(workspacePath, name ?? path.basename(workspacePath))
}

export function deleteWorkspace(workspacePath: string): void {
  const db = getConfigDb()
  db.transaction((targetPath: string) => {
    // Keep deletion compatible with pre-v6 databases that may still lack cascade here.
    db.prepare('DELETE FROM workspace_mcp_servers WHERE workspace_path = ?').run(targetPath)
    db.prepare('DELETE FROM workspace_sandbox_grants WHERE workspace_path = ?').run(targetPath)
    db.prepare('DELETE FROM workspace_settings WHERE workspace_path = ?').run(targetPath)
    db.prepare('DELETE FROM workspaces WHERE path = ?').run(targetPath)
  })(workspacePath)
}

// ── workspace_settings ───────────────────────────────────────────
export interface WorkspaceSettingsRow {
  workspace_path: string
  model: string | null
  mcp_enabled: string | null
}

export interface WorkspaceMcpServerRow {
  workspace_path: string
  server_id: string
  enabled: number
  updated_at: string
}

export interface WorkspaceSandboxGrantRow {
  workspace_path: string
  granted_path: string
  access_mode: 'read' | 'write'
  created_at: string
  updated_at: string
}

export function getWorkspaceSettings(workspacePath: string): WorkspaceSettingsRow | null {
  return (
    (getConfigDb()
      .prepare('SELECT * FROM workspace_settings WHERE workspace_path = ?')
      .get(workspacePath) as WorkspaceSettingsRow | undefined) ?? null
  )
}

export function setWorkspaceSettings(
  workspacePath: string,
  settings: Partial<Pick<WorkspaceSettingsRow, 'model' | 'mcp_enabled'>>
): void {
  getConfigDb()
    .prepare(
      `INSERT INTO workspace_settings (workspace_path, model, mcp_enabled)
       VALUES (?, ?, ?)
       ON CONFLICT(workspace_path) DO UPDATE SET
         model = COALESCE(excluded.model, workspace_settings.model),
         mcp_enabled = COALESCE(excluded.mcp_enabled, workspace_settings.mcp_enabled)`
    )
    .run(workspacePath, settings.model ?? null, settings.mcp_enabled ?? null)
}

export function listWorkspaceSandboxGrants(workspacePath: string): WorkspaceSandboxGrantRow[] {
  return getConfigDb()
    .prepare(
      `SELECT workspace_path, granted_path, access_mode, created_at, updated_at
       FROM workspace_sandbox_grants
       WHERE workspace_path = ?
       ORDER BY granted_path ASC`
    )
    .all(workspacePath) as WorkspaceSandboxGrantRow[]
}

export function upsertWorkspaceSandboxGrant(
  workspacePath: string,
  grantedPath: string,
  accessMode: 'read' | 'write'
): void {
  const db = getConfigDb()
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (path, name, last_opened_at)
       VALUES (?, ?, datetime('now'))`
    ).run(workspacePath, path.basename(workspacePath))
    db.prepare(
      `INSERT INTO workspace_sandbox_grants (workspace_path, granted_path, access_mode, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(workspace_path, granted_path) DO UPDATE SET
         access_mode = excluded.access_mode,
         updated_at = excluded.updated_at`
    ).run(workspacePath, grantedPath, accessMode)
  })
  tx()
}

export function deleteWorkspaceSandboxGrant(workspacePath: string, grantedPath: string): void {
  getConfigDb()
    .prepare(
      `DELETE FROM workspace_sandbox_grants
       WHERE workspace_path = ? AND granted_path = ?`
    )
    .run(workspacePath, grantedPath)
}

export function listWorkspaceMcpServerBindings(workspacePath: string): WorkspaceMcpServerRow[] {
  return getConfigDb()
    .prepare(
      `SELECT workspace_path, server_id, enabled, updated_at
       FROM workspace_mcp_servers
       WHERE workspace_path = ?
       ORDER BY server_id ASC`
    )
    .all(workspacePath) as WorkspaceMcpServerRow[]
}

export function listEnabledWorkspaceMcpServerIds(workspacePath: string): string[] {
  const rows = getConfigDb()
    .prepare(
      `SELECT server_id
       FROM workspace_mcp_servers
       WHERE workspace_path = ? AND enabled = 1
       ORDER BY updated_at ASC, server_id ASC`
    )
    .all(workspacePath) as { server_id: string }[]
  return rows.map((row) => row.server_id)
}

export function setWorkspaceMcpServerEnabled(
  workspacePath: string,
  serverId: string,
  enabled: boolean
): void {
  const db = getConfigDb()
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (path, name, last_opened_at)
       VALUES (?, ?, datetime('now'))`
    ).run(workspacePath, path.basename(workspacePath))

    db.prepare(
      `INSERT INTO workspace_mcp_servers (workspace_path, server_id, enabled, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(workspace_path, server_id) DO UPDATE SET
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`
    ).run(workspacePath, serverId, enabled ? 1 : 0)
  })
  tx()
}

export function clearWorkspaceMcpServerBindings(workspacePath: string): void {
  getConfigDb()
    .prepare('DELETE FROM workspace_mcp_servers WHERE workspace_path = ?')
    .run(workspacePath)
}
