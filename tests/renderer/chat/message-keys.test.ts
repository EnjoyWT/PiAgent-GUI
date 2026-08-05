import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getMessageIdentityKey,
  getMessageRenderKey
} from '../../../src/renderer/src/utils/message-keys.ts'
import type { ChatMessage } from '../../../src/renderer/src/components/chat/types.ts'

test('distinguishes user and assistant messages that share the same run and turn ids', () => {
  const user: ChatMessage = {
    role: 'user',
    content: '你是谁',
    agentRunId: 'run-1',
    agentTurnId: 'turn-1'
  }
  const assistant: ChatMessage = {
    role: 'assistant',
    content: '我是 yolo',
    agentRunId: 'run-1',
    agentTurnId: 'turn-1'
  }

  assert.notEqual(getMessageIdentityKey(user), getMessageIdentityKey(assistant))
  assert.notEqual(getMessageRenderKey(user, 0), getMessageRenderKey(assistant, 1))
})

test('distinguishes different message kinds inside the same turn', () => {
  const question: ChatMessage = {
    role: 'user',
    messageKind: 'questionnaire_question',
    content: '第一个问题',
    agentRunId: 'run-1',
    agentTurnId: 'turn-1'
  }
  const answer: ChatMessage = {
    role: 'user',
    messageKind: 'questionnaire_answer',
    content: '第一个回答',
    agentRunId: 'run-1',
    agentTurnId: 'turn-1'
  }

  assert.notEqual(getMessageIdentityKey(question), getMessageIdentityKey(answer))
})

test('prefers semantic turn identity over persisted ids when available', () => {
  const message: ChatMessage = {
    id: 'msg-1',
    role: 'assistant',
    content: 'hello',
    agentRunId: 'run-1',
    agentTurnId: 'turn-1'
  }

  assert.equal(getMessageIdentityKey(message), 'turn:assistant:chat:run-1:turn-1')
  assert.equal(getMessageRenderKey(message, 0), 'turn:assistant:chat:run-1:turn-1')
})
test('keeps the run-level assistant render key stable from live streaming through final hydration', () => {
  const live: ChatMessage = {
    role: 'assistant',
    content: 'partial answer',
    agentRunId: 'run-1',
    runtimeSequence: 146
  }
  const hydratedFinal: ChatMessage = {
    id: 'final-message-1',
    role: 'assistant',
    content: 'final answer',
    agentRunId: 'run-1',
    createdAt: '2026-08-05T10:00:35.254+08:00'
  }

  assert.equal(getMessageRenderKey(live, 0), getMessageRenderKey(hydratedFinal, 0))
})
