import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryCoreService } from '../../../src/main/core-v2/in-memory-core-service.ts'
import { deriveBindingRoutingKey } from '../../../src/main/core-v2/domain.ts'

const createService = () => {
  const service = new InMemoryCoreService()

  const profile = service.upsertAgentProfile({
    id: 'default',
    slug: 'default',
    displayName: 'Default',
    isDefault: true,
    enabledTransportIds: ['wecom', 'desktop'],
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

  return { service, profile }
}

test('resolveConversationForEnvelope creates and then reuses the same binding', () => {
  const { service, profile } = createService()
  const envelope = {
    envelopeId: 'env-1',
    transportId: 'wecom',
    transportAccountId: 'corp-bot',
    externalMessageId: 'msg-1',
    externalChatId: 'chat-1',
    externalThreadId: null,
    externalUserId: 'user-1',
    externalUserDisplayName: '张三',
    channelKind: 'dm' as const,
    receivedAt: new Date('2026-04-20T12:00:00.000Z').toISOString(),
    text: 'hello'
  }

  const first = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope,
    workspaceId: null
  })

  const second = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: { ...envelope, envelopeId: 'env-2', externalMessageId: 'msg-2' },
    workspaceId: 'repo-a'
  })

  assert.equal(first.createdConversation, true)
  assert.equal(first.createdBinding, true)
  assert.equal(second.createdConversation, false)
  assert.equal(second.createdBinding, false)
  assert.equal(first.conversation.id, second.conversation.id)
  assert.equal(first.binding.id, second.binding.id)
  assert.equal(second.conversation.workspaceId, 'repo-a')
})

test('in-memory service preserves IM session and identity metadata', () => {
  const { service, profile } = createService()
  const envelope = {
    envelopeId: 'env-im-memory-1',
    imTraceId: 'trace-im-memory-1',
    dedupeKey: 'feishu:tenant-a:msg-im-memory-1',
    transportId: 'feishu',
    transportAccountId: 'tenant-a',
    externalMessageId: 'msg-im-memory-1',
    externalChatId: 'chat-im-memory-1',
    externalThreadId: 'thread-im-memory-1',
    externalUserId: 'user-im-memory-1',
    externalUserDisplayName: 'Memory User',
    channelKind: 'thread' as const,
    sessionScope: 'thread_per_member' as const,
    sharedMultiUser: false,
    personId: 'person-im-memory-1',
    tenantId: 'tenant-a',
    messageType: 'text' as const,
    routingKey:
      'im:feishu:tenant-a:thread:chat-im-memory-1:thread:thread-im-memory-1:user:user-im-memory-1',
    receivedAt: new Date('2026-04-20T12:00:30.000Z').toISOString(),
    text: 'hello memory'
  }

  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope
  })
  const binding = service.getConversationBinding(resolved.binding.id)

  assert.equal(binding?.sessionScope, 'thread_per_member')
  assert.equal(binding?.sharedMultiUser, false)
  assert.equal(binding?.personId, 'person-im-memory-1')
  assert.equal(binding?.tenantId, 'tenant-a')
  assert.equal(binding?.lastExternalMessageId, 'msg-im-memory-1')
  assert.equal(binding?.lastInboundTraceId, 'trace-im-memory-1')
})

test('resolveConversationForTarget can attach a new IM route to an existing conversation', () => {
  const { service, profile } = createService()
  const base = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-base',
      transportId: 'wecom',
      transportAccountId: 'corp-bot',
      externalMessageId: 'msg-base',
      externalChatId: 'chat-base',
      externalUserId: 'user-base',
      externalUserDisplayName: 'Base User',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T12:00:00.000Z').toISOString(),
      text: 'hello'
    }
  })

  const attached = service.resolveConversationForTarget({
    agentProfileId: profile.id,
    conversationId: base.conversation.id,
    setAsActiveBinding: true,
    target: {
      transportId: 'telegram',
      transportAccountId: 'bot-a',
      externalChatId: 'chat-telegram',
      externalUserId: 'user-telegram',
      channelKind: 'dm',
      externalUserDisplayName: 'Telegram User'
    }
  })

  const bindings = service.listConversationBindings({
    conversationId: base.conversation.id
  })
  const conversation = service.getConversation(base.conversation.id)

  assert.equal(attached.createdConversation, false)
  assert.equal(attached.createdBinding, true)
  assert.equal(attached.binding.conversationId, base.conversation.id)
  assert.equal(bindings.length, 2)
  assert.equal(conversation?.activeBindingId, attached.binding.id)
})

