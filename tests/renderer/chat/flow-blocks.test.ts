import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMessageRenderFlow } from '../../../src/renderer/src/components/chat/flow-blocks.ts'
import type { AgentRun } from '../../../src/renderer/src/components/chat/types.ts'

const createRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run-1',
  threadId: 'thread-1',
  status: 'running',
  turns: [],
  text: '',
  startedAt: 1,
  ...overrides
})

test('shows thinking placeholder only when the run has no visible blocks', () => {
  const emptyRun = createRun()
  const emptyFlow = buildMessageRenderFlow({ run: emptyRun })

  assert.equal(emptyFlow.meta.showThinkingPlaceholder, false)
  assert.equal(emptyFlow.blocks.length, 0)

  const thinkingRun = createRun({
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'running',
        text: '',
        toolCalls: [],
        timelineItems: [
          {
            id: 'thinking-1',
            kind: 'thinking',
            thinking: '先想一下',
            startedAt: 10
          }
        ],
        startedAt: 10
      }
    ]
  })
  const thinkingFlow = buildMessageRenderFlow({ run: thinkingRun })

  assert.equal(thinkingFlow.meta.showThinkingPlaceholder, false)
  assert.equal(thinkingFlow.blocks[0]?.kind, 'thinking')
})

test('renders computer use screenshots below their tool step', () => {
  const run = createRun({
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
            name: 'computerUseTool',
            kind: 'tool',
            invocation: 'direct',
            args: { action: 'screenshot' },
            status: 'done',
            startedAt: 10,
            endedAt: 20,
            toolImages: [
              {
                title: 'Computer Use 截图',
                mimeType: 'image/png',
                path: '/tmp/piagent-computer-use/screen-abc.png',
                url: 'http://127.0.0.1:5566/assets/computer-use/screen-abc.png',
                width: 640,
                height: 360
              }
            ]
          }
        ],
        timelineItems: [{ id: 'tool:tool-1', kind: 'tool', toolCallId: 'tool-1' }],
        startedAt: 10,
        endedAt: 20
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.equal(flow.blocks[0]?.kind, 'tool')
  assert.equal(flow.blocks[1]?.kind, 'tool_image')
  const imageBlock = flow.blocks[1]
  assert.equal(
    imageBlock?.kind === 'tool_image' ? imageBlock.image.url : '',
    'http://127.0.0.1:5566/assets/computer-use/screen-abc.png'
  )
})

test('does not fall back to prior run text while the current running turn has no blocks', () => {
  const run = createRun({
    status: 'running',
    text: '上一轮已经产出的回答',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: '上一轮已经产出的回答',
        toolCalls: [],
        timelineItems: [
          {
            id: 'text-1',
            kind: 'text',
            text: '上一轮已经产出的回答',
            startedAt: 10,
            endedAt: 20
          }
        ],
        startedAt: 10,
        endedAt: 20
      },
      {
        id: 'turn-2',
        index: 1,
        status: 'running',
        text: '',
        toolCalls: [],
        timelineItems: [],
        startedAt: 30
      }
    ]
  })

  const flow = buildMessageRenderFlow({
    run,
    turns: [run.turns[1]]
  })

  assert.equal(flow.meta.showThinkingPlaceholder, true)
  assert.deepEqual(flow.blocks, [])
})

