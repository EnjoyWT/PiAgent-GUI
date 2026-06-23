import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveInlineWidgetFromMessage } from '../../../src/renderer/src/utils/inline-widget.ts'
import { pruneStalePendingAssistantMessages } from '../../../src/renderer/src/utils/pending-assistant-placeholder.ts'
import type { AgentRun, ChatMessage } from '../../../src/renderer/src/components/chat/types.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@shared/')) {
      const sharedPath = resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`)
      return {
        shortCircuit: true,
        url: pathToFileURL(sharedPath).href
      }
    }
    return nextResolve(specifier, context)
  }
})

const {
  applyTransportAccountSetupEventToRuns,
  buildRunFinishedNotificationPreview,
  getRunFinishedNotificationPreview,
  shouldCreateAssistantMessageForTurn,
  turnHasVisibleAssistantOutput
} =
  await import('../../../src/renderer/src/utils/app-runtime.ts')

test('drops stale optimistic thinking placeholder once later assistant text is visible', () => {
  const list: ChatMessage[] = [
    {
      role: 'assistant',
      content: '思考中...',
      isPending: true
    },
    {
      role: 'assistant',
      content: '你好呀！找我有什么事嘛？',
      isPending: false
    }
  ]

  assert.equal(pruneStalePendingAssistantMessages(list), true)
  assert.deepEqual(
    list.map((message) => message.content),
    ['你好呀！找我有什么事嘛？']
  )
})

test('keeps the active optimistic thinking placeholder when no later assistant output exists', () => {
  const list: ChatMessage[] = [
    {
      role: 'assistant',
      content: '思考中...',
      isPending: true
    }
  ]

  assert.equal(pruneStalePendingAssistantMessages(list), false)
  assert.equal(list.length, 1)
})

test('creates an assistant message shell for an empty running turn', () => {
  const run: AgentRun = {
    id: 'run-loading',
    threadId: 'thread-1',
    status: 'running',
    turns: [
      {
        id: 'turn-loading',
        index: 0,
        status: 'running',
        text: '',
        toolCalls: [],
        timelineItems: [],
        startedAt: 10
      }
    ],
    text: '',
    startedAt: 10
  }

  const turn = run.turns[0]

  assert.equal(shouldCreateAssistantMessageForTurn(turn), true)
})

test('keeps a completed thinking-only turn renderable', () => {
  const turn: AgentRun['turns'][number] = {
    id: 'turn-thinking',
    index: 0,
    status: 'done',
    text: '',
    toolCalls: [],
    timelineItems: [
      {
        id: 'thinking-1',
        kind: 'thinking',
        thinking: '模型产生了思考过程，但没有正文 delta',
        startedAt: 10,
        endedAt: 20
      }
    ],
    startedAt: 10,
    endedAt: 20
  }

  assert.equal(turnHasVisibleAssistantOutput(turn), true)
  assert.equal(shouldCreateAssistantMessageForTurn(turn), true)
})

test('buildRunFinishedNotificationPreview normalizes whitespace and truncates long text', () => {
  assert.equal(
    buildRunFinishedNotificationPreview('  第一行\n\n第二行   third line  ', 14),
    '第一行 第二行 thi...'
  )
})

test('getRunFinishedNotificationPreview prefers the latest visible turn text', () => {
  const run: AgentRun = {
    id: 'run-finished',
    threadId: 'thread-1',
    status: 'done',
    text: 'fallback summary',
    startedAt: 10,
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: 'first answer',
        toolCalls: [],
        timelineItems: [],
        startedAt: 10
      },
      {
        id: 'turn-2',
        index: 1,
        status: 'done',
        text: ' latest answer with extra spacing ',
        toolCalls: [],
        timelineItems: [],
        startedAt: 20
      }
    ]
  }

  assert.equal(getRunFinishedNotificationPreview(run, 18), 'latest answer w...')
})

test('updates only the matching transport setup QR by session id', () => {
  const firstRun: AgentRun = {
    id: 'run-1',
    threadId: 'thread-1',
    status: 'done',
    text: '',
    startedAt: 10,
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: '',
        startedAt: 10,
        toolCalls: [
          {
            id: 'tool-1',
            agentTurnId: 'turn-1',
            name: 'imTool',
            kind: 'tool',
            invocation: 'direct',
            status: 'done',
            args: {},
            startedAt: 10,
            accountSetupQr: {
              transportId: 'wechat',
              accountId: 'default',
              methodId: 'wechat_qr_login',
              sessionId: 'setup-1',
              imageUrl: 'data:image/png;base64,one',
              status: 'active'
            }
          }
        ],
        timelineItems: []
      }
    ]
  }
  const secondRun: AgentRun = {
    id: 'run-2',
    threadId: 'thread-1',
    status: 'done',
    text: '',
    startedAt: 20,
    turns: [
      {
        id: 'turn-2',
        index: 0,
        status: 'done',
        text: '',
        startedAt: 20,
        toolCalls: [
          {
            id: 'tool-2',
            agentTurnId: 'turn-2',
            name: 'imTool',
            kind: 'tool',
            invocation: 'direct',
            status: 'done',
            args: {},
            startedAt: 20,
            accountSetupQr: {
              transportId: 'wechat',
              accountId: 'default',
              methodId: 'wechat_qr_login',
              sessionId: 'setup-2',
              imageUrl: 'data:image/png;base64,two',
              status: 'active'
            }
          }
        ],
        timelineItems: []
      }
    ]
  }

  const changed = applyTransportAccountSetupEventToRuns([firstRun, secondRun], {
    type: 'completed',
    pluginId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login',
    sessionId: 'setup-2',
    config: {},
    secrets: {}
  })

  assert.equal(changed, true)
  assert.equal(firstRun.turns[0]?.toolCalls[0]?.accountSetupQr?.status, 'active')
  assert.equal(secondRun.turns[0]?.toolCalls[0]?.accountSetupQr?.status, 'completed')
})

test('drops stale optimistic thinking placeholder once a later run-backed tool turn is visible', () => {
  const run: AgentRun = {
    id: 'run-1',
    threadId: 'thread-1',
    status: 'running',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'running',
        text: '',
        toolCalls: [
          {
            id: 'tool-1',
            agentTurnId: 'turn-1',
            name: 'listFiles',
            kind: 'tool',
            invocation: 'direct',
            args: {},
            status: 'running',
            startedAt: 10
          }
        ],
        timelineItems: [
          {
            id: 'tool:tool-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          }
        ],
        startedAt: 10
      }
    ],
    text: '',
    startedAt: 10
  }
  const list: ChatMessage[] = [
    {
      role: 'assistant',
      content: '思考中...',
      isPending: true
    },
    {
      role: 'assistant',
      content: '',
      isPending: true,
      run,
      agentRunId: run.id,
      agentTurnId: 'turn-1'
    }
  ]

  assert.equal(pruneStalePendingAssistantMessages(list), true)
  assert.equal(list.length, 1)
  assert.equal(list[0]?.agentRunId, 'run-1')
})

test('drops stale optimistic thinking placeholder once a run-backed thinking placeholder exists', () => {
  const run: AgentRun = {
    id: 'run-1',
    threadId: 'thread-1',
    status: 'running',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'running',
        text: '',
        toolCalls: [],
        timelineItems: [],
        startedAt: 10
      }
    ],
    text: '',
    startedAt: 10
  }
  const list: ChatMessage[] = [
    {
      role: 'assistant',
      content: '思考中...',
      isPending: true
    },
    {
      role: 'assistant',
      content: '',
      isPending: true,
      run,
      agentRunId: run.id,
      agentTurnId: 'turn-1'
    }
  ]

  assert.equal(pruneStalePendingAssistantMessages(list), true)
  assert.equal(list.length, 1)
  assert.equal(list[0]?.agentRunId, 'run-1')
})

test('drops stale optimistic thinking placeholder once a completed thinking-only run is renderable', () => {
  const run: AgentRun = {
    id: 'run-thinking',
    threadId: 'thread-1',
    status: 'done',
    turns: [
      {
        id: 'turn-thinking',
        index: 0,
        status: 'done',
        text: '',
        toolCalls: [],
        timelineItems: [
          {
            id: 'thinking-1',
            kind: 'thinking',
            thinking: '模型产生了思考过程，但没有正文 delta',
            startedAt: 10,
            endedAt: 20
          }
        ],
        startedAt: 10,
        endedAt: 20
      }
    ],
    text: '',
    startedAt: 10,
    endedAt: 20
  }
  const list: ChatMessage[] = [
    {
      role: 'assistant',
      content: '思考中...',
      isPending: true
    },
    {
      role: 'assistant',
      content: '',
      isPending: false,
      run,
      agentRunId: run.id,
      agentTurnId: 'turn-thinking'
    }
  ]

  assert.equal(pruneStalePendingAssistantMessages(list), true)
  assert.equal(list.length, 1)
  assert.equal(list[0]?.agentRunId, 'run-thinking')
})

test('does not resolve assistant widgets onto user messages even when they share the same turn', () => {
  const run: AgentRun = {
    id: 'run-1',
    threadId: 'thread-1',
    status: 'done',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: '',
        toolCalls: [
          {
            id: 'tool-1',
            agentTurnId: 'turn-1',
            name: 'widgetRenderer',
            kind: 'tool',
            invocation: 'direct',
            args: {
              type: 'html',
              html: '<div>widget</div>'
            },
            status: 'done',
            summary: JSON.stringify({
              type: 'html',
              html: '<div>widget</div>'
            }),
            startedAt: 10,
            endedAt: 20,
            durationMs: 10
          }
        ],
        timelineItems: [
          {
            id: 'tool:tool-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          }
        ],
        startedAt: 10,
        endedAt: 20
      }
    ],
    text: '',
    startedAt: 10,
    endedAt: 20
  }

  const message: ChatMessage = {
    role: 'user',
    content: '你都有什么技能',
    agentRunId: run.id,
    agentTurnId: 'turn-1',
    run
  }

  assert.equal(resolveInlineWidgetFromMessage(message), null)
})

test('does not guess a widget owner from a later turn when assistant message has no turn id', () => {
  const run: AgentRun = {
    id: 'run-1',
    threadId: 'thread-1',
    status: 'done',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: 'first turn',
        toolCalls: [],
        timelineItems: [
          {
            id: 'text:turn-1',
            kind: 'text',
            text: 'first turn',
            startedAt: 10,
            endedAt: 15
          }
        ],
        startedAt: 10,
        endedAt: 15
      },
      {
        id: 'turn-2',
        index: 1,
        status: 'done',
        text: '',
        toolCalls: [
          {
            id: 'tool-2',
            agentTurnId: 'turn-2',
            name: 'widgetRenderer',
            kind: 'tool',
            invocation: 'direct',
            args: {
              type: 'html',
              html: '<div>widget</div>'
            },
            status: 'done',
            summary: JSON.stringify({
              type: 'html',
              html: '<div>widget</div>'
            }),
            startedAt: 20,
            endedAt: 30,
            durationMs: 10
          }
        ],
        timelineItems: [
          {
            id: 'tool:tool-2',
            kind: 'tool',
            toolCallId: 'tool-2'
          }
        ],
        startedAt: 20,
        endedAt: 30
      }
    ],
    text: '',
    startedAt: 10,
    endedAt: 30
  }

  const message: ChatMessage = {
    role: 'assistant',
    content: 'legacy assistant',
    agentRunId: run.id,
    run
  }

  assert.equal(resolveInlineWidgetFromMessage(message), null)
})
