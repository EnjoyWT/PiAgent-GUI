import { stat as readFileStat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppStorageDatabaseSummary, AppStorageSummary } from '../../shared/app-storage.ts'

const DATABASES = [
  { fileName: 'core-v2.db', label: '对话数据库' },
  { fileName: 'context.db', label: '上下文数据库' },
  { fileName: 'knowledge.db', label: '知识库数据库' },
  { fileName: 'config.db', label: '配置数据库' }
] as const

type FileStat = { size: number }
type Stat = (filePath: string) => Promise<FileStat>

type GetAppStorageSummaryDependencies = {
  stat?: Stat
}

type FileSize = {
  bytes: number
  unavailable: boolean
}

const readSize = async (filePath: string, stat: Stat): Promise<FileSize> => {
  try {
    const result = await stat(filePath)
    return { bytes: Math.max(0, result.size), unavailable: false }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { bytes: 0, unavailable: false }
    }
    return { bytes: 0, unavailable: true }
  }
}

export const getAppStorageSummary = async (
  userDataPath: string,
  dependencies: GetAppStorageSummaryDependencies = {}
): Promise<AppStorageSummary> => {
  const stat = dependencies.stat ?? readFileStat
  const databases = await Promise.all(
    DATABASES.map(async ({ fileName, label }): Promise<AppStorageDatabaseSummary> => {
      const basePath = join(userDataPath, fileName)
      const [database, wal, shm] = await Promise.all([
        readSize(basePath, stat),
        readSize(`${basePath}-wal`, stat),
        readSize(`${basePath}-shm`, stat)
      ])
      const sidecarBytes = wal.bytes + shm.bytes
      return {
        fileName,
        label,
        databaseBytes: database.bytes,
        sidecarBytes,
        totalBytes: database.bytes + sidecarBytes,
        unavailable: database.unavailable || wal.unavailable || shm.unavailable
      }
    })
  )
  const conversationDatabase = databases[0]

  return {
    userDataPath,
    conversationDatabase,
    databases,
    totalBytes: databases.reduce((total, database) => total + database.totalBytes, 0),
    unavailable: databases.some((database) => database.unavailable)
  }
}
