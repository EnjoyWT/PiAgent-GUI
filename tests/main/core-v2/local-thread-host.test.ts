import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentRunProjection } from '../../../src/shared/agent-runtime.ts'
import { InMemoryCoreService } from '../../../src/main/core-v2/in-memory-core-service.ts'
import { LocalThreadHostService } from '../../../src/main/core-v2/local-thread-host.ts'
import type { ConversationEventRow, MessageRow, ThreadRow } from '../../../src/preload/db-types.ts'

const createCore = () => {
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
  return core
}

const createProjectionStore = () => {
  const threads = new Map<string, ThreadRow>()
  const messages = new Map<string, MessageRow>()
  return {
    store: { threads, messages },
    api: {
      getThread: (threadId: string) => threads.get(threadId) ?? null,
      upsertThread: (row: ThreadRow) => {
        threads.set(row.id, { ...row })
        return threads.get(row.id)!
      },
      deleteThread: (threadId: string) => {
        threads.delete(threadId)
        for (const [id, message] of messages.entries()) {
          if (message.thread_id === threadId) messages.delete(id)
        }
      },
      listMessages: (threadId: string) =>
        [...messages.values()].filter((message) => message.thread_id === threadId),
      getMessage: (messageId: string) => messages.get(messageId) ?? null,
      upsertMessage: (row: MessageRow) => {
        messages.set(row.id, { ...row })
        return messages.get(row.id)!
      },
      deleteMessage: (messageId: string) => {
        messages.delete(messageId)
      },
      pruneRuntimeAfter: (threadId: string, cutoffCreatedAt: string) => {
        for (const [id, message] of messages.entries()) {
          if (message.thread_id !== threadId) continue
          if (message.role === 'user') continue
          if (message.created_at > cutoffCreatedAt) messages.delete(id)
        }
      },
      getUserChatOrdinal: (threadId: string, messageId: string) => {
        const rows = [...messages.values()]
          .filter(
            (message) =>
              message.thread_id === threadId &&
              message.role === 'user' &&
              message.message_kind === 'chat'
          )
          .sort(
            (left, right) =>
              left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
          )
        const index = rows.findIndex((message) => message.id === messageId)
        return index >= 0 ? index : null
      }
    }
  }
}

test('local thread host creates and updates threads with core-v2 as source of truth', () => {
  const core = createCore()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const created = host.createThread({
    workspacePath: '/tmp/repo-a',
    model: 'google::gemini-2.5-flash',
    title: 'newchat'
  })
  const updated = host.updateThread(created.id, {
    title: 'Refactor Chat',
    model: 'openai::gpt-5.4'
  })

  const match = core.getConversationByBindingRoutingKey(`desktop-chat:desktop:${created.id}:-:dm`)

  assert.ok(match)
  assert.equal(created.title, 'newchat')
  assert.equal(updated.title, 'Refactor Chat')
  assert.equal(updated.model, 'openai::gpt-5.4')
  assert.equal(match?.conversation.title, 'Refactor Chat')
  assert.equal(match?.conversation.executionOverride?.model?.providerId, 'openai')
  assert.equal(match?.conversation.executionOverride?.model?.modelId, 'gpt-5.4')
  assert.equal(projection.store.threads.size, 1)
})

test('local thread host writes and deletes messages through core-v2 and projection store', () => {
  const core = createCore()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-b',
    model: 'openai::gpt-5.4',
    title: 'newchat'
  })

  const message = host.addMessage(thread.id, 'user', 'hello', null, null, {
    submissionId: 'sub-1'
  })
  const updated = host.updateUserMessageRuntimeLink(message.id, {
    agentRunId: 'run-1',
    submissionId: 'sub-1',
    runtimeSequence: 3
  })

  const match = core.getConversationByBindingRoutingKey(`desktop-chat:desktop:${thread.id}:-:dm`)
  const coreMessages = core.getConversationMessages(match!.conversation.id)

  assert.equal(coreMessages.length, 1)
  assert.equal(coreMessages[0]?.externalMessageId, message.id)
  assert.match(coreMessages[0]?.payloadJson ?? '', /"localThread"/)
  assert.doesNotMatch(coreMessages[0]?.payloadJson ?? '', /"legacy"/)
  assert.equal(updated?.agent_run_id, 'run-1')
  assert.equal(updated?.runtime_sequence, 3)

  const deleted = host.deleteMessage(message.id)
  assert.equal(deleted, true)
  assert.equal(core.getConversationMessages(match!.conversation.id).length, 0)
  assert.equal(projection.store.messages.size, 0)
})