test('does not show thinking placeholder while a running turn has visible text output', () => {
  const run = createRun({
    status: 'running',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'running',
        text: '好，给你做个好看又有个性的 todo list！',
        toolCalls: [],
        timelineItems: [
          {
            id: 'thinking-1',
            kind: 'thinking',
            thinking: '先设计 todo list 的风格',
            startedAt: 10,
            endedAt: 20
          },
          {
            id: 'text-1',
            kind: 'text',
            text: '好，给你做个好看又有个性的 todo list！',
            startedAt: 21,
            endedAt: 30
          }
        ],
        startedAt: 10
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.equal(flow.meta.showThinkingPlaceholder, false)
  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['thinking', 'text']
  )
})

test('marks only the last open thinking block as active', () => {
  const run = createRun({
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'running',
        text: '已经开始输出',
        toolCalls: [],
        timelineItems: [
          {
            id: 'thinking-1',
            kind: 'thinking',
            thinking: '先思考',
            startedAt: 10
          },
          {
            id: 'text-1',
            kind: 'text',
            text: '已经开始输出',
            startedAt: 20
          }
        ],
        startedAt: 10
      }
    ],
    text: '已经开始输出'
  })

  const flow = buildMessageRenderFlow({ run })
  const thinkingBlock = flow.blocks.find((block) => block.kind === 'thinking')

  assert.ok(thinkingBlock)
  assert.equal(thinkingBlock.isActive, false)

  const thinkingOnlyRun = createRun({
    turns: [
      {
        id: 'turn-2',
        index: 0,
        status: 'running',
        text: '',
        toolCalls: [],
        timelineItems: [
          {
            id: 'thinking-2',
            kind: 'thinking',
            thinking: '',
            startedAt: 10
          }
        ],
        startedAt: 10
      }
    ]
  })

  const thinkingOnlyFlow = buildMessageRenderFlow({ run: thinkingOnlyRun })
  const activeThinkingBlock = thinkingOnlyFlow.blocks.find((block) => block.kind === 'thinking')

  assert.ok(activeThinkingBlock)
  assert.equal(activeThinkingBlock.isActive, true)
})

test('drops empty thinking blocks once later visible output appears', () => {
  const run = createRun({
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'running',
        text: '已经开始输出',
        toolCalls: [],
        timelineItems: [
          {
            id: 'thinking-1',
            kind: 'thinking',
            thinking: '',
            startedAt: 10
          },
          {
            id: 'text-1',
            kind: 'text',
            text: '已经开始输出',
            startedAt: 20
          }
        ],
        startedAt: 10
      }
    ],
    text: '已经开始输出'
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['text']
  )
  assert.equal(flow.meta.showThinkingPlaceholder, false)
})

test('places inline widget blocks immediately after the widgetRenderer tool block', () => {
  const run = createRun({
    status: 'done',
    text: '后续正文',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: '后续正文',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'widgetRenderer',
            status: 'done',
            args: {
              type: 'html',
              placement: 'inline',
              html: '<div>widget</div>'
            },
            summary: JSON.stringify({
              type: 'html',
              placement: 'inline',
              html: '<div>widget</div>'
            }),
            startedAt: 30,
            endedAt: 40,
            durationMs: 10
          }
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          },
          {
            id: 'text-1',
            kind: 'text',
            text: '后续正文',
            startedAt: 50,
            endedAt: 60
          }
        ],
        startedAt: 20,
        endedAt: 60
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['tool', 'widget', 'text']
  )
})

test('renders imTool QR setup as a dedicated block even when assistant text omits the image', () => {
  const run = createRun({
    status: 'done',
    text: '微信账号配置已启动，二维码已生成。',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: '微信账号配置已启动，二维码已生成。',
        toolCalls: [
          {
            id: 'tool-1',
            agentTurnId: 'turn-1',
            name: 'imTool',
            kind: 'tool',
            invocation: 'direct',
            args: {
              action: 'setup_account',
              transportId: 'wechat'
            },
            status: 'done',
            summary: 'WeChat account setup session setup-1 started.',
            accountSetupQr: {
              transportId: 'wechat',
              accountId: 'default',
              methodId: 'wechat_qr_login',
              sessionId: 'setup-1',
              imageUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
              qrText: 'abc',
              expiresAt: '2026-04-29T07:00:57.078Z'
            },
            startedAt: 30,
            endedAt: 40,
            durationMs: 10
          } as any
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          },
          {
            id: 'text-1',
            kind: 'text',
            text: '微信账号配置已启动，二维码已生成。',
            startedAt: 50,
            endedAt: 60
          }
        ],
        startedAt: 20,
        endedAt: 60
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })
  const qrBlock = flow.blocks.find((block) => block.kind === 'transport_setup_qr') as any

  assert.ok(qrBlock)
  assert.equal(qrBlock.qr.imageUrl, 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3')
  assert.equal(qrBlock.qr.expiresAt, '2026-04-29T07:00:57.078Z')
})

