import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type {
  AgentAppEvent,
  NormalizedAgentRuntimeEvent
} from '../../../src/shared/agent-runtime.ts'
import type {
  AgentMessageDeltaPayload,
  AgentMessageFinishedPayload,
  AgentMessageStartedPayload,
  AgentRunEndedPayload,
  AgentRunStartedPayload,
  AgentToolCallFinishedPayload,
  AgentTurnStartedPayload
} from '../../../src/main/runtime/runtime-types.ts'

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

const { RunProjector } = await import('../../../src/main/runtime/run-projector.ts')

const isToolFinishedEvent = (
  event: AgentAppEvent
): event is Extract<AgentAppEvent, { type: 'agent.tool.finished' }> =>
  event.type === 'agent.tool.finished'

const baseEvent = <T>(
  type: NormalizedAgentRuntimeEvent<T>['type'],
  payload: T,
  overrides: Partial<NormalizedAgentRuntimeEvent<T>> = {}
): NormalizedAgentRuntimeEvent<T> => ({
  id: `event-${type}`,
  source: 'pi-mono',
  type,
  timestamp: 1000,
  threadId: 'thread-1',
  agentRunId: 'run-1',
  runtimeAgentRunId: 'runtime-run-1',
  agentTurnId: 'turn-1',
  agentMessageId: null,
  toolCallId: 'tool-1',
  origin: 'runtime',
  payload,
  raw: null,
  traceId: 'trace-1',
  correlationId: 'corr-1',
  causationId: null,
  parentEventId: null,
  sequence: 1,
  ...overrides
})

