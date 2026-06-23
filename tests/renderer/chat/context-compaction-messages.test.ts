import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyContextCompactionEventToMessages,
  isContextCompactionEvent
} from '../../../src/renderer/src/utils/context-compaction-messages.ts'
import type { ChatMessage } from '../../../src/renderer/src/components/chat/types.ts'

const createEvent = (eventType: string, payload: unknown = {}) => ({
  id: `event-${eventType}`,
  thread_id: 'thread-1',
  agent_run_id: null,
  event_type: eventType,
  event_origin: 'debug',
  correlation_id: `corr-${eventType}`,
  payload_json: JSON.stringify(payload),
  raw_json: null,
  created_at: 1000
})

test('recognizes context compaction debug events', () => {
  assert.equal(isContextCompactionEvent(createEvent('context.compaction.started')), true)
  assert.equal(isContextCompactionEvent(createEvent('context.compaction.completed')), true)
  assert.equal(isContextCompactionEvent(createEvent('context.compaction.preflight')), true)
  assert.equal(isContextCompactionEvent(createEvent('agentMessageFinished')), false)
})

test('adds a non-context chat marker while context compaction is running', () => {
  const messages: ChatMessage[] = []

  assert.equal(
    applyContextCompactionEventToMessages(messages, createEvent('context.compaction.started')),
    true
  )
  assert.equal(messages.length, 1)
  assert.equal(messages[0].messageKind, 'context_compaction')
  assert.equal(messages[0].includeInAgentContext, false)
  assert.match(messages[0].content, /正在压缩上下文/)
})

test('updates the running marker when compaction completes', () => {
  const messages: ChatMessage[] = []

  applyContextCompactionEventToMessages(messages, createEvent('context.compaction.started'))
  applyContextCompactionEventToMessages(
    messages,
    createEvent('context.compaction.completed', { revision: 2, summaryEntryId: 'summary-1' })
  )

  assert.equal(messages.length, 1)
  assert.equal(messages[0].messageKind, 'context_compaction')
  assert.equal(messages[0].includeInAgentContext, false)
  assert.match(messages[0].content, /上下文已压缩/)
  assert.match(messages[0].content, /后续对话将使用当前激活上下文/)
})

test('adds a completed marker for automatic preflight compaction', () => {
  const messages: ChatMessage[] = [{ role: 'user', content: '继续' }]

  applyContextCompactionEventToMessages(
    messages,
    createEvent('context.compaction.preflight', {
      estimateMode: 'usage_backed',
      estimatedPromptTokens: 70000,
      thresholdTokens: 60000,
      contextWindow: 100000
    })
  )

  assert.equal(messages.length, 2)
  assert.equal(messages[1].messageKind, 'context_compaction')
  assert.equal(messages[1].includeInAgentContext, false)
  assert.match(messages[1].content, /上下文已压缩/)
})
