import type { ImChatKind } from './im-inbound-types.ts'

export type ImDeliveryPayload =
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; markdown: string; fallbackText: string }
  | { kind: 'rich_card'; card: unknown; fallbackText: string }
  | { kind: 'interaction'; interactionId: string; prompt: string; options?: ImDeliveryOption[] }
  | { kind: 'file'; attachmentId: string; fallbackText?: string | null }
  | { kind: 'typing' }

export type ImDeliveryOption = {
  id: string
  label: string
  description?: string | null
}

export type ImTransportCapabilities = {
  canEditMessage: boolean
  canStreamByEdit: boolean
  canRenderButtons: boolean
  canRenderRichCards: boolean
  canReplyInThread: boolean
  canQuoteReply: boolean
  canMentionUsers: boolean
  canUploadImage: boolean
  canUploadFile: boolean
  canCollectStructuredForm: boolean
  canReceiveCardCallbacks: boolean
  maxTextLength?: number
  maxButtonsPerMessage?: number
  supportedInboundMessageTypes: string[]
  supportedOutboundPayloadTypes: string[]
}

export type ImDeliveryCommand = {
  deliveryId: string
  conversationId: string
  bindingId: string
  transportId: string
  accountId: string
  doctorTraceId?: string | null
  audience: {
    kind: 'chat' | 'thread' | 'user'
    chatKind?: ImChatKind | null
    externalChatId: string
    externalThreadId?: string | null
    externalUserId?: string | null
  }
  replyContext?: {
    replyToMessageId?: string | null
    rootMessageId?: string | null
    mentionUserIds?: string[]
  }
  payload: ImDeliveryPayload
  policy: {
    preferThread: boolean
    splitLongText: boolean
    allowCardFallback: boolean
    silent?: boolean
  }
}

export type ImDeliveryResult = {
  status: 'sent' | 'failed'
  externalMessageId?: string | null
  degradeMode?: string | null
  retryable?: boolean
  error?: string | null
  raw?: unknown
}
