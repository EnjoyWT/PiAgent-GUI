import type {
  DeliveryCommand,
  DeliveryResult,
  TransportAccountStatusChange,
  TransportCapabilities,
  TransportPlugin,
  TransportTargetEntry,
  TransportTargetListQuery
} from '../transport/transport-contract.ts'
import type {
  TransportPluginAccountSetupEvent,
  TransportPluginAccountSetupStartInput,
  TransportPluginAccountSetupStartResult
} from '../../shared/transport-plugins.ts'
import type { ImDeliveryCommand, ImDeliveryPayload, ImDeliveryResult } from './im-delivery-types.ts'
import type { ImTransportPlugin } from './im-transport-contract.ts'
import type { ImTransportInboundEvent } from './im-inbound-types.ts'
import {
  coreEnvelopeFromImInboundEnvelope,
  deriveDefaultImPersonId,
  normalizeImTransportInboundEvent
} from './im-envelope-normalizer.ts'

export const isImTransportPlugin = (plugin: unknown): plugin is ImTransportPlugin => {
  const candidate = plugin as {
    metadata?: { protocolVersion?: unknown }
    onInbound?: unknown
    send?: unknown
  }
  return (
    candidate?.metadata?.protocolVersion === 2 &&
    typeof candidate.onInbound === 'function' &&
    typeof candidate.send === 'function'
  )
}

export const adaptImTransportPluginToTransportPlugin = (
  plugin: ImTransportPlugin
): TransportPlugin => {
  const optionalPlugin = plugin as ImTransportPlugin &
    Partial<{
      listTargets(
        input: TransportTargetListQuery
      ): Promise<TransportTargetEntry[]> | TransportTargetEntry[]
      validateAccount(accountId: string): Promise<void> | void
      startAccountSetup(
        input: TransportPluginAccountSetupStartInput
      ): Promise<TransportPluginAccountSetupStartResult> | TransportPluginAccountSetupStartResult
      cancelAccountSetup(sessionId: string): Promise<void> | void
      onAccountSetupEvent(
        handler: (event: TransportPluginAccountSetupEvent) => Promise<void> | void
      ): () => void
      onAccountStatusChange(
        handler: (status: TransportAccountStatusChange) => Promise<void> | void
      ): () => void
    }>
  const adapted: TransportPlugin = {
    metadata: plugin.metadata,
    getCapabilities: async (accountId) => mapCapabilities(await plugin.getCapabilities(accountId)),
    connect: (accountId) => plugin.connect(accountId),
    disconnect: (accountId) => plugin.disconnect(accountId),
    onInbound: (handler) =>
      plugin.onInbound(async (event: ImTransportInboundEvent) => {
        const envelope = normalizeImTransportInboundEvent(event)
        await handler(
          coreEnvelopeFromImInboundEnvelope(envelope, {
            personId: deriveDefaultImPersonId(envelope)
          })
        )
      }),
    send: async (command) => mapDeliveryResult(await plugin.send(mapDeliveryCommand(command)))
  }

  if (typeof optionalPlugin.listTargets === 'function') {
    adapted.listTargets = (input) => optionalPlugin.listTargets?.(input) ?? []
  }
  if (typeof optionalPlugin.validateAccount === 'function') {
    adapted.validateAccount = (accountId) => optionalPlugin.validateAccount?.(accountId)
  }
  if (typeof optionalPlugin.startAccountSetup === 'function') {
    adapted.startAccountSetup = (input) =>
      optionalPlugin.startAccountSetup?.(input) ??
      Promise.reject(new Error('Account setup is not available'))
  }
  if (typeof optionalPlugin.cancelAccountSetup === 'function') {
    adapted.cancelAccountSetup = (sessionId) => optionalPlugin.cancelAccountSetup?.(sessionId)
  }
  if (typeof optionalPlugin.onAccountSetupEvent === 'function') {
    adapted.onAccountSetupEvent = (handler) =>
      optionalPlugin.onAccountSetupEvent?.(handler) ?? (() => undefined)
  }
  if (typeof optionalPlugin.onAccountStatusChange === 'function') {
    adapted.onAccountStatusChange = (handler) =>
      optionalPlugin.onAccountStatusChange?.(handler) ?? (() => undefined)
  }

  return adapted
}

