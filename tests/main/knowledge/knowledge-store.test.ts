import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { migrateKnowledgeDb } from '../../../src/main/knowledge/knowledge-db.ts'
import { KnowledgeStore } from '../../../src/main/knowledge/knowledge-store.ts'

function createTestStore() {
  const db = new Database(':memory:')
  migrateKnowledgeDb(db)
  const store = new KnowledgeStore(db)
  return { db, store }
}

test('KnowledgeStore upsertEntity handles stable slug, merge aliases, and updates timestamp', () => {
  const { db, store } = createTestStore()
  try {
    const id1 = store.upsertEntity({
      type: 'project',
      canonicalName: 'PiAgent',
      aliases: ['pi-agent', 'pi'],
      summary: 'Main project'
    })

    const id2 = store.upsertEntity({
      type: 'project',
      canonicalName: 'PiAgent',
      aliases: ['pi', 'piagent-core'],
      summary: 'Updated main project'
    })

    assert.equal(id1, id2)

    const row = db.prepare('SELECT * FROM knowledge_entities WHERE id = ?').get(id1) as any
    assert.equal(row.canonical_name, 'PiAgent')
    assert.equal(row.summary, 'Updated main project')

    const aliases = JSON.parse(row.aliases_json)
    assert.deepEqual(aliases.sort(), ['pi-agent', 'pi', 'piagent-core'].sort())
  } finally {
    db.close()
  }
})

test('KnowledgeStore insertClaim and attachEvidence populate database and FTS indexes', () => {
  const { db, store } = createTestStore()
  try {
    const entityId = store.upsertEntity({
      type: 'person',
      canonicalName: '张三'
    })

    const claimId = store.insertClaim({
      entityId,
      kind: 'preference',
      text: '张三不喜欢长篇大论的回答',
      confidence: 0.9,
      importance: 0.8
    })

    store.attachEvidence({
      claimId,
      sourceKind: 'message',
      sourceRef: 'msg-1',
      excerpt: '我平时比较喜欢简短的信息，不喜欢那种长篇大论'
    })

    // Search by claim content
    const search1 = store.searchClaims({ query: '长篇大论' })
    assert.equal(search1.length, 1)
    assert.equal(search1[0].claimId, claimId)
    assert.equal(search1[0].entityName, '张三')
    assert.equal(search1[0].evidencePreview, '我平时比较喜欢简短的信息，不喜欢那种长篇大论')

    // Search by entity name
    const search2 = store.searchClaims({ query: '张三' })
    assert.equal(search2.length, 1)
    assert.equal(search2[0].claimId, claimId)

    // Search by evidence text
    const search3 = store.searchClaims({ query: '简短信息' })
    assert.equal(search3.length, 1)
  } finally {
    db.close()
  }
})

test('KnowledgeStore traceClaim returns claim details, related entity, and evidences', () => {
  const { db, store } = createTestStore()
  try {
    const entityId = store.upsertEntity({
      type: 'project',
      canonicalName: 'PiAgent'
    })

    const claimId = store.insertClaim({
      entityId,
      kind: 'fact',
      text: 'PiAgent can search its memory'
    })

    store.attachEvidence({
      claimId,
      sourceKind: 'manual',
      sourceRef: 'doc-1',
      excerpt: 'First evidence of memory search capability'
    })

    store.attachEvidence({
      claimId,
      sourceKind: 'run',
      sourceRef: 'run-123',
      excerpt: 'Second evidence from runtime trace'
    })

    const trace = store.traceClaim(claimId)
    assert.ok(trace)
    assert.equal(trace.claim.id, claimId)
    assert.equal(trace.claim.text, 'PiAgent can search its memory')
    assert.equal(trace.entity?.canonicalName, 'PiAgent')
    assert.equal(trace.evidenceRefs.length, 2)
    assert.equal(trace.evidenceRefs[0].sourceRef, 'run-123') // newest first
    assert.equal(trace.evidenceRefs[1].sourceRef, 'doc-1')

    const nonExistentTrace = store.traceClaim('not-exist')
    assert.equal(nonExistentTrace, null)
  } finally {
    db.close()
  }
})

