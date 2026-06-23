import { deriveBindingRoutingKey } from './domain.ts'
import { normalizeCoreTimestamp } from './time.ts'

export const buildLocalThreadRoutingKey = (threadId: string): string =>
  deriveBindingRoutingKey({
    envelopeId: `local-thread:${threadId}`,
    transportId: 'desktop-chat',
    transportAccountId: 'desktop',
    externalMessageId: `local-thread:${threadId}`,
    externalChatId: threadId,
    channelKind: 'dm',
    receivedAt: normalizeCoreTimestamp()
  })
