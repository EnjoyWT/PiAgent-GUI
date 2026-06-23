import path from 'node:path'
import Database from 'better-sqlite3'
import * as electron from 'electron'
import { SqliteCoreService } from './sqlite-core-service.ts'
import { reconcileInterruptedRunsOnStartup } from './startup-run-recovery.ts'
import { migrateCoreV2Schema } from './storage-schema.ts'

let dbSingleton: Database.Database | null = null
let serviceSingleton: SqliteCoreService | null = null

const getElectronApp = () => (electron as any).app ?? (electron as any).default?.app

export const getDefaultCoreV2DbPath = (): string => {
  const app = getElectronApp()
  const baseDir =
    app && typeof app.getPath === 'function'
      ? app.getPath('userData')
      : String(process.env.PIAGENT_USER_DATA_DIR ?? process.cwd())
  return path.join(baseDir, 'core-v2.db')
}

export const createCoreV2Db = (dbPath: string): Database.Database => {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrateCoreV2Schema(db)
  return db
}

export const getCoreV2Db = (): Database.Database => {
  if (dbSingleton) return dbSingleton
  dbSingleton = createCoreV2Db(getDefaultCoreV2DbPath())
  return dbSingleton
}

export const getCoreV2Service = (): SqliteCoreService => {
  if (serviceSingleton) return serviceSingleton
  serviceSingleton = new SqliteCoreService(getCoreV2Db(), { migrate: false })
  try {
    const recovered = reconcileInterruptedRunsOnStartup(serviceSingleton)
    if (recovered.abortedRunIds.length > 0 || recovered.cancelledInteractionIds.length > 0) {
      console.warn(
        '[core-v2] recovered interrupted startup state',
        JSON.stringify({
          abortedRuns: recovered.abortedRunIds.length,
          cancelledInteractions: recovered.cancelledInteractionIds.length,
          recoveredAt: recovered.recoveredAt
        })
      )
    }
  } catch (error) {
    console.error('[core-v2] recover interrupted startup state failed', error)
  }
  return serviceSingleton
}

export const setCoreV2Service = (service: SqliteCoreService | null): void => {
  serviceSingleton = service;
}

export const closeCoreV2Db = (): void => {
  serviceSingleton = null
  if (!dbSingleton) return
  dbSingleton.close()
  dbSingleton = null
}