test('KnowledgeStore insertRelation and getRelationsForEntity handle relationship operations', () => {
  const { db, store } = createTestStore()
  try {
    const fromId = store.upsertEntity({
      type: 'person',
      canonicalName: 'Alice'
    })

    const toId = store.upsertEntity({
      type: 'project',
      canonicalName: 'PiAgent'
    })

    const claimId = store.insertClaim({
      entityId: fromId,
      kind: 'fact',
      text: 'Alice is working on PiAgent'
    })

    const relationId = store.insertRelation({
      fromEntityId: fromId,
      toEntityId: toId,
      relationType: 'works_on',
      confidence: 0.95,
      evidenceClaimId: claimId
    })

    const relationsFrom = store.getRelationsForEntity(fromId)
    assert.equal(relationsFrom.length, 1)
    assert.equal(relationsFrom[0].id, relationId)
    assert.equal(relationsFrom[0].fromEntityId, fromId)
    assert.equal(relationsFrom[0].toEntityId, toId)
    assert.equal(relationsFrom[0].relationType, 'works_on')
    assert.equal(relationsFrom[0].confidence, 0.95)
    assert.equal(relationsFrom[0].evidenceClaimId, claimId)

    const relationsTo = store.getRelationsForEntity(toId)
    assert.equal(relationsTo.length, 1)
    assert.equal(relationsTo[0].id, relationId)
  } finally {
    db.close()
  }
})

test('KnowledgeStore insertReflection and getReflectionsForEntity handle reflections operations', () => {
  const { db, store } = createTestStore()
  try {
    const entityId = store.upsertEntity({
      type: 'person',
      canonicalName: 'Alice'
    })

    const claimId1 = store.insertClaim({
      entityId,
      kind: 'preference',
      text: 'Alice prefers coffee over tea'
    })

    const claimId2 = store.insertClaim({
      entityId,
      kind: 'preference',
      text: 'Alice usually drinks espresso'
    })

    const reflectionId = store.insertReflection({
      entityId,
      reflectionType: 'person_profile',
      title: 'Alice drink preference summary',
      body: 'Alice is a coffee lover who prefers espresso over tea.',
      sourceClaimIds: [claimId1, claimId2],
      confidence: 0.9
    })

    const reflections = store.getReflectionsForEntity(entityId)
    assert.equal(reflections.length, 1)
    assert.equal(reflections[0].id, reflectionId)
    assert.equal(reflections[0].entityId, entityId)
    assert.equal(reflections[0].reflectionType, 'person_profile')
    assert.equal(reflections[0].title, 'Alice drink preference summary')
    assert.equal(reflections[0].body, 'Alice is a coffee lover who prefers espresso over tea.')
    assert.deepEqual(reflections[0].sourceClaimIds, [claimId1, claimId2])
    assert.equal(reflections[0].confidence, 0.9)
  } finally {
    db.close()
  }
})

test('KnowledgeStore vector storage, similarity search, and claim status updates', () => {
  const { db, store } = createTestStore()
  try {
    const entityId = store.upsertEntity({
      type: 'project',
      canonicalName: 'PiAgent'
    })

    const claimId1 = store.insertClaim({
      entityId,
      kind: 'fact',
      text: 'PiAgent using SQLite'
    })

    const claimId2 = store.insertClaim({
      entityId,
      kind: 'fact',
      text: 'PiAgent supports vector search'
    })

    // Mock 3-dim normalized vectors for simplicity
    const vec1 = new Float32Array(Array(384).fill(0));
    vec1[0] = 1.0; // [1.0, 0, 0, ...]
    
    const vec2 = new Float32Array(Array(384).fill(0));
    vec2[1] = 1.0; // [0, 1.0, 0, ...]

    store.insertVector(claimId1, 'claim', vec1);
    store.insertVector(claimId2, 'claim', vec2);

    // Search query similar to vec1 (dot product with vec1 is 1.0, vec2 is 0.0)
    const queryVec = new Float32Array(Array(384).fill(0));
    queryVec[0] = 1.0;

    const results = store.searchByEmbedding(queryVec, entityId, 10);
    assert.equal(results.length, 2);
    assert.equal(results[0].id, claimId1);
    assert.equal(results[0].score, 1.0);
    assert.equal(results[1].id, claimId2);
    assert.equal(results[1].score, 0.0);

    // Test updateClaimStatus to supersede claimId1 with claimId2
    store.updateClaimStatus(claimId1, 'superseded', claimId2);

    const row = db.prepare('SELECT status, superseded_by FROM knowledge_claims WHERE id = ?').get(claimId1) as any;
    assert.equal(row.status, 'superseded');
    assert.equal(row.superseded_by, claimId2);

    // After claimId1 is superseded, searchByEmbedding (which filters where c.status = 'active') should only return claimId2!
    const resultsAfterSupersede = store.searchByEmbedding(queryVec, entityId, 10);
    assert.equal(resultsAfterSupersede.length, 1);
    assert.equal(resultsAfterSupersede[0].id, claimId2);
  } finally {
    db.close()
  }
})
