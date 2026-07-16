import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentRunProjection } from '../../../src/shared/agent-runtime.ts'
import { InMemoryCoreService } from '../../../src/main/core-v2/in-memory-core-service.ts'
import { LocalThreadHostService } from '../../../src/main/core-v2/local-thread-host.ts'
import { reconcileInterruptedRunsOnStartup } from '../../../src/main/core-v2/startup-run-recovery.ts'
import {
  buildLocalThreadProjectionFromService,
  buildLocalThreadWindowFromService,
  listLocalRuntimeEventsFromService
} from '../../../src/main/core-v2/local-thread-read-model.ts'
import { buildLocalThreadRoutingKey } from '../../../src/main/core-v2/local-thread-binding.ts'
import { listLocalThreadMessageRowsFromService } from '../../../src/main/core-v2/local-thread-query.ts'
import type { ConversationEventRow, MessageRow, ThreadRow } from '../../../src/preload/db-types.ts'

const createService = () => {
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

const runTurn = [
  {
    agentTurnId: 'turn-1',
    index: 0,
    status: 'done',
    startedAt: 1_745_157_001_000,
    endedAt: 1_745_157_002_000,
    text: 'world',
    toolCalls: [
      {
        toolCallId: 'tool-1',
        name: 'questionTool',
        kind: 'question',
        status: 'done',
        startedAt: 1_745_157_001_400,
        endedAt: 1_745_157_001_500
      }
    ]
  }
]

const createProjectionStore = () => {
  const threads = new Map<string, ThreadRow>()
  const messages = new Map<string, MessageRow>()
  return {
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

const rejectRuntimeEventLogReads = <T extends InMemoryCoreService>(core: T): T =>
  new Proxy(core, {
    get(target, prop, receiver) {
      if (prop === 'listEventLog' || prop === 'listEventLogByAggregateKeys') {
        return () => {
          throw new Error(`Unexpected event log read: ${String(prop)}`)
        }
      }
      return Reflect.get(target, prop, receiver)
    }
  })

const seedThread = (sourceCore?: InMemoryCoreService) => {
  const core = sourceCore ?? createService()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-a',
    model: 'google::gemini-2.5-flash',
    title: 'Projection Thread'
  })
  const userMessage = host.addMessage(thread.id, 'user', 'hello', null, null, {
    runtimeSequence: 1,
    createdAt: '2026-04-20 13:10:01.000'
  })
  const assistantMessage = host.addMessage(thread.id, 'assistant', 'world', 'run-1', null, {
    agentTurnId: 'turn-1',
    runtimeSequence: 2,
    createdAt: '2026-04-20 13:10:02.000'
  })
  host.setMessageAgentEntryId(assistantMessage.id, 'entry-1')
  host.addMessage(thread.id, 'user', 'yes', 'run-1', null, {
    messageKind: 'question_answer',
    includeInAgentContext: false,
    toolCallId: 'tool-1',
    runtimeSequence: 3,
    createdAt: '2026-04-20 13:10:03.000'
  })

  const run: AgentRunProjection = {
    threadId: thread.id,
    agentRunId: 'run-1',
    status: 'done',
    startedAt: 1_745_157_001_000,
    endedAt: 1_745_157_002_000,
    turns: runTurn as AgentRunProjection['turns'],
    messages: [],
    toolCalls: [],
    text: 'world'
  }
  host.persistFinalizedRun(thread.id, run)

  const events: ConversationEventRow[] = [
    {
      id: 'evt-1',
      thread_id: thread.id,
      agent_run_id: 'run-1',
      event_type: 'agentTurnFinished',
      event_origin: 'runtime',
      correlation_id: 'corr-1',
      payload_json: JSON.stringify({
        turnIndex: 0,
        message: {
          stopReason: 'endTurn'
        }
      }),
      raw_json: JSON.stringify({ rawType: 'turn_end' }),
      created_at: 1_745_157_002_000
    }
  ]
  host.persistRuntimeEvents(thread.id, events)

  return { core, thread, userMessage, assistantMessage }
}

test('local thread read model preserves persisted ids and run timeline details', () => {
  const { core, thread, userMessage, assistantMessage } = seedThread()
  const projection = buildLocalThreadProjectionFromService(core, thread.id)

  assert.equal(projection.threadId, thread.id)
  assert.equal(projection.messages.length, 2)
  assert.deepEqual(
    projection.messages.map((message) => message.id),
    [userMessage.id, assistantMessage.id]
  )
  assert.equal(projection.messages[1]?.agentEntryId, 'entry-1')
  assert.equal(projection.runs.length, 1)
  assert.equal(projection.runs[0]?.agentRunId, 'run-1')
  assert.equal(projection.runs[0]?.turns[0]?.agentTurnId, 'turn-1')
  assert.equal(projection.runs[0]?.turns[0]?.toolCalls[0]?.toolCallId, 'tool-1')
  assert.ok(
    projection.runs[0]?.turns[0]?.timelineItems.some(
      (item) => item.kind === 'question_answer' && item.toolCallId === 'tool-1'
    )
  )
})

test('local thread read model hides synthetic system followup user prompts', () => {
  const { core, thread } = seedThread()
  const match = core.getConversationByBindingRoutingKey(buildLocalThreadRoutingKey(thread.id))!
  const run = core.requestRun({
    conversationId: match.conversation.id,
    triggerKind: 'system_followup',
    traceId: 'transport-account-setup:setup-1:completed:system-event'
  })
  core.upsertConversationMessage({
    conversationId: match.conversation.id,
    bindingId: match.binding.id,
    externalMessageId: 'synthetic-system-followup-prompt',
    role: 'user',
    direction: 'inbound',
    text: 'Respond to the system event above in the current conversation.',
    payload: {
      localThread: {
        version: 1,
        messageKind: 'chat',
        includeInAgentContext: true,
        agentRunId: run.id,
        agentEntryId: null,
        agentTurnId: 'turn-system-followup',
        toolCallId: null,
        stepIndex: null,
        runtimeSequence: 4,
        content: null
      }
    },
    createdAt: '2026-04-20 13:10:04.000'
  })

  const projected = buildLocalThreadProjectionFromService(core, thread.id)
  const legacyRows = listLocalThreadMessageRowsFromService(core, thread.id)

  assert.equal(
    projected.messages.some(
      (message) =>
        message.content === 'Respond to the system event above in the current conversation.'
    ),
    false
  )
  assert.equal(
    legacyRows.some(
      (message) =>
        message.content === 'Respond to the system event above in the current conversation.'
    ),
    false
  )
})

test('local thread read model attaches synthetic questionnaire answers to the active tool turn', () => {
  const core = createService()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-setup-method',
    model: 'openai::gpt-5.4',
    title: 'Setup Method Thread'
  })
  const userMessage = host.addMessage(thread.id, 'user', '接入微信', null, null, {
    runtimeSequence: 1,
    createdAt: '2026-04-20T13:10:01.000Z'
  })
  host.addMessage(thread.id, 'user', '1. 选择接入方式：Scan QR code（推荐）', null, null, {
    messageKind: 'questionnaire_answer',
    includeInAgentContext: false,
    toolCallId: 'transport-setup-method:wechat:default',
    stepIndex: 0,
    createdAt: '2026-04-20T13:10:03.000Z'
  })
  const assistantMessage = host.addMessage(thread.id, 'assistant', '', 'run-setup', null, {
    agentTurnId: 'turn-tool',
    createdAt: '2026-04-20T13:10:04.000Z'
  })

  host.persistFinalizedRun(thread.id, {
    threadId: thread.id,
    agentRunId: 'run-setup',
    status: 'done',
    startedAt: Date.parse('2026-04-20T13:10:01.000Z'),
    endedAt: Date.parse('2026-04-20T13:10:05.000Z'),
    turns: [
      {
        agentTurnId: 'turn-tool',
        index: 0,
        status: 'done',
        startedAt: Date.parse('2026-04-20T13:10:02.000Z'),
        endedAt: Date.parse('2026-04-20T13:10:04.000Z'),
        text: '',
        terminationReason: undefined,
        errorMessage: undefined,
        timelineItems: [
          {
            id: 'tool:call-setup',
            kind: 'tool',
            toolCallId: 'call-setup'
          }
        ],
        toolCallIds: ['call-setup'],
        toolCalls: [
          {
            toolCallId: 'call-setup',
            agentTurnId: 'turn-tool',
            name: 'imTool',
            kind: 'tool',
            invocation: 'direct',
            origin: 'runtime',
            status: 'done',
            args: {
              action: 'setup_account',
              transportId: 'wechat'
            },
            startedAt: Date.parse('2026-04-20T13:10:02.000Z'),
            endedAt: Date.parse('2026-04-20T13:10:04.000Z')
          }
        ]
      }
    ],
    messages: [],
    toolCalls: [],
    text: ''
  })

  const page = buildLocalThreadWindowFromService(core, thread.id, null, { limit: 10 })

  assert.deepEqual(
    page.messages.map((message) => message.id),
    [userMessage.id, assistantMessage.id]
  )
  assert.deepEqual(
    page.runs[0]?.turns[0]?.timelineItems.map((item) => item.kind),
    ['tool', 'questionnaire_answer']
  )
})

