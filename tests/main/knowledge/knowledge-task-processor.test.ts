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
      return { shortCircuit: true, url: pathToFileURL(resolve(repoRoot, 'tests/main/runtime-host/electron-stub.mjs')).href };
    }
    if (specifier.startsWith('@shared/')) {
      return { shortCircuit: true, url: pathToFileURL(resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`)).href };
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : '';
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const { migrateKnowledgeDb } = await import('../../../src/main/knowledge/knowledge-db.ts');
const { KnowledgeTaskProcessor } = await import('../../../src/main/knowledge/knowledge-task-processor.ts');
const { setCoreV2Service } = await import('../../../src/main/core-v2/sqlite-db.ts');
const { setSetting, getSetting } = await import('../../../src/main/db/config-db.ts');

test('KnowledgeTaskProcessor accumulates ordinary turns and finalizes them on Dream/manual boundary', async () => {
  const db = new Database(':memory:');
  migrateKnowledgeDb(db);
  const ingested: any[] = [];
  const processor = new KnowledgeTaskProcessor(
    db,
    { async ingestEpisode(episode: any) { ingested.push(episode); return { insertedClaims: 1, skippedClaims: 0, insertedRelations: 0, affectedEntityIds: [] }; } } as any,
    { async consolidateEntity() { return { patternsCreated: 0, profileUpdated: false }; } } as any
  );

  setCoreV2Service({
    getConversationMessages: () => [
      { id: 'u1', role: 'user', text: '我喜欢吃甜食', agentRunId: 'run-1', createdAt: '2026-05-28T00:00:00Z' },
      { id: 'a1', role: 'assistant', text: '甜食很好吃。', agentRunId: 'run-1', createdAt: '2026-05-28T00:00:01Z' }
    ]
  } as any);

  const result = await processor.appendRun({ conversationId: 'conv-1', threadId: 'thread-1', agentRunId: 'run-1' });
  assert.equal(result.reason, 'accumulated');
  assert.equal(result.finalizedTaskId, null);
  assert.equal(ingested.length, 0);

  const finalized = await processor.finalizeAllActive('dream');
  assert.equal(finalized, 1);
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].userText, '我喜欢吃甜食');
  setCoreV2Service(null);
});

test('KnowledgeTaskProcessor cuts active task on high-confidence topic boundary', async () => {
  const previousToolModel = getSetting('tool_model');
  setSetting('tool_model', 'openai::gpt-4o');
  const db = new Database(':memory:');
  migrateKnowledgeDb(db);
  const ingested: any[] = [];
  const processor = new KnowledgeTaskProcessor(
    db,
    { async ingestEpisode(episode: any) { ingested.push(episode); return { insertedClaims: 1, skippedClaims: 0, insertedRelations: 0, affectedEntityIds: [] }; } } as any,
    { async consolidateEntity() { return { patternsCreated: 0, profileUpdated: false }; } } as any,
    async () => ({ modelKey: 'openai::gpt-4o', text: '{"decision":"NEW","confidence":0.91,"reason":"switch to food preference"}' })
  );

  const messages = [
    { id: 'u1', role: 'user', text: '我们继续讨论 PiAgent 记忆系统架构', agentRunId: 'run-1', createdAt: '2026-05-28T00:00:00Z' },
    { id: 'a1', role: 'assistant', text: '好的。', agentRunId: 'run-1', createdAt: '2026-05-28T00:00:01Z' },
    { id: 'u2', role: 'user', text: '我喜欢吃甜食', agentRunId: 'run-2', createdAt: '2026-05-28T00:02:00Z' },
    { id: 'a2', role: 'assistant', text: '记下这个偏好。', agentRunId: 'run-2', createdAt: '2026-05-28T00:02:01Z' }
  ];
  setCoreV2Service({ getConversationMessages: () => messages } as any);

  const first = await processor.appendRun({ conversationId: 'conv-1', threadId: 'thread-1', agentRunId: 'run-1' });
  assert.equal(first.reason, 'accumulated');
  const second = await processor.appendRun({ conversationId: 'conv-1', threadId: 'thread-1', agentRunId: 'run-2' });
  assert.equal(second.reason, 'topic_boundary');
  assert.ok(second.finalizedTaskId);
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].userText, '我们继续讨论 PiAgent 记忆系统架构');

  setCoreV2Service(null);
  setSetting('tool_model', previousToolModel ?? '');
});

test('KnowledgeTaskProcessor finalizes explicit memory turns immediately', async () => {
  const db = new Database(':memory:');
  migrateKnowledgeDb(db);
  const ingested: any[] = [];
  const processor = new KnowledgeTaskProcessor(
    db,
    { async ingestEpisode(episode: any) { ingested.push(episode); return { insertedClaims: 1, skippedClaims: 0, insertedRelations: 0, affectedEntityIds: [] }; } } as any,
    { async consolidateEntity() { return { patternsCreated: 0, profileUpdated: false }; } } as any
  );

  setCoreV2Service({
    getConversationMessages: () => [
      { id: 'u1', role: 'user', text: '我帮记一下：今天家里的薄荷叶子开始发绿了，说明薄荷长得正常了', agentRunId: 'run-2', createdAt: '2026-05-28T00:00:00Z' },
      { id: 'a1', role: 'assistant', text: '记住啦。', agentRunId: 'run-2', createdAt: '2026-05-28T00:00:01Z' }
    ]
  } as any);

  const result = await processor.appendRun({ conversationId: 'conv-1', threadId: 'thread-1', agentRunId: 'run-2' });
  assert.equal(result.reason, 'explicit_memory');
  assert.ok(result.finalizedTaskId);
  assert.equal(ingested.length, 1);
  setCoreV2Service(null);
});
