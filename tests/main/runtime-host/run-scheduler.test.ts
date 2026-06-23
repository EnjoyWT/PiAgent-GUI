import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryCoreService } from '../../../src/main/core-v2/in-memory-core-service.ts'
import { AgentInstanceManager } from '../../../src/main/runtime-host/agent-instance-manager.ts'
import { RunScheduler } from '../../../src/main/runtime-host/run-scheduler.ts'

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
      transportId: 'wecom',
      transportAccountId: 'corp-a',
      externalMessageId: 'msg-1',
      externalChatId: 'chat-a',
      channelKind: 'group',
      receivedAt: '2026-04-20T08:00:00.000Z'
    }
  })
  return { core, conversationId: resolved.conversation.id }
}

test('run scheduler starts first run and queues concurrent runs for same conversation', () => {
  const { core, conversationId } = createCoreWithConversation()
  const instanceManager = new AgentInstanceManager({ core })
  const scheduler = new RunScheduler({ instanceManager })
  const firstRun = core.requestRun({ conversationId, triggerKind: 'transport_message' })
  const secondRun = core.requestRun({ conversationId, triggerKind: 'transport_message' })

  const firstDecision = scheduler.schedule(firstRun)
  const secondDecision = scheduler.schedule(secondRun)

  assert.equal(firstDecision.action, 'start')
  assert.equal(secondDecision.action, 'queued')
  assert.equal(scheduler.listQueuedRuns(conversationId).length, 1)
})

test('run scheduler starts next queued run when active run completes', () => {
  const { core, conversationId } = createCoreWithConversation()
  const instanceManager = new AgentInstanceManager({ core })
  const scheduler = new RunScheduler({ instanceManager })
  const firstRun = core.requestRun({ conversationId, triggerKind: 'transport_message' })
  const secondRun = core.requestRun({ conversationId, triggerKind: 'transport_message' })

  scheduler.schedule(firstRun)
  scheduler.schedule(secondRun)
  const nextDecision = scheduler.completeActiveRun(conversationId)

  assert.equal(nextDecision?.action, 'start')
  assert.equal(nextDecision?.run.id, secondRun.id)
  assert.equal(scheduler.listQueuedRuns(conversationId).length, 0)
})

test('run scheduler stop disposes active instance so a new run can acquire fresh runtime', () => {
  const { core, conversationId } = createCoreWithConversation()
  const instanceManager = new AgentInstanceManager({ core })
  const scheduler = new RunScheduler({ instanceManager })
  const run = core.requestRun({ conversationId, triggerKind: 'transport_message' })

  scheduler.schedule(run)
  const result = scheduler.stopConversation(conversationId)

  assert.equal(result.stoppedActiveRun, true)
  assert.equal(instanceManager.get(conversationId)?.status, 'disposed')
})

test('run scheduler reset stops active run and clears queued runs', () => {
  const { core, conversationId } = createCoreWithConversation()
  const instanceManager = new AgentInstanceManager({ core })
  const scheduler = new RunScheduler({ instanceManager })
  const firstRun = core.requestRun({ conversationId, triggerKind: 'transport_message' })
  const secondRun = core.requestRun({ conversationId, triggerKind: 'transport_message' })

  scheduler.schedule(firstRun)
  scheduler.schedule(secondRun)
  const result = scheduler.resetConversation(conversationId)

  assert.equal(result.stoppedActiveRun, true)
  assert.equal(result.clearedQueueLength, 1)
  assert.equal(scheduler.listQueuedRuns(conversationId).length, 0)
})