test('local thread read model preserves persisted transport setup QR details', () => {
  const core = createService()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-qr',
    model: 'openai::gpt-5.4',
    title: 'QR Thread'
  })
  const assistantMessage = host.addMessage(thread.id, 'assistant', '', 'run-qr', null, {
    agentTurnId: 'turn-qr',
    createdAt: '2026-04-20T13:10:04.000Z'
  })

  host.persistFinalizedRun(thread.id, {
    threadId: thread.id,
    agentRunId: 'run-qr',
    status: 'done',
    startedAt: Date.parse('2026-04-20T13:10:01.000Z'),
    endedAt: Date.parse('2026-04-20T13:10:05.000Z'),
    turns: [
      {
        agentTurnId: 'turn-qr',
        index: 0,
        status: 'done',
        startedAt: Date.parse('2026-04-20T13:10:02.000Z'),
        endedAt: Date.parse('2026-04-20T13:10:04.000Z'),
        text: '',
        terminationReason: undefined,
        errorMessage: undefined,
        timelineItems: [
          {
            id: 'tool:call-qr',
            kind: 'tool',
            toolCallId: 'call-qr'
          }
        ],
        toolCallIds: ['call-qr'],
        toolCalls: [
          {
            toolCallId: 'call-qr',
            agentTurnId: 'turn-qr',
            name: 'imTool',
            kind: 'tool',
            invocation: 'direct',
            origin: 'runtime',
            status: 'done',
            args: {
              action: 'setup_account',
              transportId: 'wechat'
            },
            summary: 'WeChat account setup session setup-qr started.',
            accountSetupQr: {
              transportId: 'wechat',
              accountId: 'default',
              methodId: 'wechat_qr_login',
              sessionId: 'setup-qr',
              imageUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
              qrText: 'abc',
              expiresAt: '2026-04-20T13:15:04.000Z',
              status: 'active'
            },
            startedAt: Date.parse('2026-04-20T13:10:02.000Z'),
            endedAt: Date.parse('2026-04-20T13:10:04.000Z')
          }
        ]
      }
    ],
    messages: [],
    toolCalls: [],
    text: ''
  })

  const page = buildLocalThreadWindowFromService(core, thread.id, null, { limit: 10 })

  assert.deepEqual(
    page.messages.map((message) => message.id),
    [assistantMessage.id]
  )
  assert.equal(page.runs[0]?.turns[0]?.toolCalls[0]?.accountSetupQr?.sessionId, 'setup-qr')
  assert.equal(
    page.runs[0]?.turns[0]?.toolCalls[0]?.accountSetupQr?.imageUrl,
    'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3'
  )
  assert.equal(
    page.runs[0]?.turns[0]?.toolCalls[0]?.accountSetupQr?.startedAt,
    '2026-04-20T13:10:02.000Z'
  )
  ;(core as any).updateAgentRunProjectionTransportSetupQr({
    sessionId: 'setup-qr',
    status: 'completed',
    updatedAt: '2026-04-20T13:11:04.000Z'
  })

  const completedPage = buildLocalThreadWindowFromService(core, thread.id, null, { limit: 10 })
  assert.equal(completedPage.runs[0]?.turns[0]?.toolCalls[0]?.accountSetupQr?.status, 'completed')
})

