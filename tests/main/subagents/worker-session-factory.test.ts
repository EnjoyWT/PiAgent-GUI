import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkerSessionFactoryImpl } from '../../../src/main/subagents/worker-session-factory.ts'
import type { StartWorkerAttemptInput } from '../../../src/main/subagents/subagent-types.ts'

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
    contextMessages: [{ role: 'user', content: 'Parent goal: inspect runtime.' }],
    taskInstruction: 'Inspect scheduler',
    resultContract: 'Return structured JSON.'
  },
  permissionSnapshot: {
    readableRoots: ['/repo'],
    writableRoots: [],
    allowedTools: ['read', 'grep'],
    deniedTools: ['delegate_workers'],
    network: { enabled: false },
    secrets: { mode: 'none' },
    shell: { enabled: false },
    environment: { allowedKeys: [] }
  },
  modelPolicy: { providerId: 'openai', modelId: 'gpt-5.4' },
  runtimeModel: {
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
  },
  toolPolicy: { activeToolNames: ['read', 'grep'], blockedToolNames: ['delegate_workers'] }
})

test('worker session factory creates an isolated session from worker prompt package and tool allowlist', async () => {
  const createCalls: any[] = []
  const promptCalls: string[] = []
  const session = {
    sessionId: 'session-worker-1',
    state: {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '{"status":"completed","summary":"Done","findings":[]}' }]
        }
      ]
    },
    subscribe: (_listener: (event: unknown) => void) => () => {},
    prompt: async (text: string) => {
      promptCalls.push(text)
    },
    abort: async () => {},
    dispose: () => {}
  }
  const factory = new WorkerSessionFactoryImpl({
    createAgentSession: async (options) => {
      createCalls.push(options)
      const auth = await options.modelRuntime!.getAuth(options.model!)
      assert.equal(options.model?.provider, 'openai')
      assert.equal(options.model?.id, 'gpt-5.4')
      assert.equal(options.model?.baseUrl, 'https://runtime.example.test/v1')
      assert.equal(auth?.auth.apiKey ?? null, 'runtime-secret-key')
      return { session } as any
    }
  })

  const handle = await factory.create(createStartInput())
  const result = await handle.run(new AbortController().signal, () => {})
  await handle.dispose()

  assert.equal(createCalls[0].cwd, '/repo')
  assert.deepEqual(createCalls[0].tools, ['read', 'grep'])
  assert.equal(createCalls[0].resourceLoader.getSystemPrompt(), 'You are a worker.')
  assert.doesNotMatch(promptCalls[0], /runtime-secret-key/)
  assert.doesNotMatch(promptCalls[0], /runtime\.example\.test/)
  assert.doesNotMatch(promptCalls[0], /gpt-5\.4/)
  assert.match(promptCalls[0], /Parent goal: inspect runtime/)
  assert.match(promptCalls[0], /Inspect scheduler/)
  assert.match(promptCalls[0], /Return structured JSON/)
  assert.equal(result.status, 'completed')
  assert.equal(result.summary, 'Done')
})

test('worker session handle forwards runtime events and aborts session when signal aborts', async () => {
  const forwardedEvents: unknown[] = []
  let listener: ((event: unknown) => void) | null = null
  let aborted = false
  const session = {
    sessionId: 'session-worker-1',
    state: { messages: [] },
    subscribe: (next: (event: unknown) => void) => {
      listener = next
      return () => {}
    },
    prompt: async () => {
      listener?.({ type: 'message_update', payload: { text: 'working' } })
    },
    abort: async () => {
      aborted = true
    },
    dispose: () => {}
  }
  const factory = new WorkerSessionFactoryImpl({
    createAgentSession: async () => ({ session }) as any
  })
  const abortController = new AbortController()
  const handle = await factory.create(createStartInput())

  abortController.abort()
  await handle.run(abortController.signal, (event) => forwardedEvents.push(event))

  assert.equal(aborted, true)
  assert.equal((forwardedEvents[0] as any).type, 'message_update')
})
