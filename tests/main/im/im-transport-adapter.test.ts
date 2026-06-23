import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptImTransportPluginToTransportPlugin } from '../../../src/main/im/im-transport-adapter.ts'
import type { ImTransportInboundEvent, ImTransportPlugin } from '../../../src/main/im/index.ts'

const event: ImTransportInboundEvent = {
  id: 'evt-feishu-v2',
  transportId: 'feishu',
  accountId: 'bot-a',
  receivedAt: '2026-04-28T07:00:00.000Z',
  platform: {
    tenantId: 'tenant-a'
  },
  chat: {
    id: 'chat-a',
    kind: 'group'
  },
  sender: {
    id: 'ou-a',
    displayName: 'Alice',
    unionId: 'union-a'
  },
  thread: null,
  message: {
    id: 'msg-a',
    type: 'text',
    text: 'hello'
  }
}

const threadEvent: ImTransportInboundEvent = {
  ...event,
  id: 'evt-feishu-thread-v2',
  chat: {
    id: 'chat-a',
    kind: 'group'
  },
  thread: {
    id: 'omt-thread-a',
    rootMessageId: 'om-root-a',
    replyToMessageId: 'om-parent-a'
  },
  message: {
    id: 'msg-thread-a',
    type: 'text',
    text: 'thread reply'
  }
}

test('IM transport adapter normalizes v2 inbound events for the existing transport host', async () => {
  let inboundHandler: ((input: ImTransportInboundEvent) => void) | null = null
  const plugin: ImTransportPlugin = {
    metadata: {
      id: 'feishu',
      displayName: 'Feishu',
      version: '1.0.0',
      protocolVersion: 2,
      platformKind: 'feishu'
    },
    getCapabilities: () => ({
      canEditMessage: false,
      canStreamByEdit: false,
      canRenderButtons: true,
      canRenderRichCards: true,
      canReplyInThread: true,
      canQuoteReply: true,
      canMentionUsers: true,
      canUploadImage: true,
      canUploadFile: true,
      canCollectStructuredForm: false,
      canReceiveCardCallbacks: true,
      supportedInboundMessageTypes: ['text'],
      supportedOutboundPayloadTypes: ['text']
    }),
    getDoctor: () => ({ status: 'healthy', accountId: 'bot-a', checks: [] }),
    connect: () => undefined,
    disconnect: () => undefined,
    onInbound: (handler) => {
      inboundHandler = handler
      return () => {
        inboundHandler = null
      }
    },
    send: () => ({ status: 'sent', externalMessageId: 'sent-a' })
  }

  const adapted = adaptImTransportPluginToTransportPlugin(plugin)
  const received: unknown[] = []
  adapted.onInbound((envelope) => {
    received.push(envelope)
  })
  assert.ok(inboundHandler)
  ;(inboundHandler as (input: ImTransportInboundEvent) => void)(event)

  assert.equal((received[0] as any)?.imTraceId, 'im:feishu:bot-a:msg-a')
  assert.equal((received[0] as any)?.routingKey, 'im:feishu:bot-a:group:chat-a:user:ou-a')
  assert.equal((received[0] as any)?.personId, 'im-person:feishu:tenant-a:union-a')
})

test('IM transport adapter routes by platform thread id but keeps root message id for replies', async () => {
  let inboundHandler: ((input: ImTransportInboundEvent) => void) | null = null
  const plugin: ImTransportPlugin = {
    metadata: {
      id: 'feishu',
      displayName: 'Feishu',
      version: '1.0.0',
      protocolVersion: 2,
      platformKind: 'feishu'
    },
    getCapabilities: () => ({
      canEditMessage: false,
      canStreamByEdit: false,
      canRenderButtons: true,
      canRenderRichCards: true,
      canReplyInThread: true,
      canQuoteReply: true,
      canMentionUsers: true,
      canUploadImage: true,
      canUploadFile: true,
      canCollectStructuredForm: false,
      canReceiveCardCallbacks: true,
      supportedInboundMessageTypes: ['text'],
      supportedOutboundPayloadTypes: ['text']
    }),
    getDoctor: () => ({ status: 'healthy', accountId: 'bot-a', checks: [] }),
    connect: () => undefined,
    disconnect: () => undefined,
    onInbound: (handler) => {
      inboundHandler = handler
      return () => {
        inboundHandler = null
      }
    },
    send: () => ({ status: 'sent', externalMessageId: 'sent-a' })
  }

  const adapted = adaptImTransportPluginToTransportPlugin(plugin)
  const received: unknown[] = []
  adapted.onInbound((envelope) => {
    received.push(envelope)
  })
  assert.ok(inboundHandler)
  ;(inboundHandler as (input: ImTransportInboundEvent) => void)(threadEvent)

  assert.equal(
    (received[0] as any)?.routingKey,
    'im:feishu:bot-a:thread:chat-a:thread:omt-thread-a'
  )
  assert.equal((received[0] as any)?.externalThreadId, 'om-root-a')
})

