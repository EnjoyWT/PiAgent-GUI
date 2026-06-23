import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SqliteCoreService } from '../../../src/main/core-v2/sqlite-core-service.ts'
import { RunScheduler } from '../../../src/main/runtime-host/run-scheduler.ts'
import { AgentInstanceManager } from '../../../src/main/runtime-host/agent-instance-manager.ts'
import {
  ImRuntimeCoordinator,
  type ImRuntimeInboundResult,
  type ImRuntimeScheduledResult
} from '../../../src/main/im/im-runtime-coordinator.ts'
import { ImDoctorPlane } from '../../../src/main/im/im-doctor-plane.ts'
import type { ImTransportInboundEvent } from '../../../src/main/im/im-inbound-types.ts'

function assertScheduledResult(
  result: ImRuntimeInboundResult
): asserts result is ImRuntimeScheduledResult {
  assert.equal(result.action, 'scheduled')
}

const createCore = () => {
  const db = new Database(':memory:')
  const core = new SqliteCoreService(db)
  core.upsertAgentProfile({
    id: 'default',
    slug: 'default',
    displayName: 'Default',
    isDefault: true,
    enabledTransportIds: ['feishu'],
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
  return { db, core }
}

const baseEvent = (): ImTransportInboundEvent => ({
  id: 'evt-feishu-1',
  transportId: 'feishu',
  accountId: 'tenant-bot',
  receivedAt: '2026-04-28T06:00:00.000Z',
  platform: {
    tenantId: 'tenant-a',
    appId: 'app-a'
  },
  chat: {
    id: 'chat-a',
    kind: 'group',
    title: '研发群',
    tenantId: 'tenant-a'
  },
  sender: {
    id: 'ou-user-a',
    displayName: '张三',
    tenantId: 'tenant-a',
    unionId: 'union-a',
    isBot: false
  },
  thread: null,
  message: {
    id: 'msg-a',
    type: 'text',
    text: 'hello runtime'
  }
})

test('IM runtime coordinator ingests normalized transport events into core and scheduler', (t) => {
  const { db, core } = createCore()
  t.after(() => db.close())
  const scheduler = new RunScheduler({
    instanceManager: new AgentInstanceManager({ core })
  })
  const doctorPlane = new ImDoctorPlane()
  const coordinator = new ImRuntimeCoordinator({
    core,
    runScheduler: scheduler,
    resolveAgentProfileId: () => 'default',
    doctorPlane
  })

  const result = coordinator.ingestTransportEvent(baseEvent())
  assertScheduledResult(result)
  const conversation = core.getConversation(result.conversationId)
  const messages = core.getConversationMessages(result.conversationId)
  const runs = core.listConversationRuns(result.conversationId)
  const binding = core.getConversationBinding(result.binding.id)
  const inboundEvent = db
    .prepare(`SELECT * FROM im_inbound_events WHERE im_trace_id = ?`)
    .get('im:feishu:tenant-bot:msg-a') as Record<string, unknown> | undefined

  assert.equal(conversation?.desktopVisibilityMode, 'readonly')
  assert.equal(binding?.routingKey, 'im:feishu:tenant-bot:group:chat-a:user:ou-user-a')
  assert.equal(binding?.sessionScope, 'group_per_member')
  assert.equal(binding?.sharedMultiUser, false)
  assert.equal(binding?.personId, 'im-person:feishu:tenant-a:union-a')
  assert.equal(binding?.tenantId, 'tenant-a')
  assert.equal(binding?.lastInboundTraceId, 'im:feishu:tenant-bot:msg-a')
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.text, 'hello runtime')
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.triggerKind, 'transport_message')
  assert.equal(runs[0]?.traceId, 'im:feishu:tenant-bot:msg-a')
  assert.equal(result.scheduleDecision.action, 'start')
  assert.equal(inboundEvent?.dedupe_key, 'feishu:tenant-bot:msg-a')
  assert.equal(inboundEvent?.person_id, 'im-person:feishu:tenant-a:union-a')
  assert.equal(inboundEvent?.session_scope, 'group_per_member')
  assert.equal(inboundEvent?.routing_key, 'im:feishu:tenant-bot:group:chat-a:user:ou-user-a')
  assert.deepEqual(
    doctorPlane.getTrace('im:feishu:tenant-bot:msg-a')?.steps.map((step) => step.step),
    [
      'transport_received',
      'normalized',
      'dedupe_checked',
      'identity_resolved',
      'conversation_resolved',
      'run_decided'
    ]
  )
})

