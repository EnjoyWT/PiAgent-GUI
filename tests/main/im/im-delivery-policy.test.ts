import test from 'node:test'
import assert from 'node:assert/strict'
import { planImDeliveryCommand } from '../../../src/main/im/im-delivery-policy.ts'
import type {
  DeliveryCommand,
  TransportCapabilities
} from '../../../src/main/transport/transport-contract.ts'

const baseCommand = (payload: unknown): DeliveryCommand => ({
  deliveryId: 'delivery-1',
  conversationId: 'conversation-1',
  bindingId: 'binding-1',
  transportId: 'feishu',
  transportAccountId: 'bot-a',
  externalChatId: 'chat-a',
  externalThreadId: null,
  externalUserId: 'user-a',
  channelKind: 'group',
  mode: 'send',
  payload
})

const capabilities = (overrides: Partial<TransportCapabilities> = {}): TransportCapabilities => ({
  canEditMessage: false,
  canStreamByEdit: false,
  canRenderButtons: false,
  canRenderRichCards: false,
  canReplyInThread: true,
  canUploadImage: false,
  canUploadFile: false,
  canCollectStructuredForm: false,
  maxTextLength: 8,
  ...overrides
})

test('delivery policy falls back rich cards to text when cards are unsupported', () => {
  const plan = planImDeliveryCommand(
    baseCommand({
      kind: 'rich_card',
      card: { title: 'Deploy' },
      fallbackText: 'Deploy requested'
    }),
    capabilities()
  )

  assert.equal(plan.degradeMode, 'text_fallback')
  assert.equal(plan.commands.length, 2)
  assert.deepEqual(
    plan.commands.map((command) => command.payload),
    [
      { kind: 'text', text: 'Deploy r' },
      { kind: 'text', text: 'equested' }
    ]
  )
})

test('delivery policy splits long text payloads by transport max length', () => {
  const plan = planImDeliveryCommand(
    baseCommand({ kind: 'text', text: 'abcdefghijklmnop' }),
    capabilities()
  )

  assert.equal(plan.degradeMode, null)
  assert.deepEqual(
    plan.commands.map((command) => command.payload),
    [
      { kind: 'text', text: 'abcdefgh' },
      { kind: 'text', text: 'ijklmnop' }
    ]
  )
})
