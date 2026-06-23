import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryCoreService } from '../../../src/main/core-v2/in-memory-core-service.ts'
import { resolveRuntimeThreadSourceKind } from '../../../src/main/runtime-host/runtime-thread-source-kind.ts'

const createCore = () => {
  const core = new InMemoryCoreService()
  core.upsertAgentProfile({
    id: 'default',
    slug: 'default',
    displayName: 'Default',
    isDefault: true,
    enabledTransportIds: ['desktop-chat', 'feishu'],
    defaultExecutionPolicy: {
      model: {
        providerId: 'openai',
        modelId: 'gpt-5.4',
        reasoningLevel: 'medium'
      },
      contextEngineId: 'summary',
      memoryProviderId: 'local-facts',
      toolProfileId: 'default',
      sandboxPolicyId: 'workspace-write'
    }
  })
  return core
}

test('resolveRuntimeThreadSourceKind treats desktop thread ids as local', () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'env-local',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-local',
      externalChatId: 'thread-local',
      channelKind: 'dm',
      receivedAt: '2026-04-28T08:00:00.000Z',
      text: 'hello'
    },
    desktopVisibilityMode: 'read_write'
  })

  assert.equal(resolveRuntimeThreadSourceKind(core, 'thread-local'), 'local')
  assert.equal(resolveRuntimeThreadSourceKind(core, resolved.conversation.id), 'local')
})

test('resolveRuntimeThreadSourceKind treats IM conversation ids as im', () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'env-feishu',
      transportId: 'feishu',
      transportAccountId: 'default',
      externalMessageId: 'msg-feishu',
      externalChatId: 'oc_test_chat',
      externalUserId: 'ou_test_user',
      channelKind: 'dm',
      receivedAt: '2026-04-28T08:00:00.000Z',
      text: 'hello'
    },
    desktopVisibilityMode: 'readonly'
  })

  assert.equal(resolveRuntimeThreadSourceKind(core, resolved.conversation.id), 'im')
})

test('resolveRuntimeThreadSourceKind returns unknown for ids with no conversation mapping', () => {
  const core = createCore()

  assert.equal(resolveRuntimeThreadSourceKind(core, 'missing-thread'), 'unknown')
  assert.equal(resolveRuntimeThreadSourceKind(core, ''), 'unknown')
})