test('IM runtime coordinator dedupes repeated inbound events before appending or scheduling', (t) => {
  const { db, core } = createCore()
  t.after(() => db.close())
  const scheduler = new RunScheduler({
    instanceManager: new AgentInstanceManager({ core })
  })
  const doctorPlane = new ImDoctorPlane()
  const coordinator = new ImRuntimeCoordinator({
    core,
    runScheduler: scheduler,
    resolveAgentProfileId: () => 'default',
    doctorPlane
  })

  const first = coordinator.ingestTransportEvent(baseEvent())
  assertScheduledResult(first)
  const duplicate = coordinator.ingestTransportEvent({
    ...baseEvent(),
    id: 'evt-feishu-duplicate'
  })

  const messages = core.getConversationMessages(first.conversationId)
  const runs = core.listConversationRuns(first.conversationId)
  const inboundEvents = db
    .prepare(`SELECT * FROM im_inbound_events WHERE dedupe_key = ?`)
    .all('feishu:tenant-bot:msg-a') as Record<string, unknown>[]

  assert.equal(duplicate.action, 'deduped')
  assert.equal(messages.length, 1)
  assert.equal(runs.length, 1)
  assert.equal(inboundEvents.length, 1)
  assert.deepEqual(
    doctorPlane
      .getTrace('im:feishu:tenant-bot:msg-a')
      ?.steps.filter((step) => step.step === 'dedupe_checked')
      .map((step) => step.status),
    ['pass', 'warn']
  )
})

test('IM runtime coordinator handles /status command without requesting an agent run', (t) => {
  const { db, core } = createCore()
  t.after(() => db.close())
  const scheduler = new RunScheduler({
    instanceManager: new AgentInstanceManager({ core })
  })
  const doctorPlane = new ImDoctorPlane()
  const coordinator = new ImRuntimeCoordinator({
    core,
    runScheduler: scheduler,
    resolveAgentProfileId: () => 'default',
    doctorPlane
  })

  const result = coordinator.ingestTransportEvent({
    ...baseEvent(),
    message: {
      id: 'msg-status',
      type: 'text',
      text: '/status'
    }
  })

  assert.equal(result.action, 'command_handled')
  assert.equal(result.command, 'status')
  assert.equal(core.getConversationMessages(result.conversationId).length, 1)
  assert.equal(core.listConversationRuns(result.conversationId).length, 0)
  const deliveries = core.getDeliveryRecords(result.conversationId)
  assert.equal(deliveries.length, 1)
  assert.match(deliveries[0]?.payloadJson ?? '', /Session/)
  assert.ok(
    doctorPlane
      .getTrace('im:feishu:tenant-bot:msg-status')
      ?.steps.some((step) => step.step === 'command_checked' && step.status === 'pass')
  )
})

