import type Database from 'better-sqlite3'

export const CONTEXT_SCHEMA_VERSION = 13

export function migrateContextSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS context_entries (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      agent_run_id TEXT,
      agent_turn_id TEXT,
      source_kind TEXT NOT NULL,
      source_ref TEXT,
      group_id TEXT,
      role TEXT NOT NULL,
      semantic_kind TEXT NOT NULL,
      include_in_model_context INTEGER NOT NULL DEFAULT 1,
      include_in_memory INTEGER NOT NULL DEFAULT 0,
      compact_policy TEXT NOT NULL DEFAULT 'summarize',
      content_text TEXT,
      content_json TEXT,
      token_estimate INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_context_entries_thread_seq
      ON context_entries(thread_id, seq);
    CREATE INDEX IF NOT EXISTS idx_context_entries_thread_run
      ON context_entries(thread_id, agent_run_id);
    CREATE INDEX IF NOT EXISTS idx_context_entries_thread_semantic_created
      ON context_entries(thread_id, semantic_kind, created_at ASC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_context_entries_thread_semantic_source_ref
      ON context_entries(thread_id, semantic_kind, source_ref)
      WHERE source_ref IS NOT NULL;

    CREATE TABLE IF NOT EXISTS thread_context_heads (
      thread_id TEXT PRIMARY KEY,
      engine_name TEXT NOT NULL,
      active_summary_entry_id TEXT,
      compacted_until_seq INTEGER,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
      FOREIGN KEY (active_summary_entry_id) REFERENCES context_entries(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS context_compactions (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      engine_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      base_summary_entry_id TEXT,
      new_summary_entry_id TEXT,
      from_seq_exclusive INTEGER NOT NULL,
      compacted_until_seq INTEGER NOT NULL,
      protected_tail_start_seq INTEGER,
      estimated_input_tokens INTEGER,
      estimated_output_tokens INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_context_compactions_thread_created
      ON context_compactions(thread_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS context_engine_state (
      thread_id TEXT NOT NULL,
      engine_name TEXT NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
      PRIMARY KEY (thread_id, engine_name)
    );
  `)
}
