import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { SqliteCoreService } from '../../../src/main/core-v2/sqlite-core-service.ts'

const createService = () => {
  const db = new Database(':memory:')
  const service = new SqliteCoreService(db)

  const profile = service.upsertAgentProfile({
    id: 'default',
    slug: 'default',
    displayName: 'Default',
    isDefault: true,
    enabledTransportIds: ['desktop-chat'],
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

  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    workspaceId: '/tmp/piagent-plan-workspace',
    desktopVisibilityMode: 'read_write',
    envelope: {
      envelopeId: 'env-plan-1',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-plan-1',
      externalChatId: 'thread-plan-1',
      channelKind: 'dm',
      receivedAt: '2026-05-11T00:00:00.000Z',
      text: 'track plan'
    }
  })

  return { db, service, conversation: resolved.conversation }
}

test('sqlite core service persists thread plan state across service instances', (t) => {
  const { db, service, conversation } = createService()
  t.after(() => db.close())

  const initial = service.upsertThreadPlanState({
    threadId: 'thread-plan-1',
    conversationId: conversation.id,
    activeRunId: null,
    sourceToolCallId: 'tool-call-plan-1',
    items: [
      { id: '1', text: 'Write tests', status: 'completed' },
      { id: '2', text: 'Implement state', status: 'in_progress' }
    ],
    updatedAt: '2026-05-11T00:01:00.000Z'
  })
  const updated = service.upsertThreadPlanState({
    threadId: 'thread-plan-1',
    conversationId: conversation.id,
    activeRunId: null,
    sourceToolCallId: 'tool-call-plan-2',
    items: [
      { id: '1', text: 'Write tests', status: 'completed' },
      { id: '2', text: 'Implement state', status: 'completed' },
      { id: '3', text: 'Render panel', status: 'in_progress' }
    ],
    updatedAt: '2026-05-11T00:02:00.000Z'
  })

  const reloadedService = new SqliteCoreService(db, { migrate: false })
  const reloaded = reloadedService.getThreadPlanState('thread-plan-1')

  assert.equal(initial.revision, 1)
  assert.equal(initial.closed, false)
  assert.equal(updated.revision, 2)
  assert.equal(updated.closed, false)
  assert.equal(reloaded?.revision, 2)
  assert.equal(reloaded?.conversationId, conversation.id)
  assert.equal(reloaded?.items[2]?.text, 'Render panel')
  assert.equal(reloaded?.closed, false)
})

test('sqlite core service persists explicit closed thread plan state', (t) => {
  const { db, service, conversation } = createService()
  t.after(() => db.close())

  service.upsertThreadPlanState({
    threadId: 'thread-plan-1',
    conversationId: conversation.id,
    activeRunId: null,
    sourceToolCallId: 'tool-call-plan-1',
    items: [{ id: '1', text: 'Done', status: 'completed' }],
    updatedAt: '2026-05-11T00:01:00.000Z'
  })
  const closed = service.upsertThreadPlanState({
    threadId: 'thread-plan-1',
    conversationId: conversation.id,
    activeRunId: null,
    sourceToolCallId: 'tool-call-plan-close',
    items: [{ id: '1', text: 'Done', status: 'completed' }],
    closed: true,
    updatedAt: '2026-05-11T00:02:00.000Z'
  })

  const reloadedService = new SqliteCoreService(db, { migrate: false })
  const reloaded = reloadedService.getThreadPlanState('thread-plan-1')

  assert.equal(closed.revision, 2)
  assert.equal(closed.closed, true)
  assert.equal(reloaded?.closed, true)
  assert.equal(reloaded?.items[0]?.text, 'Done')
})

test('sqlite core service clears thread plan state when conversation is deleted', (t) => {
  const { db, service, conversation } = createService()
  t.after(() => db.close())

  service.upsertThreadPlanState({
    threadId: 'thread-plan-1',
    conversationId: conversation.id,
    items: [{ id: '1', text: 'Only step', status: 'in_progress' }]
  })

  assert.ok(service.getThreadPlanState('thread-plan-1'))
  assert.equal(service.deleteConversation({ conversationId: conversation.id }), true)
  assert.equal(service.getThreadPlanState('thread-plan-1'), null)
})
