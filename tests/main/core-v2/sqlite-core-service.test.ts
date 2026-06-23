import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SqliteCoreService } from '../../../src/main/core-v2/sqlite-core-service.ts'
import { deriveBindingRoutingKey } from '../../../src/main/core-v2/domain.ts'
import { reconcileInterruptedRunsOnStartup } from '../../../src/main/core-v2/startup-run-recovery.ts'

const createService = () => {
  const db = new Database(':memory:')
  const service = new SqliteCoreService(db)

  const profile = service.upsertAgentProfile({
    id: 'default',
    slug: 'default',
    displayName: 'Default',
    isDefault: true,
    enabledTransportIds: ['wecom', 'desktop-chat'],
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

  return { db, service, profile }
}

test('sqlite service persists binding reuse and projection updates', (t) => {
  const { db, service, profile } = createService()
  t.after(() => db.close())
  const first = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-1',
      transportId: 'wecom',
      transportAccountId: 'corp-bot',
      externalMessageId: 'msg-1',
      externalChatId: 'chat-1',
      externalUserId: 'user-1',
      externalUserDisplayName: '张三',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T13:00:00.000Z').toISOString(),
      text: 'hello'
    }
  })

  const second = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    workspaceId: 'repo-a',
    envelope: {
      envelopeId: 'env-2',
      transportId: 'wecom',
      transportAccountId: 'corp-bot',
      externalMessageId: 'msg-2',
      externalChatId: 'chat-1',
      externalUserId: 'user-1',
      externalUserDisplayName: '张三',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T13:01:00.000Z').toISOString(),
      text: 'again'
    }
  })

  const windows = service.listConversationWindows('im')

  assert.equal(first.createdConversation, true)
  assert.equal(second.createdConversation, false)
  assert.equal(first.conversation.id, second.conversation.id)
  assert.equal(windows.length, 1)
  assert.equal(windows[0]?.workspaceId, 'repo-a')
  assert.equal(windows[0]?.primarySourceKind, 'im')
})

test('sqlite service persists IM session metadata and inbound trace rows', (t) => {
  const { db, service, profile } = createService()
  t.after(() => db.close())

  const envelope = {
    envelopeId: 'env-im-meta-1',
    imTraceId: 'trace-im-meta-1',
    dedupeKey: 'feishu:tenant-a:msg-im-meta-1',
    transportId: 'feishu',
    transportAccountId: 'tenant-a',
    externalMessageId: 'msg-im-meta-1',
    externalChatId: 'chat-im-meta-1',
    externalThreadId: 'thread-im-meta-1',
    externalUserId: 'user-im-meta-1',
    externalUserDisplayName: 'Feishu User',
    channelKind: 'thread' as const,
    sessionScope: 'group_per_member' as const,
    sharedMultiUser: false,
    personId: 'person-im-meta-1',
    tenantId: 'tenant-a',
    messageType: 'text' as const,
    routingKey:
      'im:feishu:tenant-a:thread:chat-im-meta-1:thread:thread-im-meta-1:user:user-im-meta-1',
    receivedAt: new Date('2026-04-20T13:00:30.000Z').toISOString(),
    text: 'hello im'
  }

  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope
  })

  const binding = service.getConversationBinding(resolved.binding.id)
  service.appendInboundEnvelope({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    envelope
  })

  const inboundEvent = db
    .prepare(`SELECT * FROM im_inbound_events WHERE im_trace_id = ?`)
    .get(envelope.imTraceId) as Record<string, unknown> | undefined

  assert.equal(binding?.sessionScope, 'group_per_member')
  assert.equal(binding?.sharedMultiUser, false)
  assert.equal(binding?.personId, 'person-im-meta-1')
  assert.equal(binding?.tenantId, 'tenant-a')
  assert.equal(binding?.lastExternalMessageId, 'msg-im-meta-1')
  assert.equal(binding?.lastInboundTraceId, 'trace-im-meta-1')
  assert.equal(inboundEvent?.dedupe_key, 'feishu:tenant-a:msg-im-meta-1')
  assert.equal(inboundEvent?.conversation_id, resolved.conversation.id)
  assert.equal(inboundEvent?.binding_id, resolved.binding.id)
  assert.equal(inboundEvent?.person_id, 'person-im-meta-1')
  assert.equal(inboundEvent?.session_scope, 'group_per_member')
  assert.equal(inboundEvent?.routing_key, envelope.routingKey)
  assert.equal(inboundEvent?.message_type, 'text')
  assert.equal(inboundEvent?.status, 'received')
  assert.equal(JSON.parse(String(inboundEvent?.envelope_json)).text, 'hello im')
})

