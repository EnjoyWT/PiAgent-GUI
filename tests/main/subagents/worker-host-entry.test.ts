import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkerHostIpcServer } from '../../../src/main/subagents/worker-host-entry.ts'
import type {
  StartWorkerAttemptInput,
  WorkerResultEnvelope,
  WorkerSessionHandle
} from '../../../src/main/subagents/subagent-types.ts'
import { testWorkerRuntimeModel } from './runtime-model-fixture.ts'

const createStartInput = (): StartWorkerAttemptInput => ({
  groupId: 'group-1',
  taskId: 'task-1',
  attemptId: 'attempt-1',
  parentConversationId: 'conversation-1',
  parentRunId: 'run-1',
  parentMessageId: null,
  parentToolCallId: 'tool-call-1',
  correlationId: 'correlation-1',
  attemptNumber: 1,
  createdAt: '2026-05-21T00:00:00.000Z',
  timeoutMs: 60_000,
  cwd: '/repo',
  workspace: { mode: 'readonly', readableRoots: ['/repo'], writableRoots: [] },
  promptPackage: {
    systemPrompt: 'You are a worker.',
    contextMessages: [],
    taskInstruction: 'Inspect scheduler',
    resultContract: 'Return JSON.'
  },
  permissionSnapshot: {
    readableRoots: ['/repo'],
    writableRoots: [],
    allowedTools: ['read'],
    deniedTools: ['delegate_workers'],
    network: { enabled: false },
    secrets: { mode: 'none' },
    shell: { enabled: false },
    environment: { allowedKeys: [] }
  },
  modelPolicy: { providerId: 'openai', modelId: 'gpt-5.4' },
  runtimeModel: testWorkerRuntimeModel,
  toolPolicy: { activeToolNames: ['read'], blockedToolNames: ['delegate_workers'] }
})

test('worker host ipc server sends ready, runtime_event, and settle_attempt for start command', async () => {
  const sent: any[] = []
  const result: WorkerResultEnvelope = {
    status: 'completed',
    summary: 'Done',
    findings: [],
    artifacts: [],
    blockers: [],
    confidence: 'high',
    recommendedParentAction: 'collect_results'
  }
  const handle: WorkerSessionHandle = {
    workerSessionId: 'worker-session-1',
    run: async (_signal, onEvent) => {
      onEvent({ id: 'runtime-event-1', type: 'message_update', payload: { text: 'working' } })
      return result
    },
    dispose: async () => {}
  }
  const server = new WorkerHostIpcServer({
    send: (message) => sent.push(message),
    sessionFactory: {
      create: async () => handle
    },
    now: () => '2026-05-21T00:00:00.000Z'
  })

  await server.handleCommand({
    kind: 'start_attempt',
    sequence: 1,
    timestamp: '2026-05-21T00:00:00.000Z',
    input: createStartInput()
  })

  assert.equal(sent[0].kind, 'worker_ready')
  assert.equal(sent[0].workerSessionId, 'worker-session-1')
  assert.equal(sent[1].kind, 'runtime_event')
  assert.equal(sent[1].runtimeEventId, 'runtime-event-1')
  assert.equal(sent[2].kind, 'settle_attempt')
  assert.equal(sent[2].result.summary, 'Done')
})

test('worker host ipc server aborts running session on cancel command', async () => {
  const sent: any[] = []
  let aborted = false
  const server = new WorkerHostIpcServer({
    send: (message) => sent.push(message),
    sessionFactory: {
      create: async () => ({
        workerSessionId: 'worker-session-1',
        run: async (signal) => {
          await new Promise((resolve) => setTimeout(resolve, 1))
          aborted = signal.aborted
          return {
            status: 'canceled',
            summary: 'Canceled',
            findings: [],
            artifacts: [],
            blockers: [],
            confidence: 'high',
            recommendedParentAction: 'none'
          }
        },
        dispose: async () => {}
      })
    },
    now: () => '2026-05-21T00:00:00.000Z'
  })
  const input = createStartInput()
  const started = server.handleCommand({
    kind: 'start_attempt',
    sequence: 1,
    timestamp: '2026-05-21T00:00:00.000Z',
    input
  })

  await server.handleCommand({
    kind: 'cancel_attempt',
    sequence: 2,
    timestamp: '2026-05-21T00:00:00.100Z',
    groupId: input.groupId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    parentRunId: input.parentRunId,
    correlationId: input.correlationId,
    reason: 'user requested'
  })
  await started

  assert.equal(aborted, true)
  assert.equal(sent.some((message) => message.kind === 'cancel_ack'), true)
})
