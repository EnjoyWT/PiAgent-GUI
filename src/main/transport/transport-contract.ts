import type { PluginRegisterContext } from '../plugin-system/plugin-types.ts'
import type {
  ConversationBindingTarget,
  ConversationBinding,
  ConversationChannelKind,
  DeliveryMode,
  DeliveryRecord,
  InboundEnvelope
} from '../core-v2/domain.ts'
import type {
  TransportPluginAccountRuntimeConfig,
  TransportPluginAccountSetupEvent,
  TransportPluginAccountSetupStartInput,
  TransportPluginAccountSetupStartResult
} from '../../shared/transport-plugins.ts'

export type TransportCapabilityDegradeMode = 'native' | 'text_fallback' | 'unsupported'

export type TransportCapabilities = {
  canEditMessage: boolean
  canStreamByEdit: boolean
  canRenderButtons: boolean
  canRenderRichCards: boolean
  canReplyInThread: boolean
  canUploadImage: boolean
  canUploadFile: boolean
  canCollectStructuredForm: boolean
  maxButtonsPerMessage?: number
  maxTextLength?: number
}

export type DeliveryCommand = {
  deliveryId: string
  conversationId: string
  bindingId: string
  transportId: string
  transportAccountId: string
  externalChatId: string
  externalThreadId?: string | null
  externalUserId?: string | null
  channelKind?: ConversationChannelKind | null
  mode: DeliveryMode
  replyContext?: unknown | null
  payload: unknown
}

export type DeliveryResult = {
  status: 'sent' | 'failed'
  externalMessageId?: string | null
  degradeMode?: TransportCapabilityDegradeMode
  error?: string | null
  raw?: unknown
}

export type TransportInboundHandler = (envelope: InboundEnvelope) => Promise<void> | void

export type TransportAccountRuntimeState =
  | 'connecting'
  | 'connected'
  | 'retrying'
  | 'fatal'
  | 'disconnected'

export type TransportAccountStatusChange = {
  accountId: string
  state: TransportAccountRuntimeState
  error?: string | null
  errorCode?: string | null
}

export type TransportMetadata = {
  id: string
  displayName: string
  version: string
}

export type TransportTargetEntry = ConversationBindingTarget & {
  title: string
  description?: string
  source: 'plugin'
  targetKind?: 'contact' | 'dm' | 'group' | 'thread' | 'channel'
}

export type TransportTargetListQuery = {
  accountId: string
  query?: string | null
  limit?: number | null
  channelKind?: ConversationChannelKind | null
}

export type TransportConnectErrorOptions = {
  code?: string
  retryable?: boolean
  cause?: unknown
}

export class TransportConnectError extends Error {
  readonly code: string | null
  readonly retryable: boolean

  constructor(message: string, options: TransportConnectErrorOptions = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'TransportConnectError'
    this.code = options.code ? String(options.code) : null
    this.retryable = options.retryable ?? true
  }
}

export type TransportPlugin = {
  metadata: TransportMetadata
  getCapabilities(accountId: string): Promise<TransportCapabilities> | TransportCapabilities
  listTargets?(
    input: TransportTargetListQuery
  ): Promise<TransportTargetEntry[]> | TransportTargetEntry[]
  validateAccount?(accountId: string): Promise<void> | void
  connect(accountId: string): Promise<void> | void
  disconnect(accountId: string): Promise<void> | void
  startAccountSetup?(
    input: TransportPluginAccountSetupStartInput
  ): Promise<TransportPluginAccountSetupStartResult> | TransportPluginAccountSetupStartResult
  cancelAccountSetup?(sessionId: string): Promise<void> | void
  onAccountSetupEvent?(
    handler: (event: TransportPluginAccountSetupEvent) => Promise<void> | void
  ): () => void
  send(command: DeliveryCommand): Promise<DeliveryResult> | DeliveryResult
  onInbound(handler: TransportInboundHandler): () => void
  onAccountStatusChange?(
    handler: (status: TransportAccountStatusChange) => Promise<void> | void
  ): () => void
}

export type TransportRegisterContext = PluginRegisterContext & {
  getAccountConfig?: (accountId: string) => TransportPluginAccountRuntimeConfig | null
}

export const createDeliveryCommand = (
  delivery: DeliveryRecord,
  binding: ConversationBinding
): DeliveryCommand => ({
  deliveryId: delivery.id,
  conversationId: delivery.conversationId,
  bindingId: delivery.bindingId,
  transportId: binding.transportId,
  transportAccountId: binding.transportAccountId,
  externalChatId: binding.externalChatId,
  externalThreadId: binding.externalThreadId ?? null,
  externalUserId: binding.externalUserId ?? null,
  channelKind: binding.channelKind,
  mode: delivery.mode,
  replyContext: delivery.replyContext ?? null,
  payload: safeParseDeliveryPayload(delivery.payloadJson)
})

const safeParseDeliveryPayload = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return { text: value }
  }
}