test('removes duplicated QR markdown and stale expiry text when a QR setup block is present', () => {
  const run = createRun({
    status: 'done',
    text: '好的！新的微信登录二维码来了',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: '好的！新的微信登录二维码来了',
        toolCalls: [
          {
            id: 'tool-1',
            agentTurnId: 'turn-1',
            name: 'imTool',
            kind: 'tool',
            invocation: 'direct',
            args: {
              action: 'setup_account',
              transportId: 'wechat'
            },
            status: 'done',
            summary: 'WeChat account setup session setup-1 started.',
            accountSetupQr: {
              transportId: 'wechat',
              accountId: 'default',
              methodId: 'wechat_qr_login',
              sessionId: 'setup-1',
              imageUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
              qrText: 'abc',
              expiresAt: '2026-04-29T08:11:30.703Z'
            },
            startedAt: 30,
            endedAt: 40,
            durationMs: 10
          } as any
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          },
          {
            id: 'text-1',
            kind: 'text',
            text: [
              '好的！新的微信登录二维码来了',
              '',
              '![WeChat QR Code](https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3)',
              '',
              '有效期到 `08:11:30`，快用手机微信扫码吧～',
              '',
              '扫码后记得确认登录哦～'
            ].join('\n'),
            startedAt: 50,
            endedAt: 60
          }
        ],
        startedAt: 20,
        endedAt: 60
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })
  const textBlock = flow.blocks.find((block) => block.kind === 'text') as any

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['tool', 'transport_setup_qr', 'text']
  )
  assert.ok(textBlock)
  assert.equal(textBlock.text, '好的！新的微信登录二维码来了\n\n扫码后记得确认登录哦～')
  assert.doesNotMatch(textBlock.text, /!\[WeChat QR Code\]/)
  assert.doesNotMatch(textBlock.text, /08:11:30/)
  assert.doesNotMatch(textBlock.text, /liteapp\.weixin\.qq\.com/)
})

test('keeps setup method answers directly after the imTool call before the QR card', () => {
  const run = createRun({
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
            name: 'imTool',
            kind: 'tool',
            invocation: 'direct',
            args: {
              action: 'setup_account',
              transportId: 'wechat'
            },
            status: 'done',
            summary: 'WeChat account setup session setup-1 started.',
            accountSetupQr: {
              transportId: 'wechat',
              accountId: 'default',
              methodId: 'wechat_qr_login',
              sessionId: 'setup-1',
              imageUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
              qrText: 'abc',
              expiresAt: '2026-04-29T08:11:30.703Z'
            },
            startedAt: 30,
            endedAt: 40,
            durationMs: 10
          } as any
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          },
          {
            id: 'setup-answer-1',
            kind: 'questionnaire_answer',
            toolCallId: 'transport-setup-method:wechat:default',
            stepIndex: 0,
            text: '1. 选择接入方式：Scan QR code（推荐）',
            startedAt: 35
          }
        ],
        startedAt: 20,
        endedAt: 60
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['tool', 'questionnaire_answer', 'transport_setup_qr']
  )
})

test('recovers inline html widgets from tool args when summary is not JSON', () => {
  const run = createRun({
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
            name: 'widgetRenderer',
            status: 'done',
            args: {
              type: 'html',
              placement: 'inline',
              title: 'Recovered',
              html: '<div>from args</div>'
            },
            summary: 'Widget rendered (inline): Recovered',
            startedAt: 10,
            endedAt: 20,
            durationMs: 10
          }
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          }
        ],
        startedAt: 10,
        endedAt: 20
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })
  const widgetBlock = flow.blocks.find((block) => block.kind === 'widget')

  assert.ok(widgetBlock)
  assert.equal(widgetBlock.widget.kind, 'html')
  assert.equal(widgetBlock.widget.title, 'Recovered')
  assert.equal(widgetBlock.widget.html, '<div>from args</div>')
})

