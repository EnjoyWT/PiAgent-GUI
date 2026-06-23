import test from 'node:test'
import assert from 'node:assert/strict'
import { ContextStore } from '../../../src/main/context/context-store.ts'
import { createContextTestDb, insertThread } from './test-helpers.ts'

test('ContextStore appends ordered entries and lists active entries', () => {
  const db = createContextTestDb()
  insertThread(db, 'thread-1')
  const store = new ContextStore(db)

  store.ensureThreadHead('thread-1', 'noop')
  const first = store.appendEntry({
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
  })
  const second = store.appendEntry({
    threadId: 'thread-1',
    sourceKind: 'message',
    sourceRef: 'run:1:assistant',
    role: 'assistant',
    semanticKind: 'assistant_message',
    includeInModelContext: true,
    includeInMemory: false,
    compactPolicy: 'summarize',
    contentText: 'world',
    contentJson: null,
    tokenEstimate: null,
    createdAt: '2026-04-16 10:00:01.000'
  })

  assert.equal(first.seq, 1)
  assert.equal(second.seq, 2)
  assert.deepEqual(
    store.listActiveEntries('thread-1').map((entry) => entry.contentText),
    ['hello', 'world']
  )
})

test('ContextStore deduplicates entries by thread + semanticKind + sourceRef', () => {
  const db = createContextTestDb()
  insertThread(db, 'thread-1')
  const store = new ContextStore(db)

  const first = store.appendEntry({
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
  })
  const duplicate = store.appendEntry({
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
  })

  assert.equal(first.id, duplicate.id)
  assert.equal(store.listEntries('thread-1').length, 1)
})

test('ContextStore prunes model context entries after retry cutoff', () => {
  const db = createContextTestDb()
  insertThread(db, 'thread-1')
  const store = new ContextStore(db)
  const cutoff = '2026-04-30T10:34:54.679+08:00'
  const kept = store.appendEntry({
    threadId: 'thread-1',
    sourceKind: 'message',
    sourceRef: 'message:before',
    role: 'user',
    semanticKind: 'user_message',
    includeInModelContext: true,
    includeInMemory: true,
    compactPolicy: 'keep',
    contentText: 'before',
    contentJson: null,
    tokenEstimate: null,
    createdAt: '2026-04-30T10:34:53.000+08:00'
  })
  store.appendEntry({
    threadId: 'thread-1',
    sourceKind: 'message',
    sourceRef: 'message:anchor',
    role: 'user',
    semanticKind: 'user_message',
    includeInModelContext: true,
    includeInMemory: true,
    compactPolicy: 'summarize',
    contentText: 'anchor being retried',
    contentJson: null,
    tokenEstimate: null,
    createdAt: cutoff
  })
  store.appendEntry({
    threadId: 'thread-1',
    sourceKind: 'message',
    sourceRef: 'run:stale:assistant',
    role: 'assistant',
    semanticKind: 'assistant_message',
    includeInModelContext: true,
    includeInMemory: true,
    compactPolicy: 'summarize',
    contentText: 'stale assistant',
    contentJson: null,
    tokenEstimate: null,
    createdAt: '2026-04-30 02:34:57.326'
  })
  store.upsertThreadHead({
    threadId: 'thread-1',
    engineName: 'summary-compressor',
    activeSummaryEntryId: kept.id,
    compactedUntilSeq: kept.seq
  })

  const deleted = store.pruneThreadAfter('thread-1', cutoff)

  assert.equal(deleted, 2)
  assert.deepEqual(
    store.listEntries('thread-1').map((entry) => entry.sourceRef),
    ['message:before']
  )
  assert.equal(store.getThreadHead('thread-1')?.revision, 2)
})

test('ContextStore lists recent compactions in descending order', () => {
  const db = createContextTestDb()
  insertThread(db, 'thread-1')
  const store = new ContextStore(db)

  store.addCompaction({
    id: 'compact-1',
    threadId: 'thread-1',
    engineName: 'summary-compressor',
    reason: 'manual',
    baseSummaryEntryId: null,
    newSummaryEntryId: 'summary-1',
    fromSeqExclusive: 0,
    compactedUntilSeq: 12,
    protectedTailStartSeq: 13,
    estimatedInputTokens: 2400,
    estimatedOutputTokens: 320,
    createdAt: '2026-04-16 10:00:00.000'
  })
  store.addCompaction({
    id: 'compact-2',
    threadId: 'thread-1',
    engineName: 'summary-compressor',
    reason: 'preflight',
    baseSummaryEntryId: 'summary-1',
    newSummaryEntryId: 'summary-2',
    fromSeqExclusive: 12,
    compactedUntilSeq: 20,
    protectedTailStartSeq: 21,
    estimatedInputTokens: 1800,
    estimatedOutputTokens: 280,
    createdAt: '2026-04-16 10:00:10.000'
  })

  const rows = store.listCompactions('thread-1', 5)
  assert.deepEqual(
    rows.map((row) => [row.id, row.reason]),
    [
      ['compact-2', 'preflight'],
      ['compact-1', 'manual']
    ]
  )
})