test('local thread window reads persisted run projections without scanning runtime event log', () => {
  const core = rejectRuntimeEventLogReads(createService())
  const { thread, userMessage, assistantMessage } = seedThread(core)

  const page = buildLocalThreadWindowFromService(core, thread.id, null, { limit: 10 })

  assert.deepEqual(
    page.messages.map((message) => message.id),
    [userMessage.id, assistantMessage.id]
  )
  assert.equal(page.runs[0]?.agentRunId, 'run-1')
  assert.equal(page.runs[0]?.turns[0]?.toolCalls[0]?.toolCallId, 'tool-1')
})

test('local thread window paginates visible messages without dropping persisted ordering', () => {
  const { core, thread, userMessage, assistantMessage } = seedThread()
  const latestPage = buildLocalThreadWindowFromService(core, thread.id, null, { limit: 1 })

  assert.equal(latestPage.messages.length, 1)
  assert.equal(latestPage.messages[0]?.id, assistantMessage.id)
  assert.equal(latestPage.pageInfo.hasMoreBefore, true)

  const olderPage = buildLocalThreadWindowFromService(core, thread.id, null, {
    limit: 1,
    beforeCursor: latestPage.pageInfo.nextBeforeCursor
  })

  assert.equal(olderPage.messages.length, 1)
  assert.equal(olderPage.messages[0]?.id, userMessage.id)
})