test('sqlite service persists messages and runs across service instances', (t) => {
  const { db, service, profile } = createService()
  t.after(() => db.close())
  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    executionOverride: {
      model: { modelId: 'gpt-5.4-mini', reasoningLevel: 'low' },
      toolProfileId: 'readonly'
    },
    envelope: {
      envelopeId: 'env-3',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-3',
      externalChatId: 'local-1',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T13:02:00.000Z').toISOString(),
      text: 'run'
    },
    desktopVisibilityMode: 'read_write'
  })

  service.appendInboundEnvelope({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    envelope: {
      envelopeId: 'env-3',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-3',
      externalChatId: 'local-1',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T13:02:00.000Z').toISOString(),
      text: 'run'
    }
  })

  const run = service.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'manual'
  })

  const reloadedService = new SqliteCoreService(db, { migrate: false })
  const messages = reloadedService.getConversationMessages(resolved.conversation.id)
  const persistedRun = reloadedService.getAgentRun(run.id)
  const localWindows = reloadedService.listConversationWindows('local')
  const events = reloadedService.listEventLog().map((entry) => entry.eventType)

  assert.equal(messages.length, 1)
  assert.equal(persistedRun?.requestedExecutionPolicy.model.modelId, 'gpt-5.4-mini')
  assert.equal(persistedRun?.requestedExecutionPolicy.contextEngineId, 'summary')
  assert.equal(persistedRun?.requestedExecutionPolicy.memoryProviderId, 'local-facts')
  assert.equal(localWindows.length, 1)
  assert.equal(localWindows[0]?.primarySourceKind, 'local')
  assert.ok(events.includes('transport.message.received'))
  assert.ok(events.includes('agent.run.requested'))
})

test('sqlite service persists interactions and deliveries', (t) => {
  const { db, service, profile } = createService()
  t.after(() => db.close())

  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-4',
      transportId: 'wecom',
      transportAccountId: 'corp-bot',
      externalMessageId: 'msg-4',
      externalChatId: 'chat-4',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T13:03:00.000Z').toISOString(),
      text: 'need approval'
    }
  })

  const checkpoint = service.requestInteraction({
    conversationId: resolved.conversation.id,
    expectedBindingId: resolved.binding.id,
    expectedPersonId: 'person-approval-1',
    acceptedReplyModes: ['reply', 'button'],
    expiresAt: new Date('2026-04-20T13:33:00.000Z').toISOString(),
    kind: 'approval',
    prompt: 'ship it?'
  })
  const delivery = service.requestDelivery({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    mode: 'send',
    transportDeliveryMode: 'reply',
    replyContext: { externalMessageId: 'msg-4', platform: 'feishu' },
    degradeMode: 'send_new',
    externalMessageId: 'out-msg-4',
    doctorTraceId: 'doctor-delivery-4',
    payload: { text: 'hello back' }
  })

  const pending = service.listPendingInteractions(resolved.conversation.id)
  const projectionBefore = service.listConversationWindows('im')[0]

  service.answerInteraction({ interactionId: checkpoint.id })

  const projectionAfter = service.listConversationWindows('im')[0]
  const deliveries = service.getDeliveryRecords(resolved.conversation.id)

  assert.equal(delivery.status, 'requested')
  assert.equal(checkpoint.expectedBindingId, resolved.binding.id)
  assert.equal(checkpoint.expectedPersonId, 'person-approval-1')
  assert.deepEqual(checkpoint.acceptedReplyModes, ['reply', 'button'])
  assert.equal(new Date(checkpoint.expiresAt ?? '').toISOString(), '2026-04-20T13:33:00.000Z')
  assert.equal(pending.length, 1)
  assert.deepEqual(pending[0]?.acceptedReplyModes, ['reply', 'button'])
  assert.equal(projectionBefore?.pendingInteractionKind, 'approval')
  assert.equal(projectionBefore?.needsAttention, true)
  assert.equal(projectionAfter?.pendingInteractionKind, null)
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0]?.transportDeliveryMode, 'reply')
  assert.deepEqual(deliveries[0]?.replyContext, { externalMessageId: 'msg-4', platform: 'feishu' })
  assert.equal(deliveries[0]?.degradeMode, 'send_new')
  assert.equal(deliveries[0]?.externalMessageId, 'out-msg-4')
  assert.equal(deliveries[0]?.doctorTraceId, 'doctor-delivery-4')
  assert.equal(deliveries[0]?.lastError, null)
  assert.equal(deliveries[0]?.attemptCount, 0)
})