test('IM transport adapter maps legacy delivery commands to v2 IM delivery commands', async () => {
  let sent: unknown = null
  const plugin: ImTransportPlugin = {
    metadata: {
      id: 'feishu',
      displayName: 'Feishu',
      version: '1.0.0',
      protocolVersion: 2,
      platformKind: 'feishu'
    },
    getCapabilities: () => ({
      canEditMessage: false,
      canStreamByEdit: false,
      canRenderButtons: true,
      canRenderRichCards: true,
      canReplyInThread: true,
      canQuoteReply: true,
      canMentionUsers: true,
      canUploadImage: true,
      canUploadFile: true,
      canCollectStructuredForm: false,
      canReceiveCardCallbacks: true,
      supportedInboundMessageTypes: ['text'],
      supportedOutboundPayloadTypes: ['text']
    }),
    getDoctor: () => ({ status: 'healthy', accountId: 'bot-a', checks: [] }),
    connect: () => undefined,
    disconnect: () => undefined,
    onInbound: () => () => undefined,
    send: (command) => {
      sent = command
      return { status: 'sent', externalMessageId: 'sent-a' }
    }
  }

  const adapted = adaptImTransportPluginToTransportPlugin(plugin)
  await adapted.send({
    deliveryId: 'delivery-a',
    conversationId: 'conversation-a',
    bindingId: 'binding-a',
    transportId: 'feishu',
    transportAccountId: 'bot-a',
    externalChatId: 'chat-a',
    externalThreadId: 'thread-a',
    externalUserId: 'ou-a',
    channelKind: 'thread',
    mode: 'send',
    payload: { kind: 'text', text: 'hello' }
  })

  assert.equal((sent as any)?.accountId, 'bot-a')
  assert.equal((sent as any)?.audience.kind, 'thread')
  assert.equal((sent as any)?.payload.text, 'hello')
})

test('IM transport adapter forwards delivery reply context to v2 plugins', async () => {
  let sent: unknown = null
  const plugin: ImTransportPlugin = {
    metadata: {
      id: 'telegram',
      displayName: 'Telegram',
      version: '1.0.0',
      protocolVersion: 2,
      platformKind: 'telegram'
    },
    getCapabilities: () => ({
      canEditMessage: false,
      canStreamByEdit: false,
      canRenderButtons: true,
      canRenderRichCards: true,
      canReplyInThread: true,
      canQuoteReply: true,
      canMentionUsers: true,
      canUploadImage: true,
      canUploadFile: true,
      canCollectStructuredForm: false,
      canReceiveCardCallbacks: true,
      supportedInboundMessageTypes: ['text'],
      supportedOutboundPayloadTypes: ['text']
    }),
    getDoctor: () => ({ status: 'healthy', accountId: 'bot-a', checks: [] }),
    connect: () => undefined,
    disconnect: () => undefined,
    onInbound: () => () => undefined,
    send: (command) => {
      sent = command
      return { status: 'sent', externalMessageId: 'sent-a' }
    }
  }

  const adapted = adaptImTransportPluginToTransportPlugin(plugin)
  await adapted.send({
    deliveryId: 'delivery-reply',
    conversationId: 'conversation-a',
    bindingId: 'binding-a',
    transportId: 'telegram',
    transportAccountId: 'bot-a',
    externalChatId: '-100123',
    externalThreadId: '456',
    externalUserId: '42',
    channelKind: 'thread',
    mode: 'send',
    replyContext: {
      replyToMessageId: '777',
      rootMessageId: '456'
    },
    payload: { kind: 'text', text: 'quoted reply' }
  })

  assert.deepEqual((sent as any)?.replyContext, {
    replyToMessageId: '777',
    rootMessageId: '456'
  })
})

