import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { migrateKnowledgeDb } from '../../../src/main/knowledge/knowledge-db.ts'
import { KnowledgeStore } from '../../../src/main/knowledge/knowledge-store.ts'
import { KnowledgeTraceService } from '../../../src/main/knowledge/knowledge-trace-service.ts'

test('KnowledgeTraceService traces claim to its source and returns null if not found', () => {
  const db = new Database(':memory:')
  migrateKnowledgeDb(db)
  const store = new KnowledgeStore(db)
  const service = new KnowledgeTraceService(store)

  const entityId = store.upsertEntity({ type: 'project', canonicalName: 'PiAgent' })
  const claimId = store.insertClaim({
    entityId,
    kind: 'fact',
    text: 'PiAgent runs locally on Darwin'
  })

  store.attachEvidence({
    claimId,
    sourceKind: 'manual',
    sourceRef: 'doc-1',
    excerpt: 'Darwin support'
  })

  const trace = service.trace({ claimId })
  assert.ok(trace)
  assert.equal(trace.claim.text, 'PiAgent runs locally on Darwin')
  assert.equal(trace.entity?.canonicalName, 'PiAgent')
  assert.equal(trace.evidenceRefs.length, 1)
  assert.equal(trace.evidenceRefs[0].excerpt, 'Darwin support')

  const traceNull = service.trace({ claimId: 'nonexistent' })
  assert.equal(traceNull, null)

  const traceEmpty = service.trace({ claimId: '' })
  assert.equal(traceEmpty, null)
})
