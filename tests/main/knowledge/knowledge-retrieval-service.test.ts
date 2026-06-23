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
const { KnowledgeRetrievalService } = await import('../../../src/main/knowledge/knowledge-retrieval-service.ts');

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

test('KnowledgeRetrievalService searches, filters, and limits claims with RRF multi-channel fusion', async (t) => {
  const db = new Database(':memory:');
  migrateKnowledgeDb(db);
  const store = new KnowledgeStore(db);

  const mockVectors: Record<string, Float32Array> = {};
  const stubEngine = new StubEmbeddingEngine(mockVectors);
  const service = new KnowledgeRetrievalService(store, stubEngine as any);

  const entityProj = store.upsertEntity({ type: 'project', canonicalName: 'PiAgent' });
  const entityPers = store.upsertEntity({ type: 'person', canonicalName: '张三' });

  const claimId1 = store.insertClaim({
    entityId: entityProj,
    kind: 'fact',
    text: 'PiAgent runs locally on Darwin'
  });

  const claimId2 = store.insertClaim({
    entityId: entityPers,
    kind: 'preference',
    text: '张三 prefers short sentences'
  });

  // Setup mock vector coordinates for vector search channel
  const vec1 = new Float32Array(Array(384).fill(0));
  vec1[0] = 1.0;
  mockVectors['Darwin'] = vec1;
  store.insertVector(claimId1, 'claim', vec1);

  const vec2 = new Float32Array(Array(384).fill(0));
  vec2[1] = 1.0;
  mockVectors['sentences'] = vec2;
  store.insertVector(claimId2, 'claim', vec2);

  await t.test('empty query returns empty results', async () => {
    const resEmpty = await service.search({ query: '   ' });
    assert.equal(resEmpty.items.length, 0);
  });

  await t.test('returns results from FTS channel', async () => {
    const resAll = await service.search({ query: 'PiAgent' });
    assert.equal(resAll.items.length, 1);
    assert.equal(resAll.items[0].entityName, 'PiAgent');
  });

  await t.test('filters results by entityType constraint', async () => {
    // prefers matches Zhang San, who is person. Searching with entityType: project should filter it out
    const resFiltered = await service.search({ query: 'prefers', entityType: 'project' });
    assert.equal(resFiltered.items.length, 0);

    const resFilteredOk = await service.search({ query: 'prefers', entityType: 'person' });
    assert.equal(resFilteredOk.items.length, 1);
    assert.equal(resFilteredOk.items[0].entityName, '张三');
  });

  await t.test('merges vector channel results', async () => {
    // "Darwin" will retrieve vec1 coordinates because of stub vectors
    const resVector = await service.search({ query: 'Darwin' });
    assert.ok(resVector.items.length >= 1);
    assert.equal(resVector.items[0].claimId, claimId1);
  });

  await t.test('matches entities by name in Entity channel', async () => {
    // "张三" will trigger Entity channel name lookup
    const resEntity = await service.search({ query: '张三' });
    assert.ok(resEntity.items.length >= 1);
    assert.equal(resEntity.items[0].claimId, claimId2);
  });
});
