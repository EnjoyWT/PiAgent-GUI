import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { NormalizedAgentRuntimeEvent } from '../../../src/shared/agent-runtime.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@shared/')) {
      return {
        shortCircuit: true,
        url: pathToFileURL(
          resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`)
        ).href
      }
    }
    return nextResolve(specifier, context)
  }
})

const { RuntimeEventStore } = await import('../../../src/main/runtime/runtime-event-store.ts')

const event = <T>(
  type: NormalizedAgentRuntimeEvent<T>['type'],
  payload: T
): NormalizedAgentRuntimeEvent<T> => ({
  id: `event-${type}`,
  source: 'pi-mono',
  type,
  timestamp: 1_754_750_400_000,
  threadId: 'thread-1',
  agentRunId: 'run-1',
  runtimeAgentRunId: 'runtime-run-1',
  agentTurnId: 'turn-1',
  agentMessageId: 'message-1',
  toolCallId: 'tool-1',
  origin: 'runtime',
  payload,
  raw: null,
  traceId: 'trace-1',
  correlationId: 'correlation-1',
  causationId: null,
  parentEventId: null,
  sequence: 1
})

test('runtime event store never flushes streaming deltas to durable storage', () => {
  const persisted: string[] = []
  const store = new RuntimeEventStore({
    onEventsFlushed: (rows) => {
      persisted.push(...rows.map((row) => row.event_type))
    }
  })

  store.append(
    event('agentMessageThinkingDelta', {
      rawType: 'message_update',
      delta: '正在推理',
      message: {},
      assistantMessageEvent: {}
    })
  )
  store.append(
    event('agentMessageDelta', {
      rawType: 'message_update',
      delta: '第一段正文',
      message: {},
      assistantMessageEvent: {}
    })
  )
  store.append(
    event('agentToolCallProgress', {
      rawType: 'tool_execution_update',
      toolName: 'bash',
      partialResult: '执行中'
    })
  )
  store.flush()

  assert.deepEqual(persisted, [])
})
