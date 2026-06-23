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
})