test('adds interrupted turn errors into the chronological flow', () => {
  const run = createRun({
    status: 'running',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'error',
        text: '',
        terminationReason: 'error',
        errorMessage: '第一次尝试失败',
        toolCalls: [],
        timelineItems: [
          {
            id: 'thinking-1',
            kind: 'thinking',
            thinking: '先试一下',
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
        status: 'running',
        text: '',
        toolCalls: [],
        timelineItems: [
          {
            id: 'thinking-2',
            kind: 'thinking',
            thinking: '',
            startedAt: 20
          }
        ],
        startedAt: 20
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['thinking', 'turn_error', 'thinking']
  )

  const errorBlock = flow.blocks.find((block) => block.kind === 'turn_error')
  assert.ok(errorBlock)
  assert.equal(errorBlock.errorMessage, '第一次尝试失败')
})

test('keeps questionnaireTool as a single expandable tool block in history', () => {
  const run = createRun({
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
            name: 'questionnaireTool',
            kind: 'tool',
            invocation: 'direct',
            status: 'running',
            args: {},
            startedAt: 10
          }
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          }
        ],
        startedAt: 10
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['tool']
  )
})

test('renders merged questionnaire answers as a single user-style answer block', () => {
  const run = createRun({
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
            name: 'questionnaireTool',
            kind: 'tool',
            invocation: 'direct',
            status: 'done',
            args: {},
            startedAt: 10,
            endedAt: 20,
            durationMs: 10
          }
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          },
          {
            id: 'merged-answer',
            kind: 'question_answer',
            toolCallId: 'tool-1',
            text: '人物范围：现实\n时代：古代\n领域：艺术/文化/文学',
            startedAt: 11
          }
        ],
        startedAt: 10,
        endedAt: 20
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['tool', 'question_answer']
  )
})

test('renders questionnaire answers inside the turn without duplicating the tool block', () => {
  const run = createRun({
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
            name: 'questionnaireTool',
            kind: 'tool',
            invocation: 'direct',
            status: 'done',
            args: {},
            startedAt: 10,
            endedAt: 20,
            durationMs: 10
          }
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          },
          {
            id: 'questionnaire-answer-1',
            kind: 'questionnaire_answer',
            toolCallId: 'tool-1',
            stepIndex: 0,
            text: '1. 第 1 步（共 1 步）· 选择一个选项：选项 A',
            startedAt: 21
          }
        ],
        startedAt: 10,
        endedAt: 20
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['tool', 'questionnaire_answer']
  )
  assert.equal(flow.blocks[1]?.kind, 'questionnaire_answer')
  if (flow.blocks[1]?.kind === 'questionnaire_answer') {
    assert.equal(flow.blocks[1].toolCallId, 'tool-1')
    assert.equal(flow.blocks[1].stepIndex, 0)
    assert.equal(flow.blocks[1].text, '1. 第 1 步（共 1 步）· 选择一个选项：选项 A')
  }
})

test('preserves chronological order across multiple turns', () => {
  const run = createRun({
    status: 'done',
    text: '最终说明',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: '先解释',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'bash',
            status: 'done',
            args: { command: 'ls -la' },
            summary: '列出了目录',
            startedAt: 20,
            endedAt: 25,
            durationMs: 5
          }
        ],
        timelineItems: [
          {
            id: 'thinking-1',
            kind: 'thinking',
            thinking: '先看一下目录',
            startedAt: 10,
            endedAt: 15
          },
          {
            id: 'text-1',
            kind: 'text',
            text: '先解释',
            startedAt: 16,
            endedAt: 19
          },
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          }
        ],
        startedAt: 10,
        endedAt: 25
      },
      {
        id: 'turn-2',
        index: 1,
        status: 'done',
        text: '最终说明',
        toolCalls: [],
        timelineItems: [
          {
            id: 'text-2',
            kind: 'text',
            text: '最终说明',
            startedAt: 30,
            endedAt: 35
          }
        ],
        startedAt: 30,
        endedAt: 35
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['thinking', 'text', 'tool', 'text']
  )
})

