import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { migrateKnowledgeDb } from '../../../src/main/knowledge/knowledge-db.ts'
import { KnowledgeStore } from '../../../src/main/knowledge/knowledge-store.ts'
import { KnowledgeRetrievalService } from '../../../src/main/knowledge/knowledge-retrieval-service.ts'
import { KnowledgeTraceService } from '../../../src/main/knowledge/knowledge-trace-service.ts'
import { createKnowledgeSearchTool, createKnowledgeTraceTool } from '../../../src/main/tools/knowledge-tools.ts'

test('createKnowledgeSearchTool returns active tool and searches claims successfully', async () => {
  const db = new Database(':memory:')
  migrateKnowledgeDb(db)
  const store = new KnowledgeStore(db)

  // 1. Populate some test data
  const entityId = store.upsertEntity({
    type: 'project',
    canonicalName: 'PiAgent'
  })

  const claimId = store.insertClaim({
    entityId,
    kind: 'fact',
    text: 'PiAgent has a powerful L1/L2 knowledge memory layer',
    confidence: 0.95,
    importance: 0.8
  })

  store.attachEvidence({
    claimId,
    sourceKind: 'manual',
    sourceRef: 'doc-1',
    excerpt: 'Documentation about memory layer'
  })

  const retrievalService = new KnowledgeRetrievalService(store)
  const tool = createKnowledgeSearchTool(retrievalService)

  assert.equal(tool.name, 'knowledgeSearchTool')

  // 2. Perform a successful search
  const resultSuccess = (await tool.execute(
    'call-1',
    { query: 'memory layer' },
    undefined,
    undefined,
    {} as any
  )) as any
  assert.ok(resultSuccess.content)
  assert.equal(resultSuccess.content[0].type, 'text')
  assert.ok(resultSuccess.content[0].text.includes('L1/L2 knowledge memory layer'))
  assert.ok(resultSuccess.content[0].text.includes('Documentation about memory layer'))
  assert.equal(resultSuccess.details.count, 1)
  assert.equal(resultSuccess.details.items[0].claimId, claimId)

  // 3. Perform a missing search
  const resultEmpty = (await tool.execute(
    'call-2',
    { query: 'nonexistent' },
    undefined,
    undefined,
    {} as any
  )) as any
  assert.ok(resultEmpty.content[0].text.includes('No knowledge items found'))
  assert.equal(resultEmpty.details.count, 0)
})

test('createKnowledgeTraceTool returns active tool and traces claims back to origin', async () => {
  const db = new Database(':memory:')
  migrateKnowledgeDb(db)
  const store = new KnowledgeStore(db)

  const entityId = store.upsertEntity({
    type: 'person',
    canonicalName: 'Eve'
  })

  const claimId = store.insertClaim({
    entityId,
    kind: 'preference',
    text: 'Eve prefers dark mode',
    confidence: 0.9,
    importance: 0.7
  })

  store.attachEvidence({
    claimId,
    sourceKind: 'conversation',
    sourceRef: 'conv-123',
    excerpt: 'I like dark theme'
  })

  const traceService = new KnowledgeTraceService(store)
  const tool = createKnowledgeTraceTool(traceService)

  assert.equal(tool.name, 'knowledgeTraceTool')

  // 1. Trace existing claim
  const resultSuccess = (await tool.execute(
    'call-3',
    { claimId },
    undefined,
    undefined,
    {} as any
  )) as any
  assert.ok(resultSuccess.content)
  assert.ok(resultSuccess.content[0].text.includes('Eve prefers dark mode'))
  assert.ok(resultSuccess.content[0].text.includes('I like dark theme'))
  assert.equal(resultSuccess.details.found, true)

  // 2. Trace non-existing claim
  const resultMissing = (await tool.execute(
    'call-4',
    { claimId: 'non-existing-id' },
    undefined,
    undefined,
    {} as any
  )) as any
  assert.ok(resultMissing.content[0].text.includes('Claim not found or untraceable'))
  assert.equal(resultMissing.details.found, false)
})