test('sqlite service cancels pending interactions', (t) => {
  const { db, service, profile } = createService()
  t.after(() => db.close())

  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-4-cancel',
      transportId: 'wecom',
      transportAccountId: 'corp-bot',
      externalMessageId: 'msg-4-cancel',
      externalChatId: 'chat-4-cancel',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T13:03:30.000Z').toISOString(),
      text: 'need input'
    }
  })

  const checkpoint = service.requestInteraction({
    conversationId: resolved.conversation.id,
    kind: 'text_input',
    prompt: 'confirm'
  })

  service.cancelInteraction({ interactionId: checkpoint.id })

  const projectionAfter = service.listConversationWindows('im')[0]
  const eventTypes = service.listEventLog().map((entry) => entry.eventType)

  assert.equal(service.listPendingInteractions(resolved.conversation.id).length, 0)
  assert.equal(projectionAfter?.pendingInteractionKind, null)
  assert.ok(eventTypes.includes('interaction.cancelled'))
})

test('sqlite service upserts imported runs and runtime events', (t) => {
  const { db, service, profile } = createService()
  t.after(() => db.close())

  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-5',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-5',
      externalChatId: 'local-5',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T13:04:00.000Z').toISOString(),
      text: 'import run'
    },
    desktopVisibilityMode: 'read_write'
  })

  const run = service.upsertAgentRun({
    id: 'legacy-run-5',
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    requestedExecutionPolicy: profile.defaultExecutionPolicy,
    effectiveExecutionSnapshot: {
      ...profile.defaultExecutionPolicy,
      model: { ...profile.defaultExecutionPolicy.model },
      resolvedAt: new Date('2026-04-20T13:04:01.000Z').toISOString()
    },
    status: 'finished',
    traceId: 'legacy-run-5',
    startedAt: new Date('2026-04-20T13:04:01.000Z').toISOString(),
    endedAt: new Date('2026-04-20T13:04:05.000Z').toISOString()
  })

  const firstEvent = service.upsertEventLogEntry({
    id: 'legacy-event-5',
    eventType: 'agentTurnFinished',
    traceId: 'legacy-run-5',
    correlationId: 'legacy-run-5',
    aggregateType: 'agent_run',
    aggregateId: run.id,
    payload: { step: 1 },
    createdAt: new Date('2026-04-20T13:04:05.000Z').toISOString()
  })

  service.upsertEventLogEntry({
    id: 'legacy-event-5',
    eventType: 'agentTurnFinished',
    traceId: 'legacy-run-5',
    correlationId: 'legacy-run-5',
    aggregateType: 'agent_run',
    aggregateId: run.id,
    payload: { step: 1, updated: true },
    createdAt: new Date('2026-04-20T13:04:06.000Z').toISOString()
  })

  const reloadedService = new SqliteCoreService(db, { migrate: false })
  const runs = reloadedService.listConversationRuns(resolved.conversation.id)
  const event = reloadedService.listEventLog().find((entry) => entry.id === 'legacy-event-5')
  const projection = reloadedService.listConversationWindows('local')[0]

  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.status, 'finished')
  assert.equal(event?.sequence, firstEvent.sequence)
  assert.match(event?.payloadJson ?? '', /updated/)
  assert.equal(projection?.lastRunStatus, 'finished')
})

