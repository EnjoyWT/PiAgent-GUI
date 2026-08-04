import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { configureCoreV2Db } from '../../../src/main/core-v2/sqlite-db.ts'

test('core database configures a short busy timeout for maintenance writer contention', () => {
  const db = new Database(':memory:')
  try {
    configureCoreV2Db(db)
    assert.equal(db.pragma('busy_timeout', { simple: true }), 1_000)
  } finally {
    db.close()
  }
})
