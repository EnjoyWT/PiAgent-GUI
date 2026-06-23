import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildImRoutingKey,
  isSharedMultiUserScope,
  resolveDefaultImSessionScope
} from '../../../src/main/im/im-session-router.ts'

test('buildImRoutingKey builds dm routing keys', () => {
  const key = buildImRoutingKey({
    transportId: 'feishu',
    accountId: 'bot-a',
    chatId: 'chat-1',
    senderId: 'user-1',
    scope: 'dm'
  })

  assert.equal(key, 'im:feishu:bot-a:dm:chat-1')
  assert.equal(isSharedMultiUserScope('dm'), false)
})

test('buildImRoutingKey builds group per member routing keys', () => {
  const key = buildImRoutingKey({
    transportId: 'feishu',
    accountId: 'bot-a',
    chatId: 'chat-1',
    senderId: 'user-1',
    scope: 'group_per_member'
  })

  assert.equal(key, 'im:feishu:bot-a:group:chat-1:user:user-1')
  assert.equal(isSharedMultiUserScope('group_per_member'), false)
})

test('buildImRoutingKey builds shared group routing keys', () => {
  const key = buildImRoutingKey({
    transportId: 'feishu',
    accountId: 'bot-a',
    chatId: 'chat-1',
    senderId: 'user-1',
    scope: 'group_shared'
  })

  assert.equal(key, 'im:feishu:bot-a:group:chat-1')
  assert.equal(isSharedMultiUserScope('group_shared'), true)
})

test('buildImRoutingKey builds shared thread routing keys without sender', () => {
  const key = buildImRoutingKey({
    transportId: 'feishu',
    accountId: 'bot-a',
    chatId: 'chat-1',
    threadId: 'thread-1',
    senderId: 'user-1',
    scope: 'thread_shared'
  })

  assert.equal(key, 'im:feishu:bot-a:thread:chat-1:thread:thread-1')
  assert.equal(isSharedMultiUserScope('thread_shared'), true)
})

test('buildImRoutingKey builds per member thread routing keys', () => {
  const key = buildImRoutingKey({
    transportId: 'feishu',
    accountId: 'bot-a',
    chatId: 'chat-1',
    threadId: 'thread-1',
    senderId: 'user-1',
    scope: 'thread_per_member'
  })

  assert.equal(key, 'im:feishu:bot-a:thread:chat-1:thread:thread-1:user:user-1')
  assert.equal(isSharedMultiUserScope('thread_per_member'), false)
})

test('buildImRoutingKey encodes colon characters in key parts', () => {
  const key = buildImRoutingKey({
    transportId: 'feishu',
    accountId: 'bot:a',
    chatId: 'chat:1',
    senderId: 'user:1',
    scope: 'group_per_member'
  })

  assert.equal(key, 'im:feishu:bot%3Aa:group:chat%3A1:user:user%3A1')
})

test('buildImRoutingKey rejects missing thread id for thread scopes', () => {
  assert.throws(
    () =>
      buildImRoutingKey({
        transportId: 'feishu',
        accountId: 'bot-a',
        chatId: 'chat-1',
        senderId: 'user-1',
        scope: 'thread_shared'
      }),
    /threadId is required/
  )
})

test('resolveDefaultImSessionScope chooses IM defaults', () => {
  assert.equal(resolveDefaultImSessionScope({ chatKind: 'dm' }), 'dm')
  assert.equal(resolveDefaultImSessionScope({ chatKind: 'group' }), 'group_per_member')
  assert.equal(
    resolveDefaultImSessionScope({ chatKind: 'group', threadId: 'thread-1' }),
    'thread_shared'
  )
  assert.equal(
    resolveDefaultImSessionScope({ chatKind: 'channel', threadId: 'thread-1' }),
    'thread_shared'
  )
})
