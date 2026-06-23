import type Database from 'better-sqlite3'

export const ensureAgentPluginStateSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_plugins (
      plugin_id     TEXT PRIMARY KEY,
      enabled       INTEGER NOT NULL DEFAULT 1,
      source_kind   TEXT,
      install_dir   TEXT,
      manifest_json TEXT,
      installed_at  TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_plugin_components (
      plugin_id      TEXT NOT NULL,
      component_type TEXT NOT NULL,
      component_id   TEXT NOT NULL,
      enabled        INTEGER NOT NULL DEFAULT 1,
      settings_json  TEXT,
      updated_at     TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (plugin_id, component_type, component_id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_plugin_components_plugin
      ON agent_plugin_components(plugin_id, component_type, enabled);
  `)
}
