import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, extname, resolve } from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolve(repoRoot, 'tests/main/runtime-host/electron-stub.mjs')).href
      };
    }
    if (specifier.startsWith('@shared/')) {
      const sharedPath = resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`);
      return {
        shortCircuit: true,
        url: pathToFileURL(sharedPath).href
      };
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:')
        ? fileURLToPath(context.parentURL)
        : ''
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) {
        return nextResolve(`${specifier}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  }
});

const { migrateKnowledgeDb } = await import('../../../src/main/knowledge/knowledge-db.ts');
const { KnowledgeStore } = await import('../../../src/main/knowledge/knowledge-store.ts');
const { KnowledgeIngestionService } = await import('../../../src/main/knowledge/knowledge-ingestion-service.ts');
const { setSetting } = await import('../../../src/main/db/config-db.ts');
const { DeterministicKnowledgeRelationExtractor } = await import('../../../src/main/knowledge/claim-extractor.ts');
import type { KnowledgeClaimCandidate, KnowledgeClaimExtractor } from '../../../src/main/knowledge/claim-extractor.ts';
import type { KnowledgeEpisode } from '../../../src/main/knowledge/episode-builder.ts';

const makeEpisode = (overrides: Partial<KnowledgeEpisode>): KnowledgeEpisode => ({
  conversationId: 'c1',
  threadId: 't1',
  agentRunId: null,
  workspacePath: null,
  userText: '',
  assistantText: '',
  toolSummaries: '',
  sourceMessageIds: [],
  createdAt: new Date().toISOString(),
  ...overrides
});

class MockClaimExtractor implements KnowledgeClaimExtractor {
  constructor(private readonly candidates: KnowledgeClaimCandidate[]) {}

  async extractClaims(_episode: KnowledgeEpisode): Promise<KnowledgeClaimCandidate[]> {
    return this.candidates;
  }
}

// Stub embedding engine for isolated testing
class StubEmbeddingEngine {
  constructor(private readonly mockVectors: Record<string, Float32Array>) {}

  async initialize() {}
  async embed(text: string) {
    return this.mockVectors[text] || new Float32Array(384);
  }
  async embedBatch(texts: string[]) {
    return texts.map(t => this.mockVectors[t] || new Float32Array(384));
  }
  cosineSimilarity() { return 0; }
  dispose() {}
}

test('KnowledgeIngestionService correctly extracts and persists entities, claims, and evidences', async () => {
  const db = new Database(':memory:');
  migrateKnowledgeDb(db);
  const store = new KnowledgeStore(db);

  const candidates: KnowledgeClaimCandidate[] = [
    {
      entityType: 'project',
      entityName: 'PiAgent',
      kind: 'fact',
      text: 'PiAgent 的记忆模块当前没有接入',
      confidence: 0.85,
      importance: 0.7,
      evidenceExcerpt: 'PiAgent 的记忆模块当前没有接入'
    },
    {
      entityType: 'person',
      entityName: '用户',
      kind: 'preference',
      text: '用户希望知识可反查来源',
      confidence: 0.9,
      importance: 0.8,
      evidenceExcerpt: '用户希望知识可反查来源'
    },
    {
      entityType: 'person',
      entityName: '用户2',
      kind: 'preference',
      text: '低置信度的claim',
      confidence: 0.2, // should be skipped because confidence < 0.35
      importance: 0.5,
      evidenceExcerpt: '低置信度的claim'
    }
  ];

  const extractor = new MockClaimExtractor(candidates);
  const service = new KnowledgeIngestionService(store, extractor);

  const episode: KnowledgeEpisode = {
    conversationId: 'conv-abc',
    threadId: 'thread-xyz',
    agentRunId: 'run-123',
    workspacePath: '/path/to/PiAgent',
    userText: '用户希望知识可反查来源',
    assistantText: 'PiAgent 的记忆模块当前没有接入',
    toolSummaries: '',
    sourceMessageIds: ['m1', 'm2'],
    createdAt: new Date().toISOString()
  };

  const result = await service.ingestEpisode(episode);
  assert.equal(result.insertedClaims, 2);
  assert.equal(result.skippedClaims, 1);

  // Verify search
  const searchResults = store.searchClaims({ query: '反查来源' });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].entityName, '用户');
  assert.equal(searchResults[0].text, '用户希望知识可反查来源');
  assert.equal(searchResults[0].evidencePreview, '用户希望知识可反查来源');
});

test('KnowledgeIngestionService correctly extracts and persists relations', async () => {
  const db = new Database(':memory:');
  migrateKnowledgeDb(db);
  const store = new KnowledgeStore(db);

  const candidates: KnowledgeClaimCandidate[] = [
    {
      entityType: 'person',
      entityName: 'Alice',
      kind: 'fact',
      text: 'Alice 负责 PiAgent 核心重构',
      confidence: 0.9,
      importance: 0.8,
      evidenceExcerpt: 'Alice 负责 PiAgent 核心重构'
    }
  ];

  const extractor = new MockClaimExtractor(candidates);
  const service = new KnowledgeIngestionService(store, extractor);

  const episode: KnowledgeEpisode = {
    conversationId: 'conv-abc',
    threadId: 'thread-xyz',
    agentRunId: 'run-123',
    workspacePath: '/path/to/PiAgent',
    userText: 'Alice 负责 PiAgent 核心重构',
    assistantText: '好的',
    toolSummaries: '',
    sourceMessageIds: ['m1'],
    createdAt: new Date().toISOString()
  };

  const result = await service.ingestEpisode(episode);
  assert.equal(result.insertedClaims, 1);
  assert.equal(result.insertedRelations, 1);

  // Retrieve relations
  const person = db.prepare("SELECT id FROM knowledge_entities WHERE canonical_name = 'Alice'").get() as any;
  assert.ok(person);
  const relations = store.getRelationsForEntity(person.id);
  assert.equal(relations.length, 1);
  assert.equal(relations[0].relationType, 'works_on');
  assert.equal(relations[0].fromEntityId, person.id);

  const project = db.prepare("SELECT id FROM knowledge_entities WHERE canonical_name = 'PiAgent'").get() as any;
  assert.ok(project);
  assert.equal(relations[0].toEntityId, project.id);
});

