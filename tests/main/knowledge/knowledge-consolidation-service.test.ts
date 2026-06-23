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
      return {
        shortCircuit: true,
        url: pathToFileURL(resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`)).href
      };
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : '';
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) {
        return nextResolve(`${specifier}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  }
});

const { migrateKnowledgeDb } = await import('../../../src/main/knowledge/knowledge-db.ts');
const { KnowledgeStore } = await import('../../../src/main/knowledge/knowledge-store.ts');
const { PatternConsolidationService, ProfileMaintenanceService, KnowledgeConsolidationService } = await import('../../../src/main/knowledge/knowledge-consolidation-service.ts');
const { KnowledgeInjectionService } = await import('../../../src/main/knowledge/knowledge-injection-service.ts');

const setup = () => {
  const db = new Database(':memory:');
  migrateKnowledgeDb(db);
  return new KnowledgeStore(db);
};

test('PatternConsolidationService can consolidate from two active claims for automatic L2 creation', async () => {
  const store = setup();
  const entityId = store.upsertEntity({ type: 'project', canonicalName: 'PiAgent' });
  const c1 = store.insertClaim({ entityId, kind: 'constraint', text: '修改代码前必须先看现有测试', importance: 0.9 });
  const c2 = store.insertClaim({ entityId, kind: 'constraint', text: '修改后需要跑相关单元测试', importance: 0.9 });

  const service = new PatternConsolidationService(store, {
    runOneShotText: async () => null
  });

  assert.equal(await service.shouldConsolidate(entityId), true);
  const result = await service.consolidate(entityId);
  assert.equal(result.skipped, false);
  assert.equal(result.createdPatterns, 1);
  const patterns = store.getPatternsByEntity(entityId);
  assert.equal(patterns.length, 1);
  assert.deepEqual(new Set(patterns[0].sourceClaimIds), new Set([c1, c2]));
});

test('PatternConsolidationService consolidates claims into L2 pattern reflections', async () => {
  const store = setup();
  const entityId = store.upsertEntity({ type: 'project', canonicalName: 'PiAgent' });
  const c1 = store.insertClaim({ entityId, kind: 'constraint', text: '修改代码前必须先看现有测试', importance: 0.9 });
  const c2 = store.insertClaim({ entityId, kind: 'constraint', text: '修改后需要跑相关单元测试', importance: 0.9 });
  const c3 = store.insertClaim({ entityId, kind: 'preference', text: '用户偏好简洁回复', importance: 0.8 });

  const service = new PatternConsolidationService(store, {
    runOneShotText: async () => ({
      modelKey: 'mock::model',
      text: JSON.stringify([
        {
          title: '测试优先工作流',
          body: '处理 PiAgent 代码时，先阅读现有测试，改动后运行相关测试。',
          sourceClaimIds: [c1, c2],
          confidence: 0.88
        },
        {
          title: '回复风格',
          body: '用户偏好简洁、直接的回复。',
          sourceClaimIds: [c3],
          confidence: 0.8
        }
      ])
    }) as any
  });

  const result = await service.consolidate(entityId);
  assert.equal(result.createdPatterns, 2);
  const patterns = store.getPatternsByEntity(entityId);
  assert.equal(patterns.length, 2);
  assert.equal(patterns[0].reflectionType, 'pattern');
  assert.ok(patterns.some((p) => p.body.includes('运行相关测试')));
});

test('ProfileMaintenanceService creates L3 profile from patterns', async () => {
  const store = setup();
  const entityId = store.upsertEntity({ type: 'project', canonicalName: 'PiAgent' });
  store.replacePatterns(entityId, [
    {
      title: '测试优先工作流',
      body: '处理 PiAgent 代码时，先阅读现有测试，改动后运行相关测试。',
      sourceClaimIds: [],
      confidence: 0.88
    }
  ]);

  const service = new ProfileMaintenanceService(store, {
    runOneShotText: async () => ({
      modelKey: 'mock::model',
      text: '## PiAgent\n- 本项目遵循测试优先工作流。'
    }) as any
  });

  assert.equal(await service.shouldUpdateProfile(entityId), true);
  const result = await service.updateProfile(entityId);
  assert.equal(result.skipped, false);
  const profile = store.getLatestProfile(entityId);
  assert.equal(profile?.reflectionType, 'project_state');
  assert.ok(profile?.body.includes('测试优先工作流'));
});

test('KnowledgeConsolidationService falls back deterministically without model and injection reads reflections as L2', async () => {
  const store = setup();
  const entityId = store.upsertEntity({ type: 'self', canonicalName: 'user' });
  store.insertClaim({ entityId, kind: 'preference', text: '用户偏好短句回复', importance: 0.9 });
  store.insertClaim({ entityId, kind: 'preference', text: '用户不喜欢无意义流程化输出', importance: 0.8 });
  store.insertClaim({ entityId, kind: 'constraint', text: '小任务不要开启 plan tool', importance: 0.9 });

  const service = new KnowledgeConsolidationService(store, {
    runOneShotText: async () => null
  });
  const result = await service.consolidateEntity(entityId, { force: true });
  assert.ok(result.patternsCreated >= 1);
  assert.equal(result.profileUpdated, true);

  const injection = new KnowledgeInjectionService(store, { search: async () => ({ query: '', items: [] }) } as any, 1000);
  const packet = await injection.buildPacket('回复偏好', entityId);
  assert.ok(packet.profile?.includes('user'));
  assert.ok(packet.patterns.some((p) => p.includes('短句回复')));
});
