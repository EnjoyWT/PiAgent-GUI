import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryCoreService } from '../../../src/main/core-v2/in-memory-core-service.ts'
import { AgentInstanceManager } from '../../../src/main/runtime-host/agent-instance-manager.ts'

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
        modelId: 'gpt-5.4',
        reasoningLevel: 'medium'
      },
      contextEngineId: 'summary',
      memoryProviderId: 'local-facts',
      toolProfileId: 'default',
      sandboxPolicyId: 'workspace-write'
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
      externalUserId: 'local-user',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    desktopVisibilityMode: 'read_write'
  })
  return { core, conversationId: resolved.conversation.id }
}

test('agent instance manager reuses instance when execution policy is unchanged', () => {
  const { core, conversationId } = createCoreWithConversation()
  const manager = new AgentInstanceManager({ core })

  const first = manager.acquire({ conversationId })
  const second = manager.acquire({ conversationId })

  assert.equal(second.id, first.id)
  assert.equal(second.runtimeGeneration, 1)
})

test('agent instance manager rebuilds when conversation model override changes', () => {
  const { core, conversationId } = createCoreWithConversation()
  const manager = new AgentInstanceManager({ core })

  const first = manager.acquire({ conversationId })
  core.updateConversation({
    conversationId,
    executionOverride: {
      model: {
        providerId: 'google',
        modelId: 'gemini-2.5-flash'
      }
    }
  })
  const second = manager.acquire({ conversationId })

  assert.notEqual(second.id, first.id)
  assert.equal(second.runtimeGeneration, 2)
  assert.equal(second.lastReloadReason, 'execution_policy_change')
  assert.equal(second.effectiveExecutionPolicy.model.providerId, 'google')
})
