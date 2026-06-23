import Database from 'better-sqlite3'
import { migrateContextSchema } from '../../../src/main/context/context-db.ts'

export const createContextTestDb = (): Database.Database => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      title TEXT,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT
    );
  `)
  migrateContextSchema(db)
  return db
}

export const insertThread = (db: Database.Database, threadId: string): void => {
  db.prepare(
    `
      INSERT INTO threads (id, workspace_path, model)
      VALUES (?, '/tmp/workspace', 'test-model')
    `
  ).run(threadId)
}