test('sqlite service recovers interrupted startup runs as aborted', (t) => {
  const { db, service, profile } = createService()
  t.after(() => db.close())

  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-startup-recovery',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-startup-recovery',
      externalChatId: 'local-startup-recovery',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T13:04:30.000Z').toISOString(),
      text: 'recover me'
    },
    desktopVisibilityMode: 'read_write'
  })

  const requestedRun = service.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'manual'
  })

  const runningRunBase = service.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'manual'
  })
  service.upsertAgentRun({
    id: runningRunBase.id,
    conversationId: runningRunBase.conversationId,
    instanceId: runningRunBase.instanceId ?? null,
    triggerKind: runningRunBase.triggerKind,
    requestedExecutionPolicy: runningRunBase.requestedExecutionPolicy,
    effectiveExecutionSnapshot: runningRunBase.effectiveExecutionSnapshot,
    status: 'running',
    traceId: runningRunBase.traceId,
    startedAt: runningRunBase.startedAt,
    endedAt: null
  })

  const waitingRunBase = service.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'manual'
  })
  service.upsertAgentRun({
    id: waitingRunBase.id,
    conversationId: waitingRunBase.conversationId,
    instanceId: waitingRunBase.instanceId ?? null,
    triggerKind: waitingRunBase.triggerKind,
    requestedExecutionPolicy: waitingRunBase.requestedExecutionPolicy,
    effectiveExecutionSnapshot: waitingRunBase.effectiveExecutionSnapshot,
    status: 'waiting_interaction',
    traceId: waitingRunBase.traceId,
    startedAt: waitingRunBase.startedAt,
    endedAt: null
  })

  const checkpoint = service.requestInteraction({
    conversationId: resolved.conversation.id,
    runId: waitingRunBase.id,
    kind: 'text_input',
    prompt: 'continue?'
  })

  const recoveredAt = '2026-04-20T13:05:00.000Z'
  const recovered = reconcileInterruptedRunsOnStartup(service, { recoveredAt })

  const runs = service.listConversationRuns(resolved.conversation.id)
  const byId = new Map(runs.map((run) => [run.id, run]))
  const projection = service.listConversationWindows('local')[0]

  assert.deepEqual(
    recovered.abortedRunIds.sort(),
    [requestedRun.id, runningRunBase.id, waitingRunBase.id].sort()
  )
  assert.deepEqual(recovered.cancelledInteractionIds, [checkpoint.id])
  assert.equal(byId.get(requestedRun.id)?.status, 'aborted')
  assert.equal(byId.get(runningRunBase.id)?.status, 'aborted')
  assert.equal(byId.get(waitingRunBase.id)?.status, 'aborted')
  assert.equal(byId.get(requestedRun.id)?.endedAt, recovered.recoveredAt)
  assert.equal(byId.get(runningRunBase.id)?.endedAt, recovered.recoveredAt)
  assert.equal(byId.get(waitingRunBase.id)?.endedAt, recovered.recoveredAt)
  assert.equal(service.listPendingInteractions(resolved.conversation.id).length, 0)
  assert.equal(projection?.lastRunStatus, 'aborted')
  assert.equal(projection?.pendingInteractionKind, null)
})