const mapCapabilities = (
  capabilities: Awaited<ReturnType<ImTransportPlugin['getCapabilities']>>
): TransportCapabilities => ({
  canEditMessage: capabilities.canEditMessage,
  canStreamByEdit: capabilities.canStreamByEdit,
  canRenderButtons: capabilities.canRenderButtons,
  canRenderRichCards: capabilities.canRenderRichCards,
  canReplyInThread: capabilities.canReplyInThread,
  canUploadImage: capabilities.canUploadImage,
  canUploadFile: capabilities.canUploadFile,
  canCollectStructuredForm: capabilities.canCollectStructuredForm,
  maxButtonsPerMessage: capabilities.maxButtonsPerMessage,
  maxTextLength: capabilities.maxTextLength
})

const mapDeliveryCommand = (command: DeliveryCommand): ImDeliveryCommand => ({
  deliveryId: command.deliveryId,
  conversationId: command.conversationId,
  bindingId: command.bindingId,
  transportId: command.transportId,
  accountId: command.transportAccountId,
  audience: {
    kind: command.externalThreadId
      ? 'thread'
      : command.externalUserId && (command.channelKind === 'dm' || !command.externalChatId)
        ? 'user'
        : 'chat',
    chatKind:
      command.channelKind === 'dm' || command.channelKind === 'group'
        ? command.channelKind
        : command.channelKind === 'thread'
          ? 'group'
          : null,
    externalChatId: command.externalChatId,
    externalThreadId: command.externalThreadId ?? null,
    externalUserId: command.externalUserId ?? null
  },
  replyContext: normalizeReplyContext(command.replyContext),
  payload: normalizeDeliveryPayload(command.payload),
  policy: {
    preferThread: Boolean(command.externalThreadId),
    splitLongText: true,
    allowCardFallback: true
  }
})

const normalizeReplyContext = (
  replyContext: DeliveryCommand['replyContext']
): ImDeliveryCommand['replyContext'] | undefined => {
  const record =
    replyContext && typeof replyContext === 'object'
      ? (replyContext as Record<string, unknown>)
      : null
  if (!record) return undefined
  const replyToMessageId = readOptionalString(
    record.replyToMessageId ?? record.externalMessageId ?? record.messageId
  )
  const rootMessageId = readOptionalString(record.rootMessageId)
  const mentionUserIds = Array.isArray(record.mentionUserIds)
    ? record.mentionUserIds
        .map((value) => readOptionalString(value))
        .filter((value): value is string => Boolean(value))
    : undefined
  if (!replyToMessageId && !rootMessageId && !mentionUserIds?.length) return undefined
  return {
    ...(replyToMessageId ? { replyToMessageId } : {}),
    ...(rootMessageId ? { rootMessageId } : {}),
    ...(mentionUserIds?.length ? { mentionUserIds } : {})
  }
}

const readOptionalString = (value: unknown): string | undefined => {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

const normalizeDeliveryPayload = (payload: unknown): ImDeliveryPayload => {
  if (isDeliveryPayload(payload)) return payload
  if (typeof payload === 'string') return { kind: 'text', text: payload }
  const record =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  if (typeof record?.text === 'string') return { kind: 'text', text: record.text }
  return { kind: 'text', text: JSON.stringify(payload ?? '') }
}

const isDeliveryPayload = (payload: unknown): payload is ImDeliveryPayload => {
  const kind = (payload as { kind?: unknown } | null)?.kind
  return (
    kind === 'text' ||
    kind === 'markdown' ||
    kind === 'rich_card' ||
    kind === 'interaction' ||
    kind === 'file' ||
    kind === 'typing'
  )
}

const mapDeliveryResult = (result: ImDeliveryResult): DeliveryResult => ({
  status: result.status,
  externalMessageId: result.externalMessageId ?? null,
  degradeMode:
    result.degradeMode === 'text_fallback' || result.degradeMode === 'unsupported'
      ? result.degradeMode
      : undefined,
  error: result.error ?? null,
  raw: result.raw
})
