import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryCoreService } from '../../../src/main/core-v2/in-memory-core-service.ts'
import { DeliveryCoordinator } from '../../../src/main/delivery/delivery-coordinator.ts'

const createCoreWithConversation = () => {
  const core = new InMemoryCoreService()
  core.upsertAgentProfile({
    id: 'default',
    slug: 'default',
    displayName: 'Default',
    isDefault: true,
    defaultExecutionPolicy: {
      model: {
        providerId: 'openai',
        modelId: 'gpt-5.4'
      },
      contextEngineId: 'summary',
      memoryProviderId: 'local-facts'
    }
  })
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'env-1',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-1',
      externalChatId: 'thread-1',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    desktopVisibilityMode: 'read_write'
  })
  return { core, conversationId: resolved.conversation.id, bindingId: resolved.binding.id }
}

test('delivery coordinator requests text delivery against active binding', () => {
  const { core, conversationId, bindingId } = createCoreWithConversation()
  const coordinator = new DeliveryCoordinator({ core })

  const delivery = coordinator.requestText({
    conversationId,
    text: 'hello'
  })
  const records = core.getDeliveryRecords(conversationId)

  assert.equal(delivery.bindingId, bindingId)
  assert.equal(delivery.mode, 'send')
  assert.equal(JSON.parse(delivery.payloadJson).text, 'hello')
  assert.equal(records.length, 1)
})
