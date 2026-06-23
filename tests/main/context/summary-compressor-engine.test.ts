import test from 'node:test'
import assert from 'node:assert/strict'
import { ContextStore } from '../../../src/main/context/context-store.ts'
import {
  planSummaryCompaction,
  SummaryCompressorEngine
} from '../../../src/main/context/engines/summary-compressor-engine.ts'
import { SummaryPromptBuilder } from '../../../src/main/context/summary-prompt-builder.ts'
import { createContextTestDb, insertThread } from './test-helpers.ts'
import type { ContextEngineConfig } from '../../../src/main/context/context-types.ts'
import type {
  ContextSummaryModelInput,
  ContextSummaryModelResult
} from '../../../src/main/context/context-model-client.ts'

class StubSummaryModelClient {
  calls: ContextSummaryModelInput[] = []

  async summarize(input: ContextSummaryModelInput): Promise<ContextSummaryModelResult | null> {
    this.calls.push(input)
    return {
      modelKey: input.modelKeys[0] ?? 'runtime::fallback',
      text: `
## Goal
Preserve the thread intent

## Completed Actions
Captured the prior exchange

## Pending User Asks
Continue implementation
      `.trim()
    }
  }
}

const createConfig = (): ContextEngineConfig => ({
  version: 1,
  mode: 'manual',
  engine: 'summary-compressor',
  summaryModel: '',
  summaryFallbackModel: '',
  summaryTimeoutMs: 20_000,
  trigger: {
    thresholdPercent: 0.5,
    estimatedThresholdPercent: 0.65,
    reserveOutputTokens: 13_000
  },
  limits: {
    protectFirstEntries: 1,
    protectLastEntries: 1,
    summaryBudgetCap: 4096
  },
  engineConfig: {}
})

test('SummaryCompressorEngine compacts middle entries and preserves head/tail entries', async () => {
  const db = createContextTestDb()
  insertThread(db, 'thread-1')
  const store = new ContextStore(db)
  store.ensureThreadHead('thread-1', 'summary-compressor')
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
      contentText: 'first user message',
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
      contentText: 'assistant detail 1',
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:01.000'
    },
    {
      threadId: 'thread-1',
      sourceKind: 'message',
      sourceRef: 'message:2',
      role: 'user',
      semanticKind: 'user_message',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: 'user detail 2',
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:02.000'
    },
    {
      threadId: 'thread-1',
      sourceKind: 'message',
      sourceRef: 'run:2:assistant',
      role: 'assistant',
      semanticKind: 'assistant_message',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: 'assistant detail 2',
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:03.000'
    },
    {
      threadId: 'thread-1',
      sourceKind: 'tool',
      sourceRef: 'tool:1:summary',
      role: 'assistant',
      semanticKind: 'tool_result_summary',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: '[bash] latest tool summary',
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:04.000'
    }
  ])

  const modelClient = new StubSummaryModelClient()
  const engine = new SummaryCompressorEngine({
    store,
    config: createConfig(),
    promptBuilder: new SummaryPromptBuilder(),
    modelClient
  })

  const result = await engine.compact({
    threadId: 'thread-1',
    modelKey: 'provider::model',
    reason: 'manual'
  })

  assert.equal(result.changed, true)
  assert.equal(modelClient.calls.length, 1)
  assert.deepEqual(modelClient.calls[0]?.modelKeys, ['provider::model'])

  const head = store.getThreadHead('thread-1')
  assert.equal(head?.engineName, 'summary-compressor')
  assert.equal(head?.compactedUntilSeq, 4)
  assert.ok(head?.activeSummaryEntryId)

  const activeEntries = store.listActiveEntries('thread-1')
  assert.deepEqual(
    activeEntries.map((entry) => entry.semanticKind),
    ['user_message', 'thread_summary', 'tool_result_summary']
  )

  const state = store.getEngineState('thread-1', 'summary-compressor')
  assert.ok(state?.stateJson.includes('Preserve the thread intent'))
})

test('SummaryCompressorEngine skips preflight compaction during cooldown', async () => {
  const db = createContextTestDb()
  insertThread(db, 'thread-2')
  const store = new ContextStore(db)
  store.ensureThreadHead('thread-2', 'summary-compressor')
  store.appendEntry({
    threadId: 'thread-2',
    sourceKind: 'message',
    sourceRef: 'message:1',
    role: 'user',
    semanticKind: 'user_message',
    includeInModelContext: true,
    includeInMemory: false,
    compactPolicy: 'summarize',
    contentText: 'need compaction soon',
    contentJson: null,
    tokenEstimate: null,
    createdAt: '2026-04-16 10:00:00.000'
  })
  store.setEngineState(
    'thread-2',
    'summary-compressor',
    JSON.stringify({
      cooldownUntil: new Date(Date.now() + 60_000).toISOString()
    })
  )

  const modelClient = new StubSummaryModelClient()
  const engine = new SummaryCompressorEngine({
    store,
    config: createConfig(),
    promptBuilder: new SummaryPromptBuilder(),
    modelClient
  })

  const result = await engine.compact({
    threadId: 'thread-2',
    modelKey: 'provider::model',
    reason: 'preflight'
  })

  assert.equal(result.changed, false)
  assert.equal(modelClient.calls.length, 0)
})

test('planSummaryCompaction reports no compactable entries when protect windows cover the thread', () => {
  const db = createContextTestDb()
  insertThread(db, 'thread-3')
  const store = new ContextStore(db)
  store.ensureThreadHead('thread-3', 'summary-compressor')
  store.appendEntries([
    {
      threadId: 'thread-3',
      sourceKind: 'message',
      sourceRef: 'message:1',
      role: 'user',
      semanticKind: 'user_message',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: 'first',
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:00.000'
    },
    {
      threadId: 'thread-3',
      sourceKind: 'message',
      sourceRef: 'message:2',
      role: 'assistant',
      semanticKind: 'assistant_message',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: 'second',
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:01.000'
    },
    {
      threadId: 'thread-3',
      sourceKind: 'message',
      sourceRef: 'message:3',
      role: 'user',
      semanticKind: 'user_message',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: 'third',
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:02.000'
    },
    {
      threadId: 'thread-3',
      sourceKind: 'message',
      sourceRef: 'message:4',
      role: 'assistant',
      semanticKind: 'assistant_message',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: 'fourth',
      contentJson: null,
      tokenEstimate: null,
      createdAt: '2026-04-16 10:00:03.000'
    }
  ])

  const plan = planSummaryCompaction({
    allEntries: store.listEntries('thread-3'),
    activeEntries: store.listActiveEntries('thread-3'),
    activeSummaryEntryId: null,
    protectFirstEntries: 3,
    protectLastEntries: 20
  })

  assert.equal(plan.nonSummaryActiveEntries.length, 4)
  assert.equal(plan.protectedHeadEntries.length, 3)
  assert.equal(plan.protectedTailEntries.length, 1)
  assert.equal(plan.summarizableEntries.length, 0)
})