test('local thread host reuses the same user row for repeated submission persistence', () => {
  const core = createCore()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-b-2',
    model: 'openai::gpt-5.4',
    title: 'newchat'
  })
  const first = host.addMessage(thread.id, 'user', 'hello', null, null, {
    submissionId: 'sub-dup'
  })
  const second = host.addMessage(thread.id, 'user', 'hello', 'run-1', null, {
    submissionId: 'sub-dup',
    agentTurnId: 'turn-1',
    runtimeSequence: 19,
    createdAt: '2026-04-20T09:43:00.363Z'
  })

  const match = core.getConversationByBindingRoutingKey(`desktop-chat:desktop:${thread.id}:-:dm`)

  assert.equal(second.id, first.id)
  assert.equal(projection.store.messages.size, 1)
  assert.equal(second.agent_run_id, 'run-1')
  assert.equal(second.agent_turn_id, 'turn-1')
  assert.equal(second.runtime_sequence, 19)
  assert.match(second.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
  assert.equal(Date.parse(second.created_at), Date.parse('2026-04-20T09:43:00.363Z'))

  const coreMessages = core.getConversationMessages(match!.conversation.id)
  assert.equal(coreMessages.length, 1)
  assert.equal(Date.parse(coreMessages[0]!.createdAt), Date.parse('2026-04-20T09:43:00.363Z'))
})

test('local thread host persists consumed user turn identity at runtime fact source', () => {
  const core = createCore()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-b-2-turn',
    model: 'openai::gpt-5.4',
    title: 'newchat'
  })
  const first = host.addMessage(thread.id, 'user', 'hello', null, null, {
    submissionId: 'sub-turn'
  })
  const consumed = host.ensureConsumedUserMessage({
    threadId: thread.id,
    text: 'hello',
    agentRunId: 'run-turn',
    agentTurnId: 'turn-consumed',
    submissionId: 'sub-turn',
    runtimeSequence: 3,
    consumedAt: '2026-04-20T09:43:00.363Z'
  })

  const match = core.getConversationByBindingRoutingKey(`desktop-chat:desktop:${thread.id}:-:dm`)
  const coreMessages = core.getConversationMessages(match!.conversation.id)

  assert.equal(consumed?.id, first.id)
  assert.equal(consumed?.agent_run_id, 'run-turn')
  assert.equal(consumed?.agent_turn_id, 'turn-consumed')
  assert.equal(consumed?.runtime_sequence, 3)
  assert.equal(coreMessages.length, 1)
  assert.match(coreMessages[0]?.payloadJson ?? '', /"agentTurnId":"turn-consumed"/)
})

test('local thread host reuses the same assistant row for repeated finalized turn persistence', () => {
  const core = createCore()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-b-3',
    model: 'openai::gpt-5.4',
    title: 'newchat'
  })
  const first = host.addMessage(thread.id, 'assistant', 'answer', 'run-2', null, {
    agentTurnId: 'turn-2',
    runtimeSequence: 21,
    createdAt: '2026-04-20T09:43:01.812Z'
  })
  const second = host.addMessage(thread.id, 'assistant', 'answer', 'run-2', null, {
    agentTurnId: 'turn-2',
    runtimeSequence: 21,
    createdAt: '2026-04-20T09:43:01.812Z'
  })

  const match = core.getConversationByBindingRoutingKey(`desktop-chat:desktop:${thread.id}:-:dm`)

  assert.equal(second.id, first.id)
  assert.equal(projection.store.messages.size, 1)
  assert.equal(core.getConversationMessages(match!.conversation.id).length, 1)
})

