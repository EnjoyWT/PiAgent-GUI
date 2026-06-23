import type {
  CoreCommandService,
  CoreQueryService,
  DeliveryMode,
  DeliveryRecord
} from '../core-v2/domain.ts'

export type RequestTextDeliveryInput = {
  conversationId: string
  text: string
  mode?: Extract<DeliveryMode, 'send' | 'edit' | 'append'>
  bindingId?: string | null
}

export type RequestPayloadDeliveryInput = {
  conversationId: string
  payload: unknown
  mode: DeliveryMode
  bindingId?: string | null
}

export type DeliveryCoordinatorDeps = {
  core: Pick<
    CoreCommandService & CoreQueryService,
    'getConversation' | 'getConversationBinding' | 'requestDelivery'
  >
}

export class DeliveryCoordinator {
  private readonly core: DeliveryCoordinatorDeps['core']

  constructor(deps: DeliveryCoordinatorDeps) {
    this.core = deps.core
  }

  requestText(input: RequestTextDeliveryInput): DeliveryRecord {
    return this.requestPayload({
      conversationId: input.conversationId,
      bindingId: input.bindingId ?? null,
      mode: input.mode ?? 'send',
      payload: {
        kind: 'text',
        text: input.text
      }
    })
  }

  requestPayload(input: RequestPayloadDeliveryInput): DeliveryRecord {
    const bindingId = input.bindingId ?? this.resolveActiveBindingId(input.conversationId)
    return this.core.requestDelivery({
      conversationId: input.conversationId,
      bindingId,
      mode: input.mode,
      payload: input.payload
    })
  }

  private resolveActiveBindingId(conversationId: string): string {
    const conversation = this.core.getConversation(conversationId)
    if (!conversation) throw new Error(`Unknown Conversation: ${conversationId}`)
    if (!conversation.activeBindingId) {
      throw new Error(`Conversation has no active binding: ${conversationId}`)
    }
    const binding = this.core.getConversationBinding(conversation.activeBindingId)
    if (!binding) {
      throw new Error(`Conversation active binding is missing: ${conversation.activeBindingId}`)
    }
    return binding.id
  }
}
