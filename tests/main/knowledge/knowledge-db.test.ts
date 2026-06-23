import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { migrateKnowledgeDb } from '../../../src/main/knowledge/knowledge-db.ts'

test('migrateKnowledgeDb creates knowledge tables and fts table', () => {
  const db = new Database(':memory:')
  try {
    migrateKnowledgeDb(db)
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name`)
      .all()
      .map((row) => String((row as { name: string }).name))

    assert.ok(tables.includes('knowledge_entities'))
    assert.ok(tables.includes('knowledge_claims'))
    assert.ok(tables.includes('knowledge_evidence_refs'))
    assert.ok(tables.includes('knowledge_claim_fts'))
    assert.ok(tables.includes('knowledge_jobs'))
    assert.ok(tables.includes('knowledge_relations'))
    assert.ok(tables.includes('knowledge_reflections'))
    assert.ok(tables.includes('knowledge_vectors'))
  } finally {
    db.close()
  }
})
