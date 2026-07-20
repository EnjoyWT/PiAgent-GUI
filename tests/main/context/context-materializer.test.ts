import test from 'node:test'
import assert from 'node:assert/strict'
import { ContextStore } from '../../../src/main/context/context-store.ts'
import { ContextMaterializer } from '../../../src/main/context/context-materializer.ts'
import { createContextTestDb, insertThread } from './test-helpers.ts'

test('ContextMaterializer maps active entries into model seed messages', async () => {
  const db = createContextTestDb()
  insertThread(db, 'thread-1')
  const store = new ContextStore(db)
  const materializer = new ContextMaterializer(store)

  store.ensureThreadHead('thread-1', 'noop')
  store.appendEntries([
    {
      threadId: 'thread-1',
      sourceKind: 'message',
      sourceRef: 'message:1',
      role: 'user',
      semanticKind: 'user_message',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: 'hello',
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:00.000'
    },
    {
      threadId: 'thread-1',
      sourceKind: 'message',
      sourceRef: 'run:1:assistant',
      role: 'assistant',
      semanticKind: 'assistant_message',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: 'hi there',
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:01.000'
    }
  ])

  const snapshot = await materializer.materialize('thread-1', {
    api: 'openai-responses',
    provider: { id: 'provider' },
    id: 'model-1'
  })

  assert.equal(snapshot.messages.length, 2)
  assert.equal(snapshot.messages[0].role, 'user')
  assert.equal(snapshot.messages[0].content, 'hello')
  assert.equal(snapshot.messages[1].role, 'assistant')
  const assistant = snapshot.messages[1] as {
    usage?: { totalTokens?: number; input?: number; output?: number }
  }
  assert.ok(assistant.usage, 'seed assistants must include usage to avoid totalTokens crashes')
  assert.equal(assistant.usage?.totalTokens, 0)
  assert.equal(assistant.usage?.input, 0)
  assert.equal(assistant.usage?.output, 0)
})

test('ContextMaterializer seeds tool summaries without per-message usage', async () => {
  const db = createContextTestDb()
  insertThread(db, 'thread-2')
  const store = new ContextStore(db)
  const materializer = new ContextMaterializer(store)

  store.ensureThreadHead('thread-2', 'summary-compressor')
  store.appendEntries([
    {
      threadId: 'thread-2',
      sourceKind: 'tool',
      sourceRef: 'tool:1:summary',
      role: 'assistant',
      semanticKind: 'tool_result_summary',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: 'x'.repeat(800),
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:00.000'
    },
    {
      threadId: 'thread-2',
      sourceKind: 'tool',
      sourceRef: 'tool:2:summary',
      role: 'assistant',
      semanticKind: 'tool_result_summary',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: 'y'.repeat(1200),
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:01.000'
    }
  ])

  const snapshot = await materializer.materialize('thread-2', {
    api: 'openai-responses',
    provider: { id: 'provider' },
    id: 'model-1'
  })

  assert.equal(snapshot.messages.length, 2)
  for (const message of snapshot.messages) {
    assert.equal(message.role, 'assistant')
    const usage = (message as { usage?: { totalTokens?: number; input?: number } }).usage
    assert.ok(usage, 'tool summary seeds must include zero usage')
    assert.equal(usage?.totalTokens, 0)
    assert.equal(usage?.input, 0)
  }
})