test('local thread host resolves user chat ordinal from core-v2 conversation messages', () => {
  const core = createCore()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-c',
    model: 'openai::gpt-5.4',
    title: 'newchat'
  })

  const first = host.addMessage(thread.id, 'user', 'first')
  host.addMessage(thread.id, 'assistant', 'answer')
  const second = host.addMessage(thread.id, 'user', 'second')

  assert.equal(host.getUserChatOrdinal(thread.id, first.id), 0)
  assert.equal(host.getUserChatOrdinal(thread.id, second.id), 1)
})

test('local thread host prunes core-v2 messages after retry cutoff', () => {
  const core = createCore()
  const projection = createProjectionStore()
  const prunedContext: Array<{ threadId: string; cutoffCreatedAt: string }> = []
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    contextPruner: {
      pruneThreadAfter: (threadId, cutoffCreatedAt) => {
        prunedContext.push({ threadId, cutoffCreatedAt })
      }
    },
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-c-prune',
    model: 'openai::gpt-5.4',
    title: 'Retry Thread'
  })

  const retryAnchor = host.addMessage(thread.id, 'user', 'retry me', null, null, {
    createdAt: '2026-04-20T13:10:01.000Z'
  })
  host.addMessage(thread.id, 'user', 'stale follow-up', null, null, {
    createdAt: '2026-04-20T13:10:02.000Z'
  })
  host.addMessage(thread.id, 'user', 'stale question answer', null, null, {
    messageKind: 'question_answer',
    createdAt: '2026-04-20T13:10:03.000Z'
  })

  const match = core.getConversationByBindingRoutingKey(`desktop-chat:desktop:${thread.id}:-:dm`)

  host.pruneRuntimeAfter(thread.id, retryAnchor.created_at)

  const messages = core.getConversationMessages(match!.conversation.id)
  assert.deepEqual(
    messages.map((message) => message.externalMessageId),
    [retryAnchor.id]
  )
  assert.deepEqual(prunedContext, [
    { threadId: thread.id, cutoffCreatedAt: retryAnchor.created_at }
  ])
})

test('local thread host persists finalized runs and runtime events directly into core-v2', () => {
  const core = createCore()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-d',
    model: 'openai::gpt-5.4',
    title: 'newchat'
  })
  const match = core.getConversationByBindingRoutingKey(`desktop-chat:desktop:${thread.id}:-:dm`)
  assert.ok(match)

  const run: AgentRunProjection = {
    threadId: thread.id,
    agentRunId: 'run-1',
    status: 'done',
    startedAt: Date.parse('2026-04-20T08:00:00.000Z'),
    endedAt: Date.parse('2026-04-20T08:00:05.000Z'),
    turns: [],
    messages: [],
    toolCalls: [],
    text: 'assistant reply'
  }

  host.persistFinalizedRun(thread.id, run)

  const runtimeEvent: ConversationEventRow = {
    id: 'evt-1',
    thread_id: thread.id,
    agent_run_id: 'run-1',
    event_type: 'agentRunFinished',
    event_origin: 'runtime',
    correlation_id: 'corr-1',
    payload_json: JSON.stringify({ ok: true }),
    raw_json: null,
    created_at: Date.parse('2026-04-20T08:00:05.000Z')
  }

  assert.equal(host.persistRuntimeEvents(thread.id, [runtimeEvent]), 1)

  const runs = core.listConversationRuns(match!.conversation.id)
  const events = core.listEventLog()

  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.id, 'run-1')
  assert.equal(runs[0]?.status, 'finished')
  assert.equal(
    events.some((entry) => entry.id === 'evt-1' && entry.aggregateId === 'run-1'),
    true
  )
})
