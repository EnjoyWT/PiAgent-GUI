import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import type { SubagentPanelEvent } from '../../../src/shared/subagent-panel.ts'
import type {
  CancelWorkerAttemptInput,
  StartWorkerAttemptInput,
  WorkerHandle,
  WorkerHostClient,
  WorkerHostEvent
} from '../../../src/main/subagents/subagent-types.ts'
import { testWorkerRuntimeModel } from './runtime-model-fixture.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolve(repoRoot, 'tests/main/runtime-host/electron-stub.mjs')).href
      }
    }
    if (specifier.startsWith('@shared/')) {
      const sharedPath = resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`)
      return {
        shortCircuit: true,
        url: pathToFileURL(sharedPath).href
      }
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:')
        ? fileURLToPath(context.parentURL)
        : ''
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) {
        return nextResolve(`${specifier}.ts`, context)
      }
    }
    return nextResolve(specifier, context)
  }
})

const { createSubagentTaskManagerService } = await import(
  '../../../src/main/subagents/subagent-task-manager-service.ts'
)
const { InMemorySubagentStore } = await import('../../../src/main/subagents/subagent-store.ts')
const { SubagentScheduler } = await import('../../../src/main/subagents/subagent-scheduler.ts')

class CallbackWorkerHost implements WorkerHostClient {
  onEvent: ((event: WorkerHostEvent) => void) | null = null
  started: StartWorkerAttemptInput[] = []

  async startAttempt(input: StartWorkerAttemptInput): Promise<WorkerHandle> {
    this.started.push(input)
    return {
      taskId: input.taskId,
      attemptId: input.attemptId,
      processId: 1234,
      startedAt: input.createdAt
    }
  }

  async cancelAttempt(_input: CancelWorkerAttemptInput): Promise<void> {}

  async disposeAttempt(_attemptId: string): Promise<void> {}
}

test('subagent task manager service wires worker events back into manager store', async () => {
  const store = new InMemorySubagentStore({ now: () => '2026-05-21T00:00:00.000Z' })
  const workerHost = new CallbackWorkerHost()
  const panelEvents: SubagentPanelEvent[] = []
  const manager = createSubagentTaskManagerService({
    store,
    scheduler: new SubagentScheduler({ globalMaxRunning: 1, perParentRunMaxRunning: 1 }),
    workerHostFactory: (onEvent) => {
      workerHost.onEvent = onEvent
      return workerHost
    },
    idFactory: (prefix) => `${prefix}-1`,
    now: () => '2026-05-21T00:00:00.000Z',
    emitPanelEvent: (event) => panelEvents.push(event)
  })

  const delegated = await manager.delegateWorkers({
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    cwd: '/repo',
    runtimeModel: testWorkerRuntimeModel,
    tasks: [
      {
        label: 'Scout',
        instruction: 'Inspect scheduler',
        workspaceMode: 'readonly',
        toolAllowlist: ['read']
      }
    ]
  })
  const taskId = delegated.tasks[0]!.taskId
  const attemptId = store.getTask(taskId)!.currentAttemptId!

  workerHost.onEvent?.({
    kind: 'settle_attempt',
    groupId: delegated.groupId,
    taskId,
    attemptId,
    parentRunId: 'run-1',
    correlationId: 'correlation-1',
    sequence: 2,
    timestamp: '2026-05-21T00:00:01.000Z',
    result: {
      status: 'completed',
      summary: 'Done',
      findings: [],
      artifacts: [],
      blockers: [],
      confidence: 'high',
      recommendedParentAction: 'collect_results'
    }
  })

  assert.equal(store.getTask(taskId)?.status, 'completed')
  assert.equal(store.getGroup(delegated.groupId)?.status, 'completed')
  assert.equal(panelEvents.length, 2)
  assert.equal(panelEvents[0]?.type, 'set')
  assert.equal(panelEvents[0]?.state.threadId, 'conversation-1')
  assert.equal(panelEvents[0]?.state.group.workers[0]?.status, 'running')
  assert.equal(panelEvents[1]?.type, 'set')
  assert.equal(panelEvents[1]?.state.group.workers[0]?.status, 'completed')
  assert.equal(panelEvents[1]?.state.group.workers[0]?.resultSummary, 'Done')
})

test('subagent task manager service can persist groups through sqlite db across instances', async (t) => {
  const db = new Database(':memory:')
  t.after(() => db.close())
  const firstWorkerHost = new CallbackWorkerHost()
  const first = createSubagentTaskManagerService({
    db,
    workerHostFactory: (onEvent) => {
      firstWorkerHost.onEvent = onEvent
      return firstWorkerHost
    },
    idFactory: (prefix) => `${prefix}-1`,
    now: () => '2026-05-21T00:00:00.000Z',
    emitPanelEvent: () => {}
  })

  const delegated = await first.delegateWorkers({
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    cwd: '/repo',
    runtimeModel: testWorkerRuntimeModel,
    tasks: [
      {
        label: 'Scout',
        instruction: 'Inspect scheduler',
        workspaceMode: 'readonly',
        toolAllowlist: ['read']
      }
    ]
  })

  const secondWorkerHost = new CallbackWorkerHost()
  const second = createSubagentTaskManagerService({
    db,
    workerHostFactory: (onEvent) => {
      secondWorkerHost.onEvent = onEvent
      return secondWorkerHost
    },
    idFactory: (prefix) => `${prefix}-second`,
    now: () => '2026-05-21T00:00:01.000Z',
    emitPanelEvent: () => {}
  })
  const replayed = await second.delegateWorkers({
    parentConversationId: 'conversation-1',
    parentRunId: 'run-1',
    parentMessageId: null,
    parentToolCallId: 'tool-call-1',
    cwd: '/repo',
    runtimeModel: testWorkerRuntimeModel,
    tasks: [
      {
        label: 'Scout',
        instruction: 'Inspect scheduler',
        workspaceMode: 'readonly',
        toolAllowlist: ['read']
      }
    ]
  })

  assert.equal(replayed.groupId, delegated.groupId)
  assert.equal(firstWorkerHost.started.length, 1)
  assert.equal(secondWorkerHost.started.length, 0)
})