test('sqlite service can resolve and delete conversation by routing key', (t) => {
  const { db, service, profile } = createService()
  t.after(() => db.close())

  const envelope = {
    envelopeId: 'env-6',
    transportId: 'desktop-chat',
    transportAccountId: 'desktop',
    externalMessageId: 'msg-6',
    externalChatId: 'local-6',
    channelKind: 'dm' as const,
    receivedAt: new Date('2026-04-20T13:05:00.000Z').toISOString(),
    text: 'local delete'
  }

  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope,
    desktopVisibilityMode: 'read_write'
  })

  const routingKey = deriveBindingRoutingKey(envelope)
  const matched = service.getConversationByBindingRoutingKey(routingKey)
  const deleted = service.deleteConversation({ conversationId: resolved.conversation.id })
  const afterDelete = service.getConversationByBindingRoutingKey(routingKey)

  assert.equal(matched?.conversation.id, resolved.conversation.id)
  assert.equal(matched?.binding.id, resolved.binding.id)
  assert.equal(deleted, true)
  assert.equal(afterDelete, null)
  assert.equal(service.listConversationWindows('local').length, 0)
})

test('sqlite service deletes conversation messages and prunes runtime after cutoff', (t) => {
  const { db, service, profile } = createService()
  t.after(() => db.close())

  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-7',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-7',
      externalChatId: 'local-7',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T13:06:00.000Z').toISOString(),
      text: 'hello'
    },
    desktopVisibilityMode: 'read_write'
  })

  service.upsertConversationMessage({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    externalMessageId: 'local-user-7',
    role: 'user',
    direction: 'inbound',
    text: 'hello',
    payload: { legacy: { messageKind: 'chat' } },
    createdAt: new Date('2026-04-20T13:06:01.000Z').toISOString()
  })
  service.upsertConversationMessage({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    externalMessageId: 'local-assistant-7',
    role: 'assistant',
    direction: 'outbound',
    text: 'world',
    payload: { legacy: { messageKind: 'chat' } },
    createdAt: new Date('2026-04-20T13:06:02.000Z').toISOString()
  })
  service.upsertConversationMessage({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    externalMessageId: 'local-user-after-cutoff-7',
    role: 'user',
    direction: 'inbound',
    text: 'stale user branch',
    payload: { legacy: { messageKind: 'chat' } },
    createdAt: new Date('2026-04-20T13:06:02.750Z').toISOString()
  })
  service.upsertConversationMessage({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    externalMessageId: 'local-question-answer-after-cutoff-7',
    role: 'user',
    direction: 'inbound',
    text: 'stale question answer',
    payload: { legacy: { messageKind: 'question_answer' } },
    createdAt: new Date('2026-04-20T13:06:02.800Z').toISOString()
  })
  service.upsertAgentRun({
    id: 'run-7',
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    requestedExecutionPolicy: profile.defaultExecutionPolicy,
    effectiveExecutionSnapshot: {
      ...profile.defaultExecutionPolicy,
      model: { ...profile.defaultExecutionPolicy.model },
      resolvedAt: new Date('2026-04-20T13:06:03.000Z').toISOString()
    },
    status: 'finished',
    traceId: 'run-7',
    projectionText: 'world',
    projectionTurns: [],
    startedAt: new Date('2026-04-20T13:06:03.000Z').toISOString(),
    endedAt: new Date('2026-04-20T13:06:04.000Z').toISOString()
  })
  service.upsertEventLogEntry({
    id: 'run-7-event',
    eventType: 'agentRunFinished',
    traceId: 'run-7',
    correlationId: 'run-7',
    aggregateType: 'agent_run',
    aggregateId: 'run-7',
    payload: { ok: true },
    createdAt: new Date('2026-04-20T13:06:04.000Z').toISOString()
  })

  const deleted = service.deleteConversationMessage({
    conversationId: resolved.conversation.id,
    externalMessageId: 'local-assistant-7'
  })
  service.pruneConversationRuntimeAfter({
    conversationId: resolved.conversation.id,
    cutoffCreatedAt: new Date('2026-04-20T13:06:02.500Z').toISOString()
  })

  const messages = service.getConversationMessages(resolved.conversation.id)
  const runs = service.listConversationRuns(resolved.conversation.id)
  const events = service.listEventLog().filter((entry) => entry.aggregateId === 'run-7')

  assert.equal(deleted, true)
  assert.deepEqual(
    messages.map((message) => message.externalMessageId),
    ['local-user-7']
  )
  assert.equal(runs.length, 0)
  assert.equal(events.length, 0)
})

