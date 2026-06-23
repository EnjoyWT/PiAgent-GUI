import Database from 'better-sqlite3';
import path from 'node:path';
import * as electron from 'electron';

let _db: Database.Database | null = null;

export function getKnowledgeDb(): Database.Database {
  if (_db) return _db;

  let dbPath: string;
  try {
    const app = electron.app || (electron as any).default?.app;
    dbPath = path.join(app.getPath('userData'), 'knowledge.db');
  } catch (e) {
    dbPath = path.join(process.cwd(), 'knowledge.db');
  }

  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    migrateKnowledgeDb(db);
    _db = db;
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function setKnowledgeDb(db: Database.Database | null): void {
  _db = db;
}

function getUserVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function setUserVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

export function migrateKnowledgeDb(db: Database.Database): void {
  db.pragma('foreign_keys = ON');

  const migrate = db.transaction(() => {
    let version = getUserVersion(db);

    if (version < 1) {
      initKnowledgeSchema(db);
      version = 1;
      setUserVersion(db, version);
    }

    if (version < 2) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_jobs (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          thread_id TEXT,
          agent_run_id TEXT,
          status TEXT NOT NULL,
          error_text TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_status
          ON knowledge_jobs(status);
      `);
      version = 2;
      setUserVersion(db, version);
    }

    if (version < 3) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_relations (
          id TEXT PRIMARY KEY,
          from_entity_id TEXT NOT NULL,
          to_entity_id TEXT NOT NULL,
          relation_type TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0,
          evidence_claim_id TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (from_entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
          FOREIGN KEY (to_entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
          FOREIGN KEY (evidence_claim_id) REFERENCES knowledge_claims(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_relations_from_to
          ON knowledge_relations(from_entity_id, to_entity_id);
      `);
      version = 3;
      setUserVersion(db, version);
    }

    if (version < 4) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_reflections (
          id TEXT PRIMARY KEY,
          entity_id TEXT,
          reflection_type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          source_claim_ids_json TEXT NOT NULL DEFAULT '[]',
          confidence REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (entity_id) REFERENCES knowledge_entities(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_reflections_entity
          ON knowledge_reflections(entity_id);
      `);
      version = 4;
      setUserVersion(db, version);
    }

    if (version < 5) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_vectors (
          id TEXT PRIMARY KEY,
          target_id TEXT NOT NULL,
          target_type TEXT NOT NULL,
          embedding BLOB NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_vectors_target
          ON knowledge_vectors(target_id, target_type);
      `);
      try {
        db.exec(`ALTER TABLE knowledge_claims ADD COLUMN superseded_by TEXT;`);
      } catch (e) {
        // Already exists
      }
      version = 5;
      setUserVersion(db, version);
    }

    if (version < 6) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_memory_tasks (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          thread_id TEXT,
          workspace_path TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          trigger_reason TEXT,
          run_ids_json TEXT NOT NULL DEFAULT '[]',
          started_at TEXT NOT NULL,
          ended_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_user_text TEXT,
          preview_text TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_memory_tasks_thread_status
          ON knowledge_memory_tasks(thread_id, status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS knowledge_memory_task_runs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          thread_id TEXT,
          agent_run_id TEXT,
          workspace_path TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(task_id, agent_run_id),
          FOREIGN KEY (task_id) REFERENCES knowledge_memory_tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_memory_task_runs_task
          ON knowledge_memory_task_runs(task_id);
      `);
      version = 6;
      setUserVersion(db, version);
    }

    if (version < 7) {
      const taskColumns = db.prepare(`PRAGMA table_info(knowledge_memory_tasks)`).all() as Array<{ name: string }>;
      const taskColumnNames = new Set(taskColumns.map((column) => column.name));
      if (!taskColumnNames.has('last_user_text')) {
        db.exec(`ALTER TABLE knowledge_memory_tasks ADD COLUMN last_user_text TEXT`);
      }
      if (!taskColumnNames.has('preview_text')) {
        db.exec(`ALTER TABLE knowledge_memory_tasks ADD COLUMN preview_text TEXT`);
      }
      version = 7;
      setUserVersion(db, version);
    }
  });

  migrate();
}

function initKnowledgeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_claims (
      id TEXT PRIMARY KEY,
      entity_id TEXT,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      importance REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      source_type TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (entity_id) REFERENCES knowledge_entities(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_claims_entity_status_updated
      ON knowledge_claims(entity_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS knowledge_evidence_refs (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      conversation_id TEXT,
      thread_id TEXT,
      message_id TEXT,
      agent_run_id TEXT,
      excerpt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (claim_id) REFERENCES knowledge_claims(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_evidence_refs_claim_id
      ON knowledge_evidence_refs(claim_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_claim_fts USING fts5(
      claim_id UNINDEXED,
      entity_name,
      claim_text,
      evidence_text,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
}