test('requestRun keeps context and memory provider global while applying conversation model override', () => {
  const { service, profile } = createService()

  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-1',
      transportId: 'wecom',
      transportAccountId: 'corp-bot',
      externalMessageId: 'msg-1',
      externalChatId: 'chat-2',
      externalUserId: 'user-2',
      externalUserDisplayName: 'Alice',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T12:01:00.000Z').toISOString(),
      text: 'run this'
    },
    executionOverride: {
      model: { modelId: 'gpt-5.4-mini', reasoningLevel: 'low' },
      toolProfileId: 'readonly'
    }
  })

  const run = service.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'transport_message'
  })

  assert.equal(run.requestedExecutionPolicy.model.providerId, 'openai')
  assert.equal(run.requestedExecutionPolicy.model.modelId, 'gpt-5.4-mini')
  assert.equal(run.requestedExecutionPolicy.model.reasoningLevel, 'low')
  assert.equal(run.requestedExecutionPolicy.contextEngineId, 'summary')
  assert.equal(run.requestedExecutionPolicy.memoryProviderId, 'local-facts')
  assert.equal(run.requestedExecutionPolicy.toolProfileId, 'readonly')
})

test('appendInboundEnvelope stores message and emits transport event', () => {
  const { service, profile } = createService()
  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-1',
      transportId: 'telegram',
      transportAccountId: 'bot-a',
      externalMessageId: 'msg-1',
      externalChatId: 'chat-3',
      externalUserId: 'user-3',
      externalUserDisplayName: 'Bot User',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T12:02:00.000Z').toISOString(),
      text: 'ping'
    }
  })

  const message = service.appendInboundEnvelope({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    envelope: {
      envelopeId: 'env-1',
      transportId: 'telegram',
      transportAccountId: 'bot-a',
      externalMessageId: 'msg-1',
      externalChatId: 'chat-3',
      externalUserId: 'user-3',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T12:02:00.000Z').toISOString(),
      text: 'ping'
    }
  })

  const messages = service.getConversationMessages(resolved.conversation.id)
  const events = service.listEventLog().map((entry) => entry.eventType)

  assert.equal(message.text, 'ping')
  assert.equal(messages.length, 1)
  assert.ok(events.includes('transport.message.received'))
})

test('listConversationWindows separates local and im conversations', () => {
  const { service, profile } = createService()

  service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-local',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-local',
      externalChatId: 'local-1',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T12:03:00.000Z').toISOString(),
      text: 'local'
    },
    desktopVisibilityMode: 'read_write'
  })

  service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-im',
      transportId: 'wecom',
      transportAccountId: 'corp-bot',
      externalMessageId: 'msg-im',
      externalChatId: 'im-1',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T12:04:00.000Z').toISOString(),
      text: 'im'
    }
  })

  assert.equal(service.listConversationWindows('local').length, 1)
  assert.equal(service.listConversationWindows('im').length, 1)
  assert.equal(service.listConversationWindows('all').length, 2)
})

test('requestInteraction marks conversation as needing attention until answered', () => {
  const { service, profile } = createService()
  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-ia',
      transportId: 'wecom',
      transportAccountId: 'corp-bot',
      externalMessageId: 'msg-ia',
      externalChatId: 'chat-ia',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T12:05:00.000Z').toISOString(),
      text: 'need answer'
    }
  })

  const checkpoint = service.requestInteraction({
    conversationId: resolved.conversation.id,
    expectedBindingId: resolved.binding.id,
    expectedPersonId: 'person-memory-approval-1',
    acceptedReplyModes: ['reply', 'button'],
    expiresAt: new Date('2026-04-20T12:20:00.000Z').toISOString(),
    kind: 'approval',
    prompt: 'confirm'
  })

  const pending = service.listPendingInteractions(resolved.conversation.id)
  const beforeAnswer = service.listConversationWindows('im')[0]

  service.answerInteraction({ interactionId: checkpoint.id })

  const afterAnswer = service.listConversationWindows('im')[0]

  assert.equal(pending.length, 1)
  assert.equal(checkpoint.expectedBindingId, resolved.binding.id)
  assert.equal(checkpoint.expectedPersonId, 'person-memory-approval-1')
  assert.deepEqual(checkpoint.acceptedReplyModes, ['reply', 'button'])
  assert.equal(new Date(checkpoint.expiresAt ?? '').toISOString(), '2026-04-20T12:20:00.000Z')
  assert.equal(beforeAnswer?.pendingInteractionKind, 'approval')
  assert.equal(beforeAnswer?.needsAttention, true)
  assert.equal(afterAnswer?.pendingInteractionKind, null)
})