test('sqlite service prunes a run that started just before cutoff but ended after it', (t) => {
  const { db, service, profile } = createService()
  t.after(() => db.close())

  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-8',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-8',
      externalChatId: 'local-8',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T13:07:00.900Z').toISOString(),
      text: 'hello again'
    },
    desktopVisibilityMode: 'read_write'
  })

  service.upsertConversationMessage({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    externalMessageId: 'local-user-8',
    role: 'user',
    direction: 'inbound',
    text: 'hello again',
    payload: { legacy: { messageKind: 'chat' } },
    createdAt: new Date('2026-04-20T13:07:01.000Z').toISOString()
  })
  service.upsertConversationMessage({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    externalMessageId: 'local-assistant-8',
    role: 'assistant',
    direction: 'outbound',
    text: 'new world',
    payload: {
      localThread: {
        messageKind: 'chat',
        agentRunId: 'run-8',
        agentTurnId: 'turn-8'
      }
    },
    createdAt: new Date('2026-04-20T13:07:04.000Z').toISOString()
  })
  service.upsertAgentRun({
    id: 'run-8',
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    requestedExecutionPolicy: profile.defaultExecutionPolicy,
    effectiveExecutionSnapshot: {
      ...profile.defaultExecutionPolicy,
      model: { ...profile.defaultExecutionPolicy.model },
      resolvedAt: new Date('2026-04-20T13:07:00.999Z').toISOString()
    },
    status: 'finished',
    traceId: 'run-8',
    projectionText: 'new world',
    projectionTurns: [
      {
        agentTurnId: 'turn-8',
        index: 0,
        status: 'done',
        startedAt: Date.parse('2026-04-20T13:07:00.999Z'),
        endedAt: Date.parse('2026-04-20T13:07:04.000Z'),
        text: 'new world',
        toolCalls: []
      }
    ],
    startedAt: new Date('2026-04-20T13:07:00.999Z').toISOString(),
    endedAt: new Date('2026-04-20T13:07:04.000Z').toISOString()
  })
  service.upsertEventLogEntry({
    id: 'run-8-event',
    eventType: 'agent.run.upserted',
    traceId: 'run-8',
    correlationId: 'run-8',
    aggregateType: 'agent_run',
    aggregateId: 'run-8',
    payload: {
      projectionText: 'new world',
      projectionTurns: [
        {
          agentTurnId: 'turn-8',
          index: 0,
          status: 'done',
          startedAt: Date.parse('2026-04-20T13:07:00.999Z'),
          endedAt: Date.parse('2026-04-20T13:07:04.000Z'),
          text: 'new world',
          toolCalls: []
        }
      ]
    },
    createdAt: new Date('2026-04-20T13:07:04.000Z').toISOString()
  })

  service.deleteConversationMessage({
    conversationId: resolved.conversation.id,
    externalMessageId: 'local-assistant-8'
  })
  service.pruneConversationRuntimeAfter({
    conversationId: resolved.conversation.id,
    cutoffCreatedAt: new Date('2026-04-20T13:07:01.000Z').toISOString()
  })

  const messages = service.getConversationMessages(resolved.conversation.id)
  const runs = service.listConversationRuns(resolved.conversation.id)
  const events = service.listEventLog().filter((entry) => entry.aggregateId === 'run-8')

  assert.deepEqual(
    messages.map((message) => message.externalMessageId),
    ['local-user-8']
  )
  assert.equal(runs.length, 0)
  assert.equal(events.length, 0)
})