test('RunProjector preserves imTool QR setup details on the tool projection', () => {
  const projector = new RunProjector()
  const result = {
    content: [
      {
        type: 'text',
        text: 'WeChat account setup session setup-1 started.'
      }
    ],
    details: {
      setupMethod: {
        id: 'wechat_qr_login',
        kind: 'qr'
      },
      session: {
        pluginId: 'wechat',
        accountId: 'default',
        methodId: 'wechat_qr_login',
        sessionId: 'setup-1',
        startedAt: '2026-04-29T06:52:57.078Z',
        expiresAt: '2026-04-29T07:00:57.078Z',
        events: [
          {
            type: 'qr',
            pluginId: 'wechat',
            accountId: 'default',
            methodId: 'wechat_qr_login',
            sessionId: 'setup-1',
            qrImageDataUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
            qrText: 'abc',
            expiresAt: '2026-04-29T07:00:57.078Z'
          }
        ]
      }
    }
  }

  const events = projector.apply(
    baseEvent<AgentToolCallFinishedPayload>('agentToolCallFinished', {
      rawType: 'tool_execution_end',
      toolName: 'imTool',
      args: {
        action: 'setup_account',
        transportId: 'wechat'
      },
      result,
      isError: false
    })
  )

  const finished = events.find(isToolFinishedEvent)
  assert.ok(finished)
  const qr = finished.tool.accountSetupQr
  assert.ok(qr)
  assert.equal(qr.imageUrl, 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3')
  assert.equal(qr.sessionId, 'setup-1')
  assert.equal(qr.startedAt, '2026-04-29T06:52:57.078Z')
  assert.equal(qr.expiresAt, '2026-04-29T07:00:57.078Z')
  assert.equal(qr.qrText, 'abc')
})

test('RunProjector projects computerUseTool screenshot paths as renderable images', () => {
  const projector = new RunProjector()
  const result = {
    content: [{ type: 'text', text: 'Computer Use screenshot completed.' }],
    details: {
      ok: true,
      action: 'screenshot',
      observation: {
        screenshot: {
          mimeType: 'image/png',
          path: '/tmp/piagent-computer-use/screen-abc.png',
          width: 640,
          height: 360
        }
      }
    }
  }

  const events = projector.apply(
    baseEvent<AgentToolCallFinishedPayload>('agentToolCallFinished', {
      rawType: 'tool_execution_end',
      toolName: 'computerUseTool',
      args: { action: 'screenshot' },
      result,
      isError: false
    })
  )

  const finished = events.find(isToolFinishedEvent)
  assert.ok(finished)
  const image = finished.tool.toolImages?.[0]
  assert.ok(image)
  assert.equal(image.path, '/tmp/piagent-computer-use/screen-abc.png')
  assert.equal(image.url, 'http://127.0.0.1:5566/assets/computer-use/screen-abc.png')
  assert.equal(image.width, 640)
  assert.equal(image.height, 360)
})

test('RunProjector ignores duplicate terminal events for an already closed run', () => {
  const projector = new RunProjector()

  projector.apply(
    baseEvent<AgentRunStartedPayload>(
      'agentRunStarted',
      { rawType: 'agent_start' },
      { sequence: 1 }
    )
  )
  projector.apply(
    baseEvent<AgentTurnStartedPayload>(
      'agentTurnStarted',
      { rawType: 'turn_start', turnIndex: 0 },
      { sequence: 2 }
    )
  )
  projector.apply(
    baseEvent<AgentMessageStartedPayload>(
      'agentMessageStarted',
      {
        rawType: 'message_start',
        role: 'assistant',
        message: { role: 'assistant', content: [] },
        retrying: false
      },
      { agentMessageId: 'message-1', sequence: 3 }
    )
  )
  projector.apply(
    baseEvent<AgentMessageDeltaPayload>(
      'agentMessageDelta',
      {
        rawType: 'message_update',
        delta: 'partial answer',
        message: { role: 'assistant', content: [{ type: 'text', text: 'partial answer' }] },
        assistantMessageEvent: {}
      },
      { agentMessageId: 'message-1', sequence: 4 }
    )
  )
  projector.apply(
    baseEvent<AgentMessageFinishedPayload>(
      'agentMessageFinished',
      {
        rawType: 'message_end',
        role: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'partial answer' }] }
      },
      { agentMessageId: 'message-1', sequence: 5 }
    )
  )

  const firstAbort = projector.apply(
    baseEvent<AgentRunEndedPayload>(
      'agentRunAborted',
      { rawType: 'agent_end', messages: [], requestedStatus: 'aborted' },
      { timestamp: 2000, sequence: 6, origin: 'inferred' }
    )
  )
  assert.equal(firstAbort.filter((event) => event.type === 'agent.run.aborted').length, 1)

  const duplicateAbort = projector.apply(
    baseEvent<AgentRunEndedPayload>(
      'agentRunAborted',
      {
        rawType: 'agent_end',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'full final answer' }] }],
        requestedStatus: 'aborted'
      },
      { timestamp: 3000, sequence: 7 }
    )
  )

  assert.deepEqual(duplicateAbort, [])
})

test('RunProjector treats explicit finished run as successful even after a tool error', () => {
  const projector = new RunProjector()

  projector.apply(
    baseEvent<AgentRunStartedPayload>(
      'agentRunStarted',
      { rawType: 'agent_start' },
      { sequence: 1 }
    )
  )
  projector.apply(
    baseEvent<AgentTurnStartedPayload>(
      'agentTurnStarted',
      { rawType: 'turn_start', turnIndex: 0 },
      { sequence: 2 }
    )
  )
  projector.apply(
    baseEvent<AgentToolCallFinishedPayload>(
      'agentToolCallFinished',
      {
        rawType: 'tool_execution_end',
        toolName: 'write',
        args: { path: '/tmp/diary.md' },
        result: { content: [{ type: 'text', text: 'temporary tool issue' }] },
        isError: true
      },
      { sequence: 3 }
    )
  )

  const events = projector.apply(
    baseEvent<AgentRunEndedPayload>(
      'agentRunFinished',
      {
        rawType: 'agent_end',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: '日记写好了。' }] }],
        requestedStatus: 'finished'
      },
      { agentMessageId: 'message-final', timestamp: 2000, sequence: 4 }
    )
  )

  const finished = events.find((event) => event.type === 'agent.run.finished')
  assert.ok(finished)
  assert.equal(finished.run.status, 'done')
  assert.equal(finished.run.termination?.kind, 'success')
  assert.equal(finished.run.text, '日记写好了。')
})
