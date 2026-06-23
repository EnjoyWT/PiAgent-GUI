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
const { KnowledgeCaptureScheduler } = await import('../../../src/main/knowledge/knowledge-capture-scheduler.ts');
const { setCoreV2Service } = await import('../../../src/main/core-v2/sqlite-db.ts');

test('KnowledgeCaptureScheduler forces lightweight L2/L3 consolidation after capture', async () => {
  const db = new Database(':memory:');
  migrateKnowledgeDb(db);
  const mockCoreV2Service = {
    getConversationMessages: () => [
      { id: 'm1', role: 'user', text: '记住以后使用 Node 22', createdAt: '2026-05-26T00:00:00Z' }
    ]
  } as any;
  setCoreV2Service(mockCoreV2Service);

  const calls: any[] = [];
  const scheduler = new KnowledgeCaptureScheduler(
    db,
    { async ingestEpisode() { return { insertedClaims: 1, skippedClaims: 0, insertedRelations: 0, affectedEntityIds: ['entity-1'] }; } } as any,
    { async consolidateEntity(entityId: string, options: any) { calls.push({ entityId, options }); return { patternsCreated: 1, profileUpdated: true }; } } as any
  );

  scheduler.scheduleRun({ conversationId: 'conv-test', threadId: 'thread-test' });
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(calls, [{ entityId: 'entity-1', options: { force: true } }]);
  setCoreV2Service(null);
});

test('KnowledgeCaptureScheduler schedules, processes, and retries jobs', async () => {
  const db = new Database(':memory:');
  migrateKnowledgeDb(db);
  const store = new KnowledgeStore(db);

  // 1. Mock getConversationMessages via setCoreV2Service
  const mockMessages = [
    { id: 'm1', role: 'user', text: '记住以后使用 Node 22', createdAt: '2026-05-26T00:00:00Z' }
  ];
  const mockCoreV2Service = {
    getConversationMessages: (convId: string) => {
      assert.equal(convId, 'conv-test');
      return mockMessages;
    }
  } as any;

  setCoreV2Service(mockCoreV2Service);

  const ingestionService = new KnowledgeIngestionService(store);
  const scheduler = new KnowledgeCaptureScheduler(db, ingestionService);

  // 2. Schedule a successful job
  const jobId = scheduler.scheduleRun({
    conversationId: 'conv-test',
    threadId: 'thread-test',
    agentRunId: 'run-test',
    workspacePath: '/tmp/workspace'
  });

  // Wait a small bit for async pump to execute
  await new Promise((resolve) => setTimeout(resolve, 50));

  const jobs = scheduler.listJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, jobId);
  assert.equal(jobs[0].status, 'completed');
  assert.equal(jobs[0].errorText, null);

  // Verify claim was actually inserted
  const searchResults = store.searchClaims({ query: 'Node 22' });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].text, '记住以后使用 Node 22');

  // 3. Test failed job retry behavior
  const failingIngestionService = {
    async ingestEpisode() {
      throw new Error('LLM service down');
    }
  } as any;

  const failingScheduler = new KnowledgeCaptureScheduler(db, failingIngestionService);
  const failingJobId = failingScheduler.scheduleRun({
    conversationId: 'conv-test'
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const failedJobs = failingScheduler.listJobs();
  const failedJob = failedJobs.find(j => j.id === failingJobId);
  assert.ok(failedJob);
  assert.equal(failedJob.status, 'failed');
  assert.equal(failedJob.retryCount, 3); // maximum retries exhausted
  assert.equal(failedJob.errorText, 'LLM service down');

  // Clean up
  setCoreV2Service(null);
});
