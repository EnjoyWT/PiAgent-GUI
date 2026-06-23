import type Database from 'better-sqlite3'

export const ensureTransportPluginConfigSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transport_plugins (
      plugin_id   TEXT PRIMARY KEY,
      enabled     INTEGER DEFAULT 1,
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transport_plugin_accounts (
      plugin_id    TEXT NOT NULL,
      account_id   TEXT NOT NULL,
      enabled      INTEGER DEFAULT 1,
      config_json  TEXT,
      secrets_blob BLOB,
      validation_status TEXT,
      validation_checked_at TEXT,
      validation_error TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (plugin_id, account_id)
    );

    CREATE INDEX IF NOT EXISTS idx_transport_plugin_accounts_plugin
      ON transport_plugin_accounts(plugin_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_transport_plugin_accounts_enabled
      ON transport_plugin_accounts(plugin_id, enabled, updated_at DESC);
  `)

  const columns = db.prepare(`PRAGMA table_info(transport_plugin_accounts)`).all() as Array<{
    name: string
  }>
  const columnNames = new Set(columns.map((column) => column.name))

  if (!columnNames.has('validation_status')) {
    db.exec(`ALTER TABLE transport_plugin_accounts ADD COLUMN validation_status TEXT`)
  }
  if (!columnNames.has('validation_checked_at')) {
    db.exec(`ALTER TABLE transport_plugin_accounts ADD COLUMN validation_checked_at TEXT`)
  }
  if (!columnNames.has('validation_error')) {
    db.exec(`ALTER TABLE transport_plugin_accounts ADD COLUMN validation_error TEXT`)
  }
}
