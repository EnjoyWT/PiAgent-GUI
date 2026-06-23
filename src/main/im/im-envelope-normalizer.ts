import type { InboundEnvelope } from '../core-v2/domain.ts'
import type { ImInboundEnvelope, ImTransportInboundEvent } from './im-inbound-types.ts'
import {
  buildImRoutingKey,
  isSharedMultiUserScope,
  resolveDefaultImSessionScope
} from './im-session-router.ts'

const required = (value: string | null | undefined, name: string): string => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

const optional = (value: string | null | undefined): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export const buildImTraceId = (event: ImTransportInboundEvent): string =>
  [
    'im',
    required(event.transportId, 'transportId'),
    required(event.accountId, 'accountId'),
    required(event.message.id, 'message.id')
  ].join(':')

export const buildImDedupeKey = (event: ImTransportInboundEvent): string =>
  [
    required(event.transportId, 'transportId'),
    required(event.accountId, 'accountId'),
    required(event.message.id, 'message.id')
  ].join(':')

export const normalizeImTransportInboundEvent = (
  event: ImTransportInboundEvent
): ImInboundEnvelope => {
  const transportId = required(event.transportId, 'transportId')
  const accountId = required(event.accountId, 'accountId')
  const chatId = required(event.chat?.id, 'chat.id')
  const senderId = required(event.sender?.id, 'sender.id')
  const messageId = required(event.message?.id, 'message.id')
  const receivedAt = required(event.receivedAt, 'receivedAt')
  const scope =
    event.routingHint?.scope ??
    resolveDefaultImSessionScope({
      chatKind: event.chat.kind,
      threadId: event.thread?.id ?? null
    })
  const routingKey = buildImRoutingKey({
    transportId,
    accountId,
    chatId,
    senderId,
    threadId: event.thread?.id ?? null,
    scope
  })

  return {
    envelopeId: required(event.id, 'id'),
    imTraceId: buildImTraceId(event),
    dedupeKey: buildImDedupeKey(event),
    transportId,
    transportAccountId: accountId,
    receivedAt,
    source: {
      tenantId: optional(event.platform?.tenantId) ?? optional(event.chat?.tenantId),
      platformMessageId: messageId,
      platformChatId: chatId,
      platformThreadId: optional(event.thread?.id),
      platformRootMessageId: optional(event.thread?.rootMessageId),
      platformReplyToMessageId: optional(event.thread?.replyToMessageId)
    },
    chat: {
      externalChatId: chatId,
      kind: event.chat.kind,
      title: optional(event.chat.title)
    },
    sender: {
      externalUserId: senderId,
      displayName: optional(event.sender.displayName),
      tenantId: optional(event.sender.tenantId) ?? optional(event.platform?.tenantId),
      unionId: optional(event.sender.unionId),
      isBot: Boolean(event.sender.isBot)
    },
    message: {
      externalMessageId: messageId,
      type: event.message.type,
      text: optional(event.message.text),
      mentions: event.message.mentions ?? [],
      attachments: event.message.attachments ?? []
    },
    routing: {
      scope,
      routingKey,
      sharedMultiUser: isSharedMultiUserScope(scope)
    },
    raw: event
  }
}

export const deriveDefaultImPersonId = (envelope: ImInboundEnvelope): string => {
  const tenantKey =
    envelope.sender.tenantId ?? envelope.source.tenantId ?? envelope.transportAccountId
  const userKey = envelope.sender.unionId ?? envelope.sender.externalUserId
  return ['im-person', envelope.transportId, tenantKey, userKey]
    .map((part) => encodeURIComponent(part))
    .join(':')
}

const mapImChannelKind = (envelope: ImInboundEnvelope): InboundEnvelope['channelKind'] => {
  if (envelope.source.platformThreadId) return 'thread'
  if (envelope.chat.kind === 'dm') return 'dm'
  return 'group'
}

const mapImMessageType = (
  type: ImInboundEnvelope['message']['type']
): InboundEnvelope['messageType'] => {
  if (type === 'rich_text') return 'text'
  if (type === 'card_callback') return 'card'
  if (type === 'reaction' || type === 'system') return 'unknown'
  return type
}

export const coreEnvelopeFromImInboundEnvelope = (
  envelope: ImInboundEnvelope,
  options: { personId?: string | null } = {}
): InboundEnvelope => ({
  envelopeId: envelope.envelopeId,
  imTraceId: envelope.imTraceId,
  dedupeKey: envelope.dedupeKey,
  transportId: envelope.transportId,
  transportAccountId: envelope.transportAccountId,
  externalMessageId: envelope.message.externalMessageId,
  externalChatId: envelope.chat.externalChatId,
  externalThreadId:
    envelope.source.platformRootMessageId ?? envelope.source.platformThreadId ?? null,
  externalUserId: envelope.sender.externalUserId,
  externalUserDisplayName: envelope.sender.displayName ?? envelope.chat.title ?? undefined,
  channelKind: mapImChannelKind(envelope),
  sessionScope: envelope.routing.scope,
  sharedMultiUser: envelope.routing.sharedMultiUser,
  personId: options.personId ?? deriveDefaultImPersonId(envelope),
  tenantId: envelope.sender.tenantId ?? envelope.source.tenantId ?? null,
  messageType: mapImMessageType(envelope.message.type),
  receivedAt: envelope.receivedAt,
  text: envelope.message.text ?? undefined,
  attachments: envelope.message.attachments?.map((attachment) => ({
    id: attachment.id,
    mimeType: attachment.mimeType,
    name: attachment.name ?? undefined,
    sizeBytes: attachment.sizeBytes ?? undefined
  })),
  routingKey: envelope.routing.routingKey
})