test('cancelInteraction clears pending conversation attention', () => {
  const { service, profile } = createService()
  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-ic',
      transportId: 'wecom',
      transportAccountId: 'corp-bot',
      externalMessageId: 'msg-ic',
      externalChatId: 'chat-ic',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T12:06:00.000Z').toISOString(),
      text: 'need answer'
    }
  })

  const checkpoint = service.requestInteraction({
    conversationId: resolved.conversation.id,
    kind: 'text_input',
    prompt: 'confirm'
  })

  service.cancelInteraction({ interactionId: checkpoint.id })

  assert.equal(service.listPendingInteractions(resolved.conversation.id).length, 0)
  assert.equal(service.listConversationWindows('im')[0]?.pendingInteractionKind, null)
})

test('upsertAgentRun and upsertEventLogEntry are idempotent for imported runtime data', () => {
  const { service, profile } = createService()
  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-import',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-import',
      externalChatId: 'local-import',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T12:06:00.000Z').toISOString(),
      text: 'import'
    },
    desktopVisibilityMode: 'read_write'
  })

  service.upsertAgentRun({
    id: 'run-import-1',
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    requestedExecutionPolicy: profile.defaultExecutionPolicy,
    effectiveExecutionSnapshot: {
      ...profile.defaultExecutionPolicy,
      model: { ...profile.defaultExecutionPolicy.model },
      resolvedAt: new Date('2026-04-20T12:06:01.000Z').toISOString()
    },
    status: 'finished',
    traceId: 'trace-import-1',
    startedAt: new Date('2026-04-20T12:06:01.000Z').toISOString(),
    endedAt: new Date('2026-04-20T12:06:10.000Z').toISOString()
  })
  service.upsertAgentRun({
    id: 'run-import-1',
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    requestedExecutionPolicy: profile.defaultExecutionPolicy,
    effectiveExecutionSnapshot: {
      ...profile.defaultExecutionPolicy,
      model: { ...profile.defaultExecutionPolicy.model },
      resolvedAt: new Date('2026-04-20T12:06:01.000Z').toISOString()
    },
    status: 'finished',
    traceId: 'trace-import-1',
    startedAt: new Date('2026-04-20T12:06:01.000Z').toISOString(),
    endedAt: new Date('2026-04-20T12:06:10.000Z').toISOString()
  })

  const firstImportedEvent = service.upsertEventLogEntry({
    id: 'event-import-1',
    eventType: 'agentTurnFinished',
    traceId: 'trace-import-1',
    correlationId: 'run-import-1',
    aggregateType: 'agent_run',
    aggregateId: 'run-import-1',
    payload: { ok: true },
    createdAt: new Date('2026-04-20T12:06:10.000Z').toISOString()
  })
  service.upsertEventLogEntry({
    id: 'event-import-1',
    eventType: 'agentTurnFinished',
    traceId: 'trace-import-1',
    correlationId: 'run-import-1',
    aggregateType: 'agent_run',
    aggregateId: 'run-import-1',
    payload: { ok: true, updated: true },
    createdAt: new Date('2026-04-20T12:06:11.000Z').toISOString()
  })

  const runs = service.listConversationRuns(resolved.conversation.id)
  const importedEvent = service.listEventLog().find((entry) => entry.id === 'event-import-1')

  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.status, 'finished')
  assert.ok(importedEvent)
  assert.equal(importedEvent?.sequence, firstImportedEvent.sequence)
  assert.match(importedEvent?.payloadJson ?? '', /updated/)
})

test('can resolve and delete a conversation by binding routing key', () => {
  const { service, profile } = createService()
  const envelope = {
    envelopeId: 'env-delete',
    transportId: 'desktop-chat',
    transportAccountId: 'desktop',
    externalMessageId: 'msg-delete',
    externalChatId: 'local-delete',
    channelKind: 'dm' as const,
    receivedAt: new Date('2026-04-20T12:07:00.000Z').toISOString(),
    text: 'delete me'
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
