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
const { InjectionScheduler, InjectionRenderer, KnowledgeInjectionService } = await import(
  '../../../src/main/knowledge/knowledge-injection-service.ts'
);

class StubEmbeddingEngine {
  async initialize() {}
  async embed() { return new Float32Array(384); }
  async embedBatch() { return []; }
  cosineSimilarity() { return 0; }
  dispose() {}
}

test('InjectionScheduler triggers correctly', () => {
  const scheduler = new InjectionScheduler();

  // First message should inject
  assert.equal(scheduler.shouldInject({ isFirstMessage: true, turnsSinceLastInjection: 0, userMessage: 'Hello' }), true);

  // Mentioning keywords should inject
  assert.equal(scheduler.shouldInject({ isFirstMessage: false, turnsSinceLastInjection: 2, userMessage: '你还记得上次我说的事吗' }), true);

  // 8 turns since last injection should trigger
  assert.equal(scheduler.shouldInject({ isFirstMessage: false, turnsSinceLastInjection: 8, userMessage: 'Let us build' }), true);

  // Normal turn should skip
  assert.equal(scheduler.shouldInject({ isFirstMessage: false, turnsSinceLastInjection: 3, userMessage: 'Ok' }), false);
});

test('InjectionRenderer renders correctly', () => {
  const renderer = new InjectionRenderer();
  
  const packet = {
    profile: 'User loves clean code',
    patterns: ['Always write tests first', 'Prefers TS'],
    claims: ['Current SQLite DB has 5 tables'],
    totalTokens: 100
  };

  const rendered = renderer.render(packet);
  assert.ok(rendered.includes('<knowledge_memory>'));
  assert.ok(rendered.includes('## About This Context\nUser loves clean code'));
  assert.ok(rendered.includes('## Known Patterns & Preferences\n- Always write tests first\n- Prefers TS'));
  assert.ok(rendered.includes('## Relevant Facts\n- Current SQLite DB has 5 tables'));
  assert.ok(rendered.includes('</knowledge_memory>'));

  // Empty packet renders empty string
  assert.equal(renderer.render({ profile: null, patterns: [], claims: [], totalTokens: 0 }), '');
});

test('KnowledgeInjectionService builds packet with budget constraints', async () => {
  const db = new Database(':memory:');
  migrateKnowledgeDb(db);
  const store = new KnowledgeStore(db);
  const retrieval = new KnowledgeRetrievalService(store, new StubEmbeddingEngine() as any);
  
  const service = new KnowledgeInjectionService(store, retrieval, 500);

  // Setup entity
  const entityId = store.upsertEntity({ type: 'project', canonicalName: 'PiAgent' });

  // 1. Add L3 Profile (Reflection)
  store.insertReflection({
    entityId,
    reflectionType: 'project_state',
    title: 'PiAgent current status',
    body: 'PiAgent is a local developer agent.',
    confidence: 0.9,
    sourceClaimIds: []
  });

  // 2. Add L2 Patterns (Preference/Constraint/Skill claims)
  store.insertClaim({
    entityId,
    kind: 'constraint',
    text: 'Always run lint before commit',
    importance: 0.9
  });
  store.insertClaim({
    entityId,
    kind: 'preference',
    text: 'User prefers short variable names',
    importance: 0.8
  });

  // 3. Add L1 Claims (Fact claims)
  const claim1 = store.insertClaim({
    entityId,
    kind: 'fact',
    text: 'PiAgent uses electron as runtime'
  });
  const vec1 = new Float32Array(384);
  vec1[0] = 1.0;
  store.insertVector(claim1, 'claim', vec1);

  // Build packet for query 'runtime'
  const packet = await service.buildPacket('runtime', entityId);

  assert.equal(packet.profile, 'PiAgent is a local developer agent.');
  assert.deepEqual(packet.patterns, ['Always run lint before commit', 'User prefers short variable names']);
  
  // Note that since StubEmbeddingEngine returns all-zeros which we filter out (score <= 0.01),
  // L1 claims will be resolved by the FTS channel.
  // FTS query 'runtime' matches 'PiAgent uses electron as runtime'
  assert.deepEqual(packet.claims, ['PiAgent uses electron as runtime']);

  assert.ok(packet.totalTokens > 0);
  assert.ok(packet.totalTokens < 500);
});
