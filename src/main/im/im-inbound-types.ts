export type ImChatKind = 'dm' | 'group' | 'channel'

export type ImSessionScope =
  | 'dm'
  | 'group_shared'
  | 'group_per_member'
  | 'thread_shared'
  | 'thread_per_member'

export type ImMessageType =
  | 'text'
  | 'rich_text'
  | 'image'
  | 'file'
  | 'card_callback'
  | 'reaction'
  | 'system'

export type ImMention = {
  id: string
  name?: string | null
  isBot?: boolean
}

export type ImAttachment = {
  id: string
  mimeType: string
  name?: string | null
  sizeBytes?: number | null
  url?: string | null
  raw?: unknown
}

export type ImTransportInboundEvent = {
  id: string
  transportId: string
  accountId: string
  receivedAt: string
  platform: {
    tenantId?: string | null
    appId?: string | null
    raw?: unknown
  }
  chat: {
    id: string
    kind: ImChatKind
    title?: string | null
    tenantId?: string | null
  }
  sender: {
    id: string
    displayName?: string | null
    tenantId?: string | null
    unionId?: string | null
    openId?: string | null
    userId?: string | null
    isBot?: boolean
  }
  thread?: {
    id: string
    rootMessageId?: string | null
    replyToMessageId?: string | null
  } | null
  message: {
    id: string
    type: ImMessageType
    text?: string | null
    mentions?: ImMention[]
    attachments?: ImAttachment[]
    raw?: unknown
  }
  routingHint?: {
    scope?: ImSessionScope
    forceNewConversation?: boolean
  }
}

export type ImInboundEnvelope = {
  envelopeId: string
  imTraceId: string
  dedupeKey: string
  transportId: string
  transportAccountId: string
  receivedAt: string
  source: {
    tenantId?: string | null
    platformMessageId: string
    platformChatId: string
    platformThreadId?: string | null
    platformRootMessageId?: string | null
    platformReplyToMessageId?: string | null
  }
  chat: {
    externalChatId: string
    kind: ImChatKind
    title?: string | null
  }
  sender: {
    externalUserId: string
    displayName?: string | null
    tenantId?: string | null
    unionId?: string | null
    isBot?: boolean
  }
  message: {
    externalMessageId: string
    type: ImMessageType
    text?: string | null
    mentions?: ImMention[]
    attachments?: ImAttachment[]
  }
  routing: {
    scope: ImSessionScope
    routingKey: string
    sharedMultiUser: boolean
  }
  raw?: unknown
}
