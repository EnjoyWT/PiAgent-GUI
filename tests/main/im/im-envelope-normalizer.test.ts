import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeImTransportInboundEvent } from '../../../src/main/im/im-envelope-normalizer.ts'
import type { ImTransportInboundEvent } from '../../../src/main/im/im-inbound-types.ts'

const baseEvent = (): ImTransportInboundEvent => ({
  id: 'event-1',
  transportId: 'feishu',
  accountId: 'bot-a',
  receivedAt: '2026-04-28T05:00:00.000Z',
  platform: {
    tenantId: 'tenant-a',
    appId: 'app-a'
  },
  chat: {
    id: 'chat-a',
    kind: 'group',
    title: '研发群',
    tenantId: 'tenant-a'
  },
  sender: {
    id: 'ou-user-a',
    displayName: '张三',
    tenantId: 'tenant-a',
    unionId: 'union-a',
    openId: 'open-a',
    isBot: false
  },
  thread: null,
  message: {
    id: 'msg-a',
    type: 'text',
    text: 'hello',
    mentions: [{ id: 'bot-a', name: 'PiAgent', isBot: true }]
  }
})

test('normalizeImTransportInboundEvent builds canonical envelope for group member session', () => {
  const envelope = normalizeImTransportInboundEvent(baseEvent())

  assert.equal(envelope.envelopeId, 'event-1')
  assert.equal(envelope.imTraceId, 'im:feishu:bot-a:msg-a')
  assert.equal(envelope.dedupeKey, 'feishu:bot-a:msg-a')
  assert.equal(envelope.transportId, 'feishu')
  assert.equal(envelope.transportAccountId, 'bot-a')
  assert.equal(envelope.source.tenantId, 'tenant-a')
  assert.equal(envelope.chat.externalChatId, 'chat-a')
  assert.equal(envelope.chat.kind, 'group')
  assert.equal(envelope.sender.externalUserId, 'ou-user-a')
  assert.equal(envelope.sender.unionId, 'union-a')
  assert.equal(envelope.message.externalMessageId, 'msg-a')
  assert.equal(envelope.message.text, 'hello')
  assert.equal(envelope.routing.scope, 'group_per_member')
  assert.equal(envelope.routing.routingKey, 'im:feishu:bot-a:group:chat-a:user:ou-user-a')
  assert.equal(envelope.routing.sharedMultiUser, false)
})

test('normalizeImTransportInboundEvent defaults thread messages to shared thread scope', () => {
  const event = baseEvent()
  event.thread = {
    id: 'thread-a',
    rootMessageId: 'root-a',
    replyToMessageId: 'reply-a'
  }

  const envelope = normalizeImTransportInboundEvent(event)

  assert.equal(envelope.routing.scope, 'thread_shared')
  assert.equal(envelope.routing.routingKey, 'im:feishu:bot-a:thread:chat-a:thread:thread-a')
  assert.equal(envelope.routing.sharedMultiUser, true)
  assert.equal(envelope.source.platformThreadId, 'thread-a')
  assert.equal(envelope.source.platformRootMessageId, 'root-a')
  assert.equal(envelope.source.platformReplyToMessageId, 'reply-a')
})

test('normalizeImTransportInboundEvent honors explicit routing scope', () => {
  const event = baseEvent()
  event.routingHint = { scope: 'group_shared' }

  const envelope = normalizeImTransportInboundEvent(event)

  assert.equal(envelope.routing.scope, 'group_shared')
  assert.equal(envelope.routing.routingKey, 'im:feishu:bot-a:group:chat-a')
  assert.equal(envelope.routing.sharedMultiUser, true)
})

test('normalizeImTransportInboundEvent rejects missing required fields', () => {
  const event = baseEvent()
  event.sender.id = ''

  assert.throws(() => normalizeImTransportInboundEvent(event), /sender.id is required/)
})
