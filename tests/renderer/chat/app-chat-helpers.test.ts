import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findAgentUserMessage,
  findReplayAnchorUserMessage
} from '../../../src/renderer/src/utils/app-chat-helpers.ts'
import type { ChatMessage } from '../../../src/renderer/src/components/chat/types.ts'

test('keeps a retried user message matchable after queue consumption until message.started binds it', () => {
  const retried: ChatMessage = {
    id: 'user-1',
    role: 'user',
    content: '/Users/sh/Desktop/pdf 这个路径下有多少个文件',
    retryCandidate: true,
    // Simulate queue.consumed having assigned a transient identity before message.started.
    agentRunId: 'queue-run',
    agentTurnId: 'queue-turn'
  }
  const messages = [retried]

  assert.equal(findAgentUserMessage(messages, retried.content, 'actual-run', 'actual-turn'), null)
  assert.equal(findReplayAnchorUserMessage(messages, retried.content), retried)
})