test('KnowledgeIngestionService vector deduplication and LLM merge decisions', async (t) => {
  setSetting('tool_model', 'openai::gpt-4o');

  await t.test('handles extreme identical match (>0.95 cosine similarity)', async () => {
    const db = new Database(':memory:');
    migrateKnowledgeDb(db);
    const store = new KnowledgeStore(db);

    // Initial claim
    const entityId = store.upsertEntity({ type: 'project', canonicalName: 'PiAgent' });
    const claimId1 = store.insertClaim({ entityId, kind: 'fact', text: 'PiAgent uses SQLite' });
    
    const vec1 = new Float32Array(Array(384).fill(0));
    vec1[0] = 1.0;
    store.insertVector(claimId1, 'claim', vec1);

    // New candidate with the exact same vector (representing cosine similarity = 1.0)
    const candidates = [
      {
        entityType: 'project' as any,
        entityName: 'PiAgent',
        kind: 'fact' as any,
        text: 'PiAgent uses SQLite',
        confidence: 0.9,
        importance: 0.7,
        evidenceExcerpt: 'Newer SQLite assertion'
      }
    ];

    const stubEngine = new StubEmbeddingEngine({ 'PiAgent uses SQLite': vec1 });
    const extractor = new MockClaimExtractor(candidates);
    const service = new KnowledgeIngestionService(store, extractor, new DeterministicKnowledgeRelationExtractor(), {
      embeddingEngine: stubEngine as any
    });

    const episode = makeEpisode({
      userText: 'PiAgent uses SQLite'
    });

    const result = await service.ingestEpisode(episode);
    
    // Should skip insert, so insertedClaims is 0, skippedClaims is 1
    assert.equal(result.insertedClaims, 0);
    assert.equal(result.skippedClaims, 1);

    // Should append supporting evidence reference to claimId1
    const trace = store.traceClaim(claimId1);
    assert.ok(trace);
    assert.equal(trace.evidenceRefs.length, 1);
    assert.equal(trace.evidenceRefs[0].excerpt, 'Newer SQLite assertion');
  });

  await t.test('handles close overlap (>0.78 cosine similarity) with LLM UPDATE decision', async () => {
    const db = new Database(':memory:');
    migrateKnowledgeDb(db);
    const store = new KnowledgeStore(db);

    // Initial claim: Node 18
    const entityId = store.upsertEntity({ type: 'project', canonicalName: 'PiAgent' });
    const claimId1 = store.insertClaim({ entityId, kind: 'fact', text: 'PiAgent uses Node 18' });
    
    const vec1 = new Float32Array(Array(384).fill(0));
    vec1[5] = 1.0;
    store.insertVector(claimId1, 'claim', vec1);

    // New candidate: Node 22 (similar but slightly different, simulated cosine similarity = 0.8)
    const candidates = [
      {
        entityType: 'project' as any,
        entityName: 'PiAgent',
        kind: 'fact' as any,
        text: 'PiAgent upgraded to Node 22',
        confidence: 0.9,
        importance: 0.8,
        evidenceExcerpt: 'upgrade to Node 22'
      }
    ];

    // Simulating dot product is 0.8 (vec1[5] * queryVec[5] = 0.8)
    const queryVec = new Float32Array(Array(384).fill(0));
    queryVec[5] = 0.8; 

    const stubEngine = new StubEmbeddingEngine({ 'PiAgent upgraded to Node 22': queryVec });
    const extractor = new MockClaimExtractor(candidates);

    // Mock runOneShotText for UPDATE decision
    const mockRunOneShot = async () => {
      return {
        modelKey: 'openai::gpt-4o',
        text: `
        [
          {
            "id": "${claimId1}",
            "action": "UPDATE",
            "mergedText": "PiAgent uses Node 22 (upgraded from Node 18)"
          }
        ]
        `
      };
    };

    const service = new KnowledgeIngestionService(store, extractor, new DeterministicKnowledgeRelationExtractor(), {
      embeddingEngine: stubEngine as any,
      runOneShotText: mockRunOneShot
    });

    const episode = makeEpisode({
      userText: 'PiAgent upgraded to Node 22'
    });

    const result = await service.ingestEpisode(episode);
    
    // Shoud insert 1, skip 0
    assert.equal(result.insertedClaims, 1);
    assert.equal(result.skippedClaims, 0);

    // Check old claim status
    const oldClaim = db.prepare('SELECT status, superseded_by FROM knowledge_claims WHERE id = ?').get(claimId1) as any;
    assert.equal(oldClaim.status, 'superseded');

    // Check new claim
    const activeClaims = store.searchClaims({ query: 'Node 22' });
    assert.equal(activeClaims.length, 1);
    assert.equal(activeClaims[0].text, 'PiAgent uses Node 22 (upgraded from Node 18)');
  });
});
