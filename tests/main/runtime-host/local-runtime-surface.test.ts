import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type {
  DelegateWorkersInput,
  WorkerRuntimeModelConfig
} from '../../../src/main/subagents/subagent-types.ts'

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

const { createLocalRuntimeSurfaceModule } = await import(
  '../../../src/main/runtime-host/runtime-surface/builtin/local-runtime-surface.ts'
)

const parentRuntimeModel: WorkerRuntimeModelConfig = {
  providerId: 'openai',
  modelId: 'gpt-5.4',
  reasoningLevel: 'medium',
  providerConfig: {
    baseUrl: 'https://runtime.example.test/v1',
    apiKey: 'runtime-secret-key',
    api: 'openai-responses',
    authHeader: true,
    models: [
      {
        id: 'gpt-5.4',
        name: 'GPT 5.4',
        api: 'openai-responses',
        baseUrl: 'https://runtime.example.test/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16000
      }
    ]
  }
}

test('local runtime surface registers subagent tools with runtime parent context', async () => {
  const delegateInputs: DelegateWorkersInput[] = []
  const module = createLocalRuntimeSurfaceModule({
    getTaskManager: () => ({
      delegateWorkers: async (input) => {
        delegateInputs.push(input)
        return {
          groupId: 'group-1',
          tasks: [{ taskId: 'task-1', label: 'Scout', status: 'running' }]
        }
      },
      waitForGroup: async () => ({
        waitStatus: 'timeout',
        groupStatus: 'running',
        completedResults: []
      }),
      buildSupervisorReport: () => ({
        groupId: 'group-1',
        groupStatus: 'running',
        nextCursor: 0,
        tasks: [],
        events: [],
        markdown: '# Report'
      }),
      collectWorkerResults: () => ({
        groupId: 'group-1',
        groupStatus: 'completed',
        completedResults: []
      }),
      retryWorker: async () => ({
        taskId: 'task-1',
        attemptId: 'attempt-2',
        attemptNumber: 2,
        status: 'running'
      }),
      cancelWorker: async () => ({
        taskId: 'task-1',
        attemptId: 'attempt-1',
        status: 'cancel_requested'
      }),
      cancelWorkerGroup: async () => ({
        groupId: 'group-1',
        groupStatus: 'running',
        tasks: []
      })
    })
  })
  const surface = await module.register({} as any)

  const tools = await surface.getCustomTools({
    conversationId: 'conversation-1',
    interactionThreadId: 'thread-1',
    workspacePath: '/repo',
    parentRuntimeModel,
    getActiveRunId: () => 'run-1',
    interactionController: {} as any
  })
  const delegateTool = tools.find((tool) => tool.name === 'delegate_workers')
  assert.ok(delegateTool)

  await delegateTool.execute(
    'tool-call-1',
    {
      tasks: [
        {
          label: 'Scout',
          instruction: 'Inspect scheduler',
          workspaceMode: 'readonly',
          toolAllowlist: ['read']
        }
      ]
    },
    new AbortController().signal,
    () => {},
    {} as any
  )

  assert.equal(delegateInputs[0]?.parentConversationId, 'conversation-1')
  assert.equal(delegateInputs[0]?.parentRunId, 'run-1')
  assert.equal(delegateInputs[0]?.parentToolCallId, 'tool-call-1')
  assert.equal(delegateInputs[0]?.cwd, '/repo')
  assert.equal(delegateInputs[0]?.runtimeModel.providerId, 'openai')
  assert.equal(delegateInputs[0]?.runtimeModel.providerConfig.apiKey, 'runtime-secret-key')
})