test('renders question answers immediately after their question prompt blocks', () => {
  const run = createRun({
    status: 'done',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: '既然是中国人，范围缩小不少。',
        toolCalls: [
          {
            id: 'tool-q1',
            name: 'questionTool',
            kind: 'question',
            status: 'done',
            args: { prompt: '第一题' },
            summary: 'User selected: 是的，中国人物',
            startedAt: 10,
            endedAt: 20,
            durationMs: 10
          }
        ],
        timelineItems: [
          {
            id: 'tool-item-q1',
            kind: 'tool',
            toolCallId: 'tool-q1'
          },
          {
            id: 'question-answer-1',
            kind: 'question_answer',
            toolCallId: 'tool-q1',
            text: '是的，中国人物',
            startedAt: 21
          },
          {
            id: 'text-1',
            kind: 'text',
            text: '既然是中国人，范围缩小不少。',
            startedAt: 22,
            endedAt: 30
          }
        ],
        startedAt: 10,
        endedAt: 30
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['question_prompt', 'question_answer', 'text']
  )

  assert.equal(flow.blocks[1]?.kind, 'question_answer')
  if (flow.blocks[1]?.kind === 'question_answer') {
    assert.equal(flow.blocks[1].text, '是的，中国人物')
    assert.equal(flow.blocks[1].toolCallId, 'tool-q1')
  }
})

test('maps edit and write tools with file paths into file blocks', () => {
  const run = createRun({
    status: 'done',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: '',
        toolCalls: [
          {
            id: 'tool-edit',
            name: 'edit',
            status: 'done',
            args: { path: 'src/foo.ts' },
            summary: 'updated src/foo.ts',
            fileChanges: [
              {
                path: 'src/foo.ts',
                diff: '@@ -1 +1 @@\n-old\n+new',
                addedLines: 1,
                removedLines: 1
              }
            ],
            startedAt: 10,
            endedAt: 12,
            durationMs: 2
          },
          {
            id: 'tool-write',
            name: 'write',
            status: 'done',
            args: { path: 'src/bar.ts', content: 'console.log("hi")\n' },
            summary: 'created src/bar.ts',
            startedAt: 13,
            endedAt: 15,
            durationMs: 2
          }
        ],
        timelineItems: [
          {
            id: 'tool-item-edit',
            kind: 'tool',
            toolCallId: 'tool-edit'
          },
          {
            id: 'tool-item-write',
            kind: 'tool',
            toolCallId: 'tool-write'
          }
        ],
        startedAt: 10,
        endedAt: 15
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['file', 'file']
  )

  const [editBlock, writeBlock] = flow.blocks
  assert.equal(editBlock.kind, 'file')
  assert.equal(editBlock.entry.fileName, 'foo.ts')
  assert.equal(writeBlock.kind, 'file')
  assert.equal(writeBlock.entry.fileName, 'bar.ts')
})

test('falls back to run text when there are no timeline blocks', () => {
  const run = createRun({
    status: 'done',
    text: '仅有最终正文'
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['text']
  )
  assert.equal(flow.blocks[0]?.kind, 'text')
  if (flow.blocks[0]?.kind === 'text') {
    assert.equal(flow.blocks[0].text, '仅有最终正文')
  }
})

test('ignores legacy selection widget payloads in the inline flow', () => {
  const run = createRun({
    status: 'done',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: '请查看上方选项',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'widgetRenderer',
            status: 'done',
            args: {
              type: 'selection',
              placement: 'chat_top',
              options: [{ label: 'A', prompt: 'choose A' }]
            },
            summary: JSON.stringify({
              type: 'selection',
              placement: 'chat_top',
              options: [{ label: 'A', prompt: 'choose A' }]
            }),
            startedAt: 10,
            endedAt: 20,
            durationMs: 10
          }
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          },
          {
            id: 'text-1',
            kind: 'text',
            text: '请查看上方选项',
            startedAt: 21,
            endedAt: 22
          }
        ],
        startedAt: 10,
        endedAt: 22
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['tool', 'text']
  )
})

test('does not inject chat_top message widgets into the inline flow', () => {
  const run = createRun({
    status: 'done',
    text: '请改用 questionTool',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'done',
        text: '请改用 questionTool',
        toolCalls: [],
        timelineItems: [
          {
            id: 'text-1',
            kind: 'text',
            text: '请改用 questionTool',
            startedAt: 10,
            endedAt: 20
          }
        ],
        startedAt: 10,
        endedAt: 20
      }
    ]
  })

  const flow = buildMessageRenderFlow({
    run,
    includeMessageWidget: true,
    messageWidget: {
      kind: 'html',
      placement: 'chat_top',
      html: ''
    }
  })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['text']
  )
})