test('IM transport adapter treats dm deliveries with externalUserId as user audience', async () => {
  let sent: unknown = null
  const plugin: ImTransportPlugin = {
    metadata: {
      id: 'feishu',
      displayName: 'Feishu',
      version: '1.0.0',
      protocolVersion: 2,
      platformKind: 'feishu'
    },
    getCapabilities: () => ({
      canEditMessage: false,
      canStreamByEdit: false,
      canRenderButtons: true,
      canRenderRichCards: true,
      canReplyInThread: true,
      canQuoteReply: true,
      canMentionUsers: true,
      canUploadImage: true,
      canUploadFile: true,
      canCollectStructuredForm: false,
      canReceiveCardCallbacks: true,
      supportedInboundMessageTypes: ['text'],
      supportedOutboundPayloadTypes: ['text']
    }),
    getDoctor: () => ({ status: 'healthy', accountId: 'bot-a', checks: [] }),
    connect: () => undefined,
    disconnect: () => undefined,
    onInbound: () => () => undefined,
    send: (command) => {
      sent = command
      return { status: 'sent', externalMessageId: 'sent-a' }
    }
  }

  const adapted = adaptImTransportPluginToTransportPlugin(plugin)
  await adapted.send({
    deliveryId: 'delivery-dm',
    conversationId: 'conversation-a',
    bindingId: 'binding-a',
    transportId: 'feishu',
    transportAccountId: 'bot-a',
    externalChatId: 'ou-a',
    externalThreadId: null,
    externalUserId: 'ou-a',
    channelKind: 'dm',
    mode: 'send',
    payload: { kind: 'text', text: 'hello dm' }
  })

  assert.equal((sent as any)?.audience.kind, 'user')
  assert.equal((sent as any)?.audience.externalUserId, 'ou-a')
  assert.equal((sent as any)?.audience.chatKind, 'dm')
})

test('IM transport adapter preserves optional target listing and account hooks from v2 plugins', async () => {
  const statuses: unknown[] = []
  const plugin = {
    metadata: {
      id: 'feishu',
      displayName: 'Feishu',
      version: '1.0.0',
      protocolVersion: 2,
      platformKind: 'feishu'
    },
    getCapabilities: () => ({
      canEditMessage: false,
      canStreamByEdit: false,
      canRenderButtons: true,
      canRenderRichCards: true,
      canReplyInThread: true,
      canQuoteReply: true,
      canMentionUsers: true,
      canUploadImage: true,
      canUploadFile: true,
      canCollectStructuredForm: false,
      canReceiveCardCallbacks: true,
      supportedInboundMessageTypes: ['text'],
      supportedOutboundPayloadTypes: ['text']
    }),
    getDoctor: () => ({ status: 'healthy', accountId: 'bot-a', checks: [] }),
    validateAccount: (accountId: string) => {
      assert.equal(accountId, 'bot-a')
    },
    listTargets: ({ accountId }: { accountId: string }) => [
      {
        transportId: 'feishu',
        transportAccountId: accountId,
        externalChatId: 'chat-a',
        channelKind: 'group',
        title: 'Ops',
        source: 'plugin'
      }
    ],
    connect: () => undefined,
    disconnect: () => undefined,
    onInbound: () => () => undefined,
    onAccountStatusChange: (handler: (status: unknown) => void) => {
      statuses.push(handler)
      return () => undefined
    },
    send: () => ({ status: 'sent', externalMessageId: 'sent-a' })
  } as ImTransportPlugin & {
    validateAccount(accountId: string): void
    listTargets(input: { accountId: string }): unknown[]
    onAccountStatusChange(handler: (status: unknown) => void): () => void
  }

  const adapted = adaptImTransportPluginToTransportPlugin(plugin)
  await adapted.validateAccount?.('bot-a')
  const targets = await adapted.listTargets?.({ accountId: 'bot-a' })
  adapted.onAccountStatusChange?.(() => undefined)

  assert.equal(targets?.[0]?.title, 'Ops')
  assert.equal(statuses.length, 1)
})
