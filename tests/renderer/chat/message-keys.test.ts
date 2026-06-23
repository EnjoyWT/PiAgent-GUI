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

test('prefers semantic submission identity over persisted ids for user chat messages', () => {
  const message: ChatMessage = {
    id: 'msg-2',
    role: 'user',
    content: '你好呀',
    submissionId: 'submission-1'
  }

  assert.equal(getMessageIdentityKey(message), 'submission:user:chat:submission-1')
})