test('local thread window ignores empty assistant placeholders when paginating latest messages', () => {
  const core = createService()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-empty-assistant-window',
    model: 'openai::gpt-5.4',
    title: 'Empty Assistant Window Thread'
  })
  const userMessage = host.addMessage(thread.id, 'user', '继续', 'run-empty-window', null, {
    agentTurnId: 'turn-user',
    createdAt: '2026-04-20T13:10:00.000Z'
  })
  const firstAssistant = host.addMessage(
    thread.id,
    'assistant',
    '第一段可见输出',
    'run-empty-window',
    null,
    {
      agentTurnId: 'turn-1',
      createdAt: '2026-04-20T13:10:01.000Z'
    }
  )
  const secondAssistant = host.addMessage(
    thread.id,
    'assistant',
    '第二段可见输出',
    'run-empty-window',
    null,
    {
      agentTurnId: 'turn-2',
      createdAt: '2026-04-20T13:10:02.000Z'
    }
  )

  for (let index = 0; index < 12; index += 1) {
    host.addMessage(thread.id, 'assistant', '', 'run-empty-window', null, {
      agentTurnId: `empty-turn-${index}`,
      createdAt: `2026-04-20T13:10:${String(index + 3).padStart(2, '0')}.000Z`
    })
  }

  const page = buildLocalThreadWindowFromService(core, thread.id, null, { limit: 3 })

  assert.deepEqual(
    page.messages.map((message) => message.id),
    [userMessage.id, firstAssistant.id, secondAssistant.id]
  )
})

test('local thread window before cursor excludes later turns recovered from the same run', () => {
  const core = createService()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-pagination-run',
    model: 'openai::gpt-5.4',
    title: 'Pagination Run Thread'
  })
  const triggeringUser = host.addMessage(thread.id, 'user', 'continue task', 'run-window', null, {
    agentTurnId: 'turn-user',
    runtimeSequence: 1,
    createdAt: '2026-04-20T13:10:03.000Z'
  })
  const firstAssistant = host.addMessage(
    thread.id,
    'assistant',
    'middle reply',
    'run-window',
    null,
    {
      agentTurnId: 'turn-middle',
      createdAt: '2026-04-20T13:10:04.000Z'
    }
  )
  const finalAssistant = host.addMessage(
    thread.id,
    'assistant',
    'final reply',
    'run-window',
    null,
    {
      agentTurnId: 'turn-final',
      createdAt: '2026-04-20T13:10:05.000Z'
    }
  )

  host.persistFinalizedRun(thread.id, {
    threadId: thread.id,
    agentRunId: 'run-window',
    status: 'done',
    startedAt: Date.parse('2026-04-20T13:10:03.000Z'),
    endedAt: Date.parse('2026-04-20T13:10:05.000Z'),
    turns: [
      {
        agentTurnId: 'turn-middle',
        index: 0,
        status: 'done',
        startedAt: Date.parse('2026-04-20T13:10:03.500Z'),
        endedAt: Date.parse('2026-04-20T13:10:04.000Z'),
        text: 'middle reply',
        terminationReason: undefined,
        errorMessage: undefined,
        timelineItems: [
          {
            id: 'text:turn-middle',
            kind: 'text',
            text: 'middle reply',
            startedAt: Date.parse('2026-04-20T13:10:03.500Z'),
            endedAt: Date.parse('2026-04-20T13:10:04.000Z')
          }
        ],
        toolCallIds: [],
        toolCalls: []
      },
      {
        agentTurnId: 'turn-final',
        index: 1,
        status: 'done',
        startedAt: Date.parse('2026-04-20T13:10:04.500Z'),
        endedAt: Date.parse('2026-04-20T13:10:05.000Z'),
        text: 'final reply',
        terminationReason: undefined,
        errorMessage: undefined,
        timelineItems: [
          {
            id: 'text:turn-final',
            kind: 'text',
            text: 'final reply',
            startedAt: Date.parse('2026-04-20T13:10:04.500Z'),
            endedAt: Date.parse('2026-04-20T13:10:05.000Z')
          }
        ],
        toolCallIds: [],
        toolCalls: []
      }
    ],
    messages: [],
    toolCalls: [],
    text: 'middle reply\nfinal reply'
  })

  const latestPage = buildLocalThreadWindowFromService(core, thread.id, null, { limit: 2 })
  assert.deepEqual(
    latestPage.messages.map((message) => message.id),
    [firstAssistant.id, finalAssistant.id]
  )

  const olderPage = buildLocalThreadWindowFromService(core, thread.id, null, {
    limit: 1,
    beforeCursor: latestPage.pageInfo.nextBeforeCursor
  })

  assert.deepEqual(
    olderPage.messages.map((message) => message.id),
    [triggeringUser.id]
  )
})

