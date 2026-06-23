import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import { CONTEXT_SCHEMA_VERSION, migrateContextSchema } from './context-db.ts'

let _db: Database.Database | null = null

const getUserVersion = (db: Database.Database): number =>
  db.pragma('user_version', { simple: true }) as number

const setUserVersion = (db: Database.Database, version: number): void => {
  db.pragma(`user_version = ${version}`)
}

export function getContextDb(): Database.Database {
  if (_db) return _db
  const dbPath = path.join(app.getPath('userData'), 'context.db')
  const db = new Database(dbPath)
  try {
    db.pragma('journal_mode = WAL')
    const version = getUserVersion(db)
    migrateContextSchema(db)
    if (version < CONTEXT_SCHEMA_VERSION) {
      setUserVersion(db, CONTEXT_SCHEMA_VERSION)
    }
    _db = db
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