test('IM runtime coordinator handles /stop command without queueing a new run', (t) => {
  const { db, core } = createCore()
  t.after(() => db.close())
  const scheduler = new RunScheduler({
    instanceManager: new AgentInstanceManager({ core })
  })
  const doctorPlane = new ImDoctorPlane()
  const coordinator = new ImRuntimeCoordinator({
    core,
    runScheduler: scheduler,
    resolveAgentProfileId: () => 'default',
    doctorPlane
  })

  const first = coordinator.ingestTransportEvent(baseEvent())
  assertScheduledResult(first)
  const result = coordinator.ingestTransportEvent({
    ...baseEvent(),
    id: 'evt-feishu-stop',
    message: {
      id: 'msg-stop',
      type: 'text',
      text: '/stop'
    }
  })

  assert.equal(result.action, 'command_handled')
  assert.equal(result.command, 'stop')
  assert.equal(core.listConversationRuns(first.conversationId).length, 1)
  assert.equal(scheduler.listQueuedRuns(first.conversationId).length, 0)
  assert.match(
    core.getDeliveryRecords(first.conversationId)[0]?.payloadJson ?? '',
    /Stopped|No active run/
  )
})

test('IM runtime coordinator replies to unknown slash commands without requesting an agent run', (t) => {
  const { db, core } = createCore()
  t.after(() => db.close())
  const scheduler = new RunScheduler({
    instanceManager: new AgentInstanceManager({ core })
  })
  const doctorPlane = new ImDoctorPlane()
  const coordinator = new ImRuntimeCoordinator({
    core,
    runScheduler: scheduler,
    resolveAgentProfileId: () => 'default',
    doctorPlane
  })

  const result = coordinator.ingestTransportEvent({
    ...baseEvent(),
    id: 'evt-feishu-unknown-command',
    message: {
      id: 'msg-unknown-command',
      type: 'text',
      text: '/x'
    }
  })

  assert.equal(result.action, 'command_handled')
  assert.equal(result.command, 'x')
  assert.equal(core.getConversationMessages(result.conversationId).length, 1)
  assert.equal(core.listConversationRuns(result.conversationId).length, 0)
  const deliveries = core.getDeliveryRecords(result.conversationId)
  assert.equal(deliveries.length, 1)
  assert.match(deliveries[0]?.payloadJson ?? '', /Unknown command: \/x/)
  assert.match(
    deliveries[0]?.payloadJson ?? '',
    /Available: \/help \/status \/doctor \/queue \/session \/model \/models \/stop \/reset/
  )
  assert.ok(
    doctorPlane
      .getTrace('im:feishu:tenant-bot:msg-unknown-command')
      ?.steps.some((step) => step.step === 'command_checked' && step.status === 'warn')
  )
})

test('IM runtime coordinator routes text replies to pending interactions before requesting a run', (t) => {
  const { db, core } = createCore()
  t.after(() => db.close())
  const scheduler = new RunScheduler({
    instanceManager: new AgentInstanceManager({ core })
  })
  const doctorPlane = new ImDoctorPlane()
  const coordinator = new ImRuntimeCoordinator({
    core,
    runScheduler: scheduler,
    resolveAgentProfileId: () => 'default',
    doctorPlane
  })

  const first = coordinator.ingestTransportEvent(baseEvent())
  assertScheduledResult(first)
  const checkpoint = core.requestInteraction({
    conversationId: first.conversationId,
    runId: first.run.id,
    expectedBindingId: first.binding.id,
    expectedPersonId: first.binding.personId,
    acceptedReplyModes: ['text'],
    kind: 'approval',
    prompt: 'Approve deployment?'
  })

  const result = coordinator.ingestTransportEvent({
    ...baseEvent(),
    id: 'evt-feishu-approval',
    message: {
      id: 'msg-approval',
      type: 'text',
      text: 'yes'
    }
  })

  assert.equal(result.action, 'interaction_handled')
  assert.equal(result.interactionId, checkpoint.id)
  assert.equal(core.listPendingInteractions(first.conversationId).length, 0)
  assert.equal(core.listConversationRuns(first.conversationId).length, 1)
  assert.match(core.getDeliveryRecords(first.conversationId).at(-1)?.payloadJson ?? '', /answered/i)
  assert.ok(
    doctorPlane
      .getTrace('im:feishu:tenant-bot:msg-approval')
      ?.steps.some((step) => step.step === 'interaction_checked' && step.status === 'pass')
  )
})