test('local thread runtime events can be listed from core-v2 mirror', () => {
  const { core, thread } = seedThread()
  const runtimeEvents = listLocalRuntimeEventsFromService(core, thread.id)

  assert.equal(runtimeEvents.length, 1)
  assert.equal(runtimeEvents[0]?.id, 'evt-1')
  assert.equal(runtimeEvents[0]?.thread_id, thread.id)
  assert.equal(runtimeEvents[0]?.agent_run_id, 'run-1')
  assert.match(runtimeEvents[0]?.payload_json ?? '', /endTurn/)
})

test('latest window does not recover empty running assistant turn from live snapshot', () => {
  const { core, thread, userMessage, assistantMessage } = seedThread()
  const page = buildLocalThreadWindowFromService(
    core,
    thread.id,
    {
      threadId: thread.id,
      agentRunId: 'run-live',
      status: 'running',
      startedAt: 1_745_157_010_000,
      turns: [
        {
          agentTurnId: 'turn-live',
          index: 0,
          status: 'running',
          startedAt: 1_745_157_010_000,
          text: '',
          terminationReason: undefined,
          errorMessage: undefined,
          timelineItems: [],
          toolCallIds: [],
          toolCalls: []
        }
      ],
      messages: [],
      toolCalls: [],
      text: ''
    },
    { limit: 10 }
  )

  assert.deepEqual(
    page.messages.map((message) => message.id),
    [userMessage.id, assistantMessage.id]
  )
  assert.equal(page.activeRunId, 'run-live')
  assert.equal(page.isStreaming, true)
})

test('local thread read model recovers completed thinking-only assistant turns', () => {
  const core = createService()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-thinking',
    model: 'xiaomi::mimo-v2-omni',
    title: 'Thinking Thread'
  })
  const userMessage = host.addMessage(thread.id, 'user', '是的', 'run-thinking', null, {
    agentTurnId: 'turn-thinking',
    runtimeSequence: 1,
    createdAt: '2026-04-20T13:10:01.000Z'
  })

  host.persistFinalizedRun(thread.id, {
    threadId: thread.id,
    agentRunId: 'run-thinking',
    status: 'done',
    startedAt: Date.parse('2026-04-20T13:10:01.000Z'),
    endedAt: Date.parse('2026-04-20T13:10:02.000Z'),
    turns: [
      {
        agentTurnId: 'turn-thinking',
        index: 0,
        status: 'done',
        startedAt: Date.parse('2026-04-20T13:10:01.000Z'),
        endedAt: Date.parse('2026-04-20T13:10:02.000Z'),
        text: '',
        terminationReason: 'stop',
        errorMessage: undefined,
        timelineItems: [
          {
            id: 'thinking:turn-thinking',
            kind: 'thinking',
            thinking: '模型产生了思考过程，但没有正文 delta',
            startedAt: Date.parse('2026-04-20T13:10:01.200Z'),
            endedAt: Date.parse('2026-04-20T13:10:02.000Z')
          }
        ],
        toolCallIds: [],
        toolCalls: []
      }
    ],
    messages: [],
    toolCalls: [],
    text: ''
  })

  const projected = buildLocalThreadProjectionFromService(core, thread.id)

  assert.equal(projected.messages.length, 2)
  assert.equal(projected.messages[0]?.id, userMessage.id)
  assert.equal(projected.messages[1]?.role, 'assistant')
  assert.equal(projected.messages[1]?.agentRunId, 'run-thinking')
  assert.equal(projected.messages[1]?.agentTurnId, 'turn-thinking')
  assert.equal(projected.messages[1]?.content, '')
  assert.equal(projected.runs[0]?.turns[0]?.timelineItems[0]?.kind, 'thinking')
})