test('keeps preface text in interrupted turns but filters interrupted trailing text', () => {
  const run = createRun({
    status: 'error',
    turns: [
      {
        id: 'turn-1',
        index: 0,
        status: 'error',
        text: '',
        terminationReason: 'error',
        errorMessage: '命令执行失败',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'bash',
            status: 'error',
            args: { command: 'bad-command' },
            summary: 'exited with code 1',
            startedAt: 20,
            endedAt: 25,
            durationMs: 5
          }
        ],
        timelineItems: [
          {
            id: 'text-preface',
            kind: 'text',
            text: '我先检查一下环境。',
            startedAt: 10,
            endedAt: 15
          },
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          },
          {
            id: 'text-trailing',
            kind: 'text',
            text: '这段中断后的残缺正文不应出现',
            startedAt: 26,
            endedAt: 27
          }
        ],
        startedAt: 10,
        endedAt: 27
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['text', 'tool', 'turn_error']
  )

  assert.equal(flow.blocks[0]?.kind, 'text')
  if (flow.blocks[0]?.kind === 'text') {
    assert.equal(flow.blocks[0].text, '我先检查一下环境。')
  }
})

test('prefers message widget over tool-derived inline widget when provided', () => {
  const run = createRun({
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
            name: 'widgetRenderer',
            status: 'done',
            args: {
              type: 'html',
              placement: 'inline',
              html: '<div>old widget</div>'
            },
            summary: JSON.stringify({
              type: 'html',
              placement: 'inline',
              html: '<div>old widget</div>'
            }),
            startedAt: 10,
            endedAt: 20,
            durationMs: 10
          }
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          }
        ],
        startedAt: 10,
        endedAt: 20
      }
    ]
  })

  const flow = buildMessageRenderFlow({
    run,
    includeMessageWidget: true,
    messageWidget: {
      kind: 'html',
      placement: 'inline',
      html: '<div>new widget</div>',
      title: 'Hydrated'
    }
  })

  const widgetBlock = flow.blocks.find((block) => block.kind === 'widget')
  assert.ok(widgetBlock)
  assert.equal(widgetBlock.widget.html, '<div>new widget</div>')
  assert.equal(widgetBlock.widget.title, 'Hydrated')
})

test('does not duplicate edit/write tool blocks when file blocks are emitted', () => {
  const run = createRun({
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
            name: 'edit',
            status: 'done',
            args: { path: 'src/a.ts' },
            summary: 'updated src/a.ts',
            fileChanges: [{ path: 'src/a.ts', diff: '@@ -1 +1 @@\n-old\n+new' }],
            startedAt: 10,
            endedAt: 11,
            durationMs: 1
          }
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          }
        ],
        startedAt: 10,
        endedAt: 11
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })

  assert.deepEqual(
    flow.blocks.map((block) => block.kind),
    ['file']
  )
})

test('creates fallback diff data for write tools without explicit diff output', () => {
  const run = createRun({
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
            name: 'write',
            status: 'done',
            args: {
              path: 'src/generated.ts',
              content: 'export const value = 1\n'
            },
            summary: 'created src/generated.ts',
            startedAt: 10,
            endedAt: 11,
            durationMs: 1
          }
        ],
        timelineItems: [
          {
            id: 'tool-item-1',
            kind: 'tool',
            toolCallId: 'tool-1'
          }
        ],
        startedAt: 10,
        endedAt: 11
      }
    ]
  })

  const flow = buildMessageRenderFlow({ run })
  const fileBlock = flow.blocks[0]

  assert.equal(fileBlock?.kind, 'file')
  if (fileBlock?.kind === 'file') {
    assert.match(fileBlock.entry.diff ?? '', /src\/generated\.ts/)
    assert.equal(fileBlock.entry.addedLines, 2)
  }
})
