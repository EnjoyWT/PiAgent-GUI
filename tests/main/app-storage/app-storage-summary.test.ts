import test from 'node:test'
import assert from 'node:assert/strict'
import { getAppStorageSummary } from '../../../src/main/app-storage/app-storage-summary.ts'

test('includes SQLite database, WAL and SHM sizes in the matching database total', async () => {
  const sizes = new Map<string, number>([
    ['/data/core-v2.db', 10],
    ['/data/core-v2.db-wal', 4],
    ['/data/core-v2.db-shm', 2]
  ])

  const summary = await getAppStorageSummary('/data', {
    stat: async (filePath) => ({ size: sizes.get(filePath) ?? 0 })
  })

  assert.equal(summary.conversationDatabase.totalBytes, 16)
  assert.equal(summary.totalBytes, 16)
})

test('keeps a missing database at zero without preventing other results', async () => {
  const summary = await getAppStorageSummary('/data', {
    stat: async (filePath) => {
      if (filePath.includes('context.db')) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
      return { size: 8 }
    }
  })

  assert.equal(
    summary.databases.find((item) => item.fileName === 'context.db')?.totalBytes,
    0
  )
  assert.equal(summary.totalBytes > 0, true)
})

test('marks a database unavailable when its size cannot be read', async () => {
  const summary = await getAppStorageSummary('/data', {
    stat: async (filePath) => {
      if (filePath.startsWith('/data/core-v2.db')) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
      return { size: 0 }
    }
  })

  assert.equal(summary.conversationDatabase.unavailable, true)
})