test('projection does not recover a pruned assistant run that crossed the retry cutoff', () => {
  const core = createService()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-retry',
    model: 'openai::gpt-5.4',
    title: 'Retry Thread'
  })
  const userMessage = host.addMessage(thread.id, 'user', '你是谁', null, null, {
    runtimeSequence: 1,
    createdAt: '2026-04-20T13:10:01.000Z'
  })
  const assistantMessage = host.addMessage(
    thread.id,
    'assistant',
    '我是旧回复',
    'run-retry',
    null,
    {
      agentTurnId: 'turn-retry',
      runtimeSequence: 2,
      createdAt: '2026-04-20T13:10:04.000Z'
    }
  )

  host.persistFinalizedRun(thread.id, {
    threadId: thread.id,
    agentRunId: 'run-retry',
    status: 'done',
    startedAt: Date.parse('2026-04-20T13:10:00.999Z'),
    endedAt: Date.parse('2026-04-20T13:10:04.000Z'),
    turns: [
      {
        agentTurnId: 'turn-retry',
        index: 0,
        status: 'done',
        startedAt: Date.parse('2026-04-20T13:10:00.999Z'),
        endedAt: Date.parse('2026-04-20T13:10:04.000Z'),
        text: '我是旧回复',
        terminationReason: undefined,
        errorMessage: undefined,
        timelineItems: [
          {
            id: 'text:turn-retry',
            kind: 'text',
            text: '我是旧回复',
            startedAt: Date.parse('2026-04-20T13:10:00.999Z'),
            endedAt: Date.parse('2026-04-20T13:10:04.000Z')
          }
        ],
        toolCallIds: [],
        toolCalls: []
      }
    ],
    messages: [],
    toolCalls: [],
    text: '我是旧回复'
  })

  assert.equal(host.deleteMessage(assistantMessage.id), true)
  host.pruneRuntimeAfter(thread.id, userMessage.created_at)

  const projectionAfterPrune = buildLocalThreadProjectionFromService(core, thread.id)

  assert.deepEqual(
    projectionAfterPrune.messages.map((message) => message.id),
    [userMessage.id]
  )
  assert.equal(projectionAfterPrune.runs.length, 0)
})

test('startup recovery clears interrupted running thread state from projection', () => {
  const core = createService()
  const projection = createProjectionStore()
  const host = new LocalThreadHostService({
    core,
    projectionStore: projection.api,
    resolveAgentProfileId: () => 'default'
  })

  const thread = host.createThread({
    workspacePath: '/tmp/repo-startup-recovery',
    model: 'openai::gpt-5.4',
    title: 'Interrupted Thread'
  })
  host.addMessage(thread.id, 'user', 'still running?', null, null, {
    runtimeSequence: 1,
    createdAt: '2026-04-20T13:12:00.000Z'
  })

  host.persistFinalizedRun(thread.id, {
    threadId: thread.id,
    agentRunId: 'run-interrupted',
    status: 'running',
    startedAt: Date.parse('2026-04-20T13:12:01.000Z'),
    turns: [
      {
        agentTurnId: 'turn-interrupted',
        index: 0,
        status: 'running',
        startedAt: Date.parse('2026-04-20T13:12:01.000Z'),
        text: '',
        terminationReason: undefined,
        errorMessage: undefined,
        timelineItems: [],
        toolCallIds: [],
        toolCalls: []
      }
    ],
    messages: [],
    toolCalls: [],
    text: ''
  })

  const beforeRecovery = buildLocalThreadProjectionFromService(core, thread.id)
  reconcileInterruptedRunsOnStartup(core, { recoveredAt: '2026-04-20T13:12:30.000Z' })
  const afterRecovery = buildLocalThreadProjectionFromService(core, thread.id)

  assert.equal(beforeRecovery.activeRunId, 'run-interrupted')
  assert.equal(beforeRecovery.isStreaming, true)
  assert.equal(beforeRecovery.runs[0]?.status, 'running')
  assert.equal(afterRecovery.activeRunId, null)
  assert.equal(afterRecovery.isStreaming, false)
  assert.equal(afterRecovery.runs[0]?.status, 'aborted')
})
