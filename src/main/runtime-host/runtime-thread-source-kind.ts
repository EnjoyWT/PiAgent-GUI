import type { ConversationSourceKind, CoreQueryService } from '../core-v2/domain.ts'
import { deriveConversationSourceKind } from '../core-v2/domain.ts'
import { buildLocalThreadRoutingKey } from '../core-v2/local-thread-binding.ts'

export type RuntimeThreadSourceKind = ConversationSourceKind | 'unknown'

type RuntimeThreadSourceKindResolver = Pick<
  CoreQueryService,
  'getConversation' | 'getConversationBinding' | 'getConversationByBindingRoutingKey'
>

export const resolveRuntimeThreadSourceKind = (
  core: RuntimeThreadSourceKindResolver,
  threadId: string
): RuntimeThreadSourceKind => {
  const normalizedThreadId = String(threadId ?? '').trim()
  if (!normalizedThreadId) return 'unknown'

  const localMatch = core.getConversationByBindingRoutingKey(
    buildLocalThreadRoutingKey(normalizedThreadId)
  )
  if (localMatch) return 'local'

  const conversation = core.getConversation(normalizedThreadId)
  if (!conversation) return 'unknown'

  const binding = conversation.activeBindingId
    ? core.getConversationBinding(conversation.activeBindingId)
    : null
  if (!binding) return 'unknown'
  return deriveConversationSourceKind(binding.transportId)
}
