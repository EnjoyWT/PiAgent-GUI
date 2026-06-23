import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

const { InMemoryCoreService } = await import('../../../src/main/core-v2/in-memory-core-service.ts')
const { CodingAgentRuntimeBridge, buildAgentSessionToolAllowlist, getAgentPluginExtensionTools } =
  await import('../../../src/main/runtime-host/coding-agent-runtime-bridge.ts')
const { replaceProviderModels, setProviderApiKey, upsertProvider } =
  await import('../../../src/main/db/config-db.ts')

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

test('runtime bridge allows pi-coding-agent to register active runtime custom tools', () => {
  const allowlist = buildAgentSessionToolAllowlist({
    activeToolNames: [
      'read',
      'bash',
      'discoverBuiltinToolsTool',
      'imTool',
      'systemDoctorTool',
      'imTool'
    ]
  } as any)

  assert.deepEqual(allowlist, [
    'bash',
    'discoverBuiltinToolsTool',
    'imTool',
    'read',
    'systemDoctorTool'
  ])
})

test('runtime bridge wires agent plugin extensions into the pi-mono resource loader', async () => {
  const tempRoot = mkdtempSync(resolve(os.tmpdir(), 'piagent-runtime-extension-'))

  try {
    const workspacePath = resolve(tempRoot, 'workspace')
    const extensionPath = resolve(tempRoot, 'plugin-extension.js')
    mkdirSync(workspacePath, { recursive: true })
    writeFileSync(
      extensionPath,
      'export default function extension(pi) { pi.on("agent_start", () => undefined) }\n',
      'utf8'
    )

    const bridge = new CodingAgentRuntimeBridge({ core: createCore() })
    const loader = await (bridge as any).createResourceLoader(
      workspacePath,
      'thread-1',
      {
        buildSystemPrompt: () => ''
      },
      'conversation-1',
      {
        skillPaths: [],
        extensionPaths: [extensionPath],
        extensionFactories: []
      }
    )

    await loader.reload()

    const loaded = loader.getExtensions()
    assert.deepEqual(
      loaded.extensions.map((extension) => extension.resolvedPath),
      [extensionPath]
    )
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('runtime bridge exposes extension-registered plugin tools for runtime catalog allowlists', async () => {
  const tempRoot = mkdtempSync(resolve(os.tmpdir(), 'piagent-runtime-extension-tools-'))

  try {
    const workspacePath = resolve(tempRoot, 'workspace')
    const extensionPath = resolve(tempRoot, 'plugin-extension.js')
    mkdirSync(workspacePath, { recursive: true })
    writeFileSync(
      extensionPath,
      `
        export default function extension(pi) {
          pi.registerTool({
            name: 'memos_search',
            label: 'Memory Search',
            description: 'Search MemOS memory',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
            execute: async () => ({ content: [{ type: 'text', text: 'ok' }] })
          })
        }
      `,
      'utf8'
    )

    const bridge = new CodingAgentRuntimeBridge({ core: createCore() })
    const loader = await (bridge as any).createResourceLoader(
      workspacePath,
      'thread-1',
      {
        buildSystemPrompt: () => ''
      },
      'conversation-1',
      {
        skillPaths: [],
        extensionPaths: [extensionPath],
        extensionFactories: []
      }
    )

    const extensionTools = getAgentPluginExtensionTools(loader)

    assert.deepEqual(
      extensionTools.map((tool) => tool.name),
      ['memos_search']
    )
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('runtime bridge resolves Gemini REST-discovered models with the native Google API', async () => {
  upsertProvider({
    id: 'google',
    displayName: 'Google Gemini',
    runtimeProvider: 'google',
    enabled: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    settingsJson: '{}'
  })
  setProviderApiKey('google', 'test-key')
  replaceProviderModels(
    'google',
    [
      {
        modelId: 'gemini-test-preview',
        label: 'Gemini Test Preview',
        contextWindowTokens: 1048576,
        capabilitiesJson: JSON.stringify({ reasoning: true }),
        rawJson: JSON.stringify({
          name: 'models/gemini-test-preview',
          inputTokenLimit: 1048576,
          outputTokenLimit: 65536,
          supportedGenerationMethods: ['generateContent']
        })
      }
    ],
    true
  )
  const bridge = new CodingAgentRuntimeBridge({ core: createCore() })

  const model = await (bridge as any).resolveModel({
    model: {
      providerId: 'google',
      modelId: 'gemini-test-preview',
      reasoningLevel: 'medium'
    },
    contextEngineId: 'summary',
    memoryProviderId: 'local-facts',
    toolProfileId: 'default',
    sandboxPolicyId: 'workspace-write'
  })

  assert.equal(model.api, 'google-generative-ai')
  assert.equal(model.baseUrl, 'https://generativelanguage.googleapis.com/v1beta')
})

test('runtime bridge resolves Xiaomi models through OpenAI-compatible reasoning protocol', async () => {
  upsertProvider({
    id: 'xiaomi',
    displayName: 'Xiaomi MiMo',
    runtimeProvider: 'xiaomi',
    enabled: true,
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    settingsJson: '{}'
  })
  setProviderApiKey('xiaomi', 'test-key')
  replaceProviderModels(
    'xiaomi',
    [
      {
        modelId: 'mimo-v2-pro',
        label: 'MiMo-V2-Pro',
        contextWindowTokens: 1048576,
        capabilitiesJson: JSON.stringify({ reasoning: true }),
        rawJson: JSON.stringify({
          id: 'mimo-v2-pro',
          name: 'MiMo-V2-Pro',
          api: 'anthropic-messages',
          provider: 'xiaomi',
          baseUrl: 'https://token-plan-ams.xiaomimimo.com/anthropic',
          reasoning: true,
          input: ['text'],
          maxTokens: 131072
        })
      }
    ],
    true
  )
  const bridge = new CodingAgentRuntimeBridge({ core: createCore() })

  const model = await (bridge as any).resolveModel({
    model: {
      providerId: 'xiaomi',
      modelId: 'mimo-v2-pro',
      reasoningLevel: 'medium'
    },
    contextEngineId: 'summary',
    memoryProviderId: 'local-facts',
    toolProfileId: 'default',
    sandboxPolicyId: 'workspace-write'
  })

  assert.equal(model.api, 'openai-completions')
  assert.equal(model.baseUrl, 'https://token-plan-cn.xiaomimimo.com/v1')
  assert.equal(model.compat?.thinkingFormat, 'deepseek')
  assert.equal(model.compat?.requiresReasoningContentOnAssistantMessages, true)
  assert.equal(model.compat?.supportsDeveloperRole, false)
})

test('runtime bridge preserves Xiaomi Anthropic endpoint when configured', async () => {
  upsertProvider({
    id: 'xiaomi',
    displayName: 'Xiaomi MiMo',
    runtimeProvider: 'xiaomi',
    enabled: true,
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    settingsJson: '{}'
  })
  setProviderApiKey('xiaomi', 'test-key')
  replaceProviderModels(
    'xiaomi',
    [
      {
        modelId: 'mimo-v2-pro',
        label: 'MiMo-V2-Pro',
        contextWindowTokens: 1048576,
        capabilitiesJson: JSON.stringify({ reasoning: true }),
        rawJson: JSON.stringify({
          id: 'mimo-v2-pro',
          name: 'MiMo-V2-Pro',
          api: 'openai-completions',
          provider: 'xiaomi',
          baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
          reasoning: true,
          input: ['text'],
          maxTokens: 131072
        })
      }
    ],
    true
  )
  const bridge = new CodingAgentRuntimeBridge({ core: createCore() })

  const model = await (bridge as any).resolveModel({
    model: {
      providerId: 'xiaomi',
      modelId: 'mimo-v2-pro',
      reasoningLevel: 'medium'
    },
    contextEngineId: 'summary',
    memoryProviderId: 'local-facts',
    toolProfileId: 'default',
    sandboxPolicyId: 'workspace-write'
  })

  assert.equal(model.api, 'anthropic-messages')
  assert.equal(model.baseUrl, 'https://token-plan-cn.xiaomimimo.com/anthropic')
  assert.equal(model.compat?.thinkingFormat, undefined)
  assert.equal(model.compat?.requiresReasoningContentOnAssistantMessages, undefined)
})

test('runtime bridge adds Xiaomi reasoning_content to replayed assistant messages', () => {
  const bridge = new CodingAgentRuntimeBridge({ core: createCore() })
  const payload = {
    messages: [
      { role: 'user', content: 'look this up' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Need to inspect docs.' },
          { type: 'text', text: 'I will inspect the docs.' },
          { type: 'tool_use', id: 'call_1', name: 'read', input: {} }
        ]
      },
      {
        role: 'assistant',
        content: 'I already have this.',
        reasoning_content: 'existing reasoning'
      },
      { role: 'assistant', content: 'No thinking block here.' }
    ]
  }

  const normalized = (bridge as any).normalizeXiaomiReasoningContentPayload(payload, {
    provider: 'xiaomi',
    api: 'anthropic-messages'
  })

  assert.notEqual(normalized, payload)
  assert.equal(normalized.messages[1].reasoning_content, 'Need to inspect docs.')
  assert.equal(normalized.messages[2].reasoning_content, 'existing reasoning')
  assert.equal(normalized.messages[3].reasoning_content, '')
})

test('runtime bridge restores Xiaomi reasoning_content from Anthropic tool-use payloads', () => {
  const bridge = new CodingAgentRuntimeBridge({ core: createCore() })
  const payload = {
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Explain Hermes hooks' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Need to inspect docs before answering.'
          },
          { type: 'tool_use', id: 'call_1', name: 'read', input: {} }
        ]
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'docs' }]
      }
    ]
  }

  const normalized = (bridge as any).normalizeXiaomiReasoningContentPayload(payload, {
    provider: 'xiaomi',
    api: 'anthropic-messages'
  })

  assert.notEqual(normalized, payload)
  assert.equal(normalized.messages[1].reasoning_content, 'Need to inspect docs before answering.')
})

test('runtime bridge leaves non-Xiaomi provider payloads unchanged', () => {
  const bridge = new CodingAgentRuntimeBridge({ core: createCore() })
  const payload = {
    messages: [{ role: 'assistant', content: 'hello' }]
  }

  const normalized = (bridge as any).normalizeXiaomiReasoningContentPayload(payload, {
    provider: 'anthropic',
    api: 'anthropic-messages'
  })

  assert.equal(normalized, payload)
  assert.equal('reasoning_content' in payload.messages[0], false)
})

test('runtime bridge fails a run when no persisted prompt message exists', async () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:missing-prompt-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:missing-prompt-thread',
      externalChatId: 'missing-prompt-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  const run = core.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    traceId: 'missing-local-message-1'
  })
  const bridge = new CodingAgentRuntimeBridge({ core })

  await bridge.start(run)

  const updated = core.getAgentRun(run.id)
  assert.equal(updated?.status, 'failed')
  assert.ok(updated?.endedAt)
})

test('runtime bridge passes streaming behavior when queueing into an active session', async () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:queue-streaming-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:queue-streaming-thread',
      externalChatId: 'queue-streaming-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  const prompts: Array<{ text: string; options: Record<string, unknown> | undefined }> = []
  const bridge = new CodingAgentRuntimeBridge({ core })
  const bridgeInternals = bridge as unknown as { sessionsByConversationId: Map<string, unknown> }
  bridgeInternals.sessionsByConversationId.set(resolved.conversation.id, {
    conversationId: resolved.conversation.id,
    interactionThreadId: 'queue-streaming-thread',
    providerId: 'openai',
    modelId: 'gpt-5.4',
    modelContextWindow: 128000,
    activeToolNames: [],
    runtimeAdapter: {},
    session: {
      isStreaming: true,
      setAutoRetryEnabled: () => undefined,
      prompt: async (text: string, options?: Record<string, unknown>) => {
        prompts.push({ text, options })
      }
    }
  })

  const queued = bridge.queueStreamingPrompt({
    conversationId: resolved.conversation.id,
    threadId: 'queue-streaming-thread',
    text: 'steer now',
    submissionId: 'submission-steer',
    streamingBehavior: 'steer',
    images: []
  })

  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(queued, true)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0]?.text, 'steer now')
  assert.equal(prompts[0]?.options?.streamingBehavior, 'steer')
  assert.equal(prompts[0]?.options?.submissionId, 'submission-steer')
})

test('runtime bridge does not submit a queued streaming prompt after hard dispose', async () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:queue-abort-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:queue-abort-thread',
      externalChatId: 'queue-abort-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  let promptCount = 0
  const bridge = new CodingAgentRuntimeBridge({ core })
  const bridgeInternals = bridge as any
  const runtime = {
    conversationId: resolved.conversation.id,
    interactionThreadId: 'queue-abort-thread',
    providerId: 'openai',
    modelId: 'gpt-5.4',
    modelContextWindow: 128000,
    activeToolNames: [],
    runtimeAdapter: {},
    session: {
      isStreaming: true,
      setAutoRetryEnabled: () => undefined,
      prompt: async () => {
        promptCount += 1
      }
    }
  }
  bridgeInternals.sessionsByConversationId.set(resolved.conversation.id, runtime)

  const queued = bridge.queueStreamingPrompt({
    conversationId: resolved.conversation.id,
    threadId: 'queue-abort-thread',
    text: 'do not submit after dispose',
    submissionId: 'submission-abort-race',
    streamingBehavior: 'steer',
    images: []
  })
  bridgeInternals.sessionsByConversationId.delete(resolved.conversation.id)

  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(queued, true)
  assert.equal(promptCount, 0)
})

test('runtime bridge persists finalized queued streaming prompts through a core run', async () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'im-thread:queued-finalize-thread',
      transportId: 'wecom',
      transportAccountId: 'desktop',
      externalMessageId: 'im-thread:queued-finalize-thread',
      externalChatId: 'queued-finalize-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'IM Thread',
    desktopVisibilityMode: 'read_write'
  })
  const bridge = new CodingAgentRuntimeBridge({ core })
  const existingRun = core.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    traceId: 'queued-message-id'
  })
  const bridgeInternals = bridge as any
  bridgeInternals.sessionsByConversationId.set(resolved.conversation.id, {
    conversationId: resolved.conversation.id,
    interactionThreadId: 'queued-finalize-thread',
    providerId: 'openai',
    modelId: 'gpt-5.4',
    modelContextWindow: 128000,
    activeToolNames: [],
    runtimeAdapter: {},
    session: {
      isStreaming: true,
      setAutoRetryEnabled: () => undefined,
      prompt: async () => {
        await bridgeInternals.persistFinalizedRun(resolved.conversation.id, {
          agentRunId: 'runtime-queued-run',
          threadId: 'queued-finalize-thread',
          status: 'done',
          text: 'queued final answer',
          turns: [],
          messages: [],
          toolCalls: [],
          startedAt: Date.parse('2026-04-20T08:01:00.000Z'),
          endedAt: Date.parse('2026-04-20T08:01:01.000Z')
        })
      }
    }
  })

  const queued = bridge.queueStreamingPrompt({
    conversationId: resolved.conversation.id,
    threadId: 'queued-finalize-thread',
    text: 'queued prompt',
    messageId: 'queued-message-id',
    submissionId: 'queued-submission',
    streamingBehavior: 'steer',
    images: []
  })

  await new Promise((resolve) => setImmediate(resolve))

  const runs = core.listConversationRuns(resolved.conversation.id)
  const finalizedRun = runs.find((run) => run.id === existingRun.id)
  const messages = core.getConversationMessages(resolved.conversation.id)

  assert.equal(queued, true)
  assert.equal(runs.filter((run) => run.traceId === 'queued-message-id').length, 1)
  assert.equal(finalizedRun?.status, 'finished')
  assert.equal(Date.parse(finalizedRun?.endedAt ?? ''), Date.parse('2026-04-20T08:01:01.000Z'))
  assert.equal(
    messages.some(
      (message) => message.role === 'assistant' && message.text === 'queued final answer'
    ),
    true
  )
})

test('runtime bridge resolves system followup prompt messages by trace id', () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:system-followup-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:system-followup-thread',
      externalChatId: 'system-followup-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  core.upsertConversationMessage({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    externalMessageId: 'transport-account-setup:setup-1:expired:system-event',
    role: 'system',
    direction: 'internal',
    text: '[System event] WeChat account setup session setup-1 expired.',
    payload: {
      transportAccountSetupSystemEvent: {
        sessionId: 'setup-1',
        status: 'expired'
      }
    },
    createdAt: '2026-04-20T08:01:00.000Z'
  })
  const run = core.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'system_followup',
    traceId: 'transport-account-setup:setup-1:expired:system-event'
  })
  const bridge = new CodingAgentRuntimeBridge({ core })

  const message = (bridge as any).resolvePromptMessage(run)

  assert.equal(message?.role, 'system')
  assert.equal(message?.externalMessageId, 'transport-account-setup:setup-1:expired:system-event')
})

test('runtime bridge suppresses synthetic system followup user app events', () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:system-followup-ui-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:system-followup-ui-thread',
      externalChatId: 'system-followup-ui-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  const run = core.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'system_followup',
    traceId: 'transport-account-setup:setup-1:completed:system-event'
  })
  const bridge = new CodingAgentRuntimeBridge({ core })

  const mapped = (bridge as any).mapAppEventRunId(resolved.conversation.id, {
    id: 'runtime-event-1',
    type: 'agent.message.started',
    timestamp: Date.parse('2026-04-20T08:01:00.000Z'),
    threadId: 'system-followup-ui-thread',
    agentRunId: run.id,
    agentTurnId: 'turn-1',
    traceId: 'runtime-event-1',
    correlationId: run.id,
    causationId: null,
    parentEventId: null,
    sequence: 1,
    agentMessageId: 'message-1',
    submissionId: null,
    message: {
      agentMessageId: 'message-1',
      agentTurnId: 'turn-1',
      role: 'user',
      status: 'running',
      text: 'Respond to the system event above in the current conversation.',
      startedAt: Date.parse('2026-04-20T08:01:00.000Z'),
      origin: 'raw'
    }
  })

  assert.equal(mapped, null)
})

test('abortConversation marks core run aborted and disposes runtime session', async () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:hard-abort-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:hard-abort-thread',
      externalChatId: 'hard-abort-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  const run = core.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    traceId: 'submission-hard-abort'
  })
  core.upsertAgentRun({
    id: run.id,
    conversationId: run.conversationId,
    instanceId: run.instanceId ?? null,
    triggerKind: run.triggerKind,
    requestedExecutionPolicy: run.requestedExecutionPolicy,
    effectiveExecutionSnapshot: run.effectiveExecutionSnapshot,
    status: 'running',
    traceId: run.traceId,
    startedAt: run.startedAt,
    endedAt: null
  })

  const session = {
    autoRetryEnabled: true,
    setAutoRetryEnabled() {},
    abort: async () => {},
    dispose() {}
  }
  const bridge = new CodingAgentRuntimeBridge({ core })
  ;(bridge as any).rememberInteractionThreadMapping(
    resolved.conversation.id,
    resolved.binding.externalChatId
  )
  ;(bridge as any).activeRunByConversationId.set(resolved.conversation.id, run)
  ;(bridge as any).sessionsByConversationId.set(resolved.conversation.id, {
    conversationId: resolved.conversation.id,
    interactionThreadId: resolved.binding.externalChatId,
    session,
    unsubscribe: () => {},
    runtimeAdapter: {
      getSnapshot() {
        return { status: 'running', agentRunId: 'runtime-run-1' }
      },
      markAbortRequested() {},
      forceAbortIfRunning() {
        return true
      },
      dispose() {}
    }
  })

  await bridge.abortConversation(resolved.conversation.id)

  assert.equal(core.getAgentRun(run.id)?.status, 'aborted')
  assert.equal((bridge as any).sessionsByConversationId.has(resolved.conversation.id), false)
})

test('start does not overwrite a run that was aborted before markRunRunning', async () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:abort-before-running-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:abort-before-running-thread',
      externalChatId: 'abort-before-running-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  const run = core.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    traceId: 'submission-abort-before-running'
  })
  const bridge = new CodingAgentRuntimeBridge({ core })
  ;(bridge as any).rememberInteractionThreadMapping(
    resolved.conversation.id,
    resolved.binding.externalChatId
  )
  ;(bridge as any).abortRequestedConversationIds.add(resolved.conversation.id)

  await (bridge as any).markRunRunning(run)

  const updated = core.getAgentRun(run.id)
  assert.equal(updated?.status, 'requested')
})

test('runtime bridge aborts a requested run before runtime session is created', async () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:pre-session-abort-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:pre-session-abort-thread',
      externalChatId: 'pre-session-abort-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  const run = core.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    traceId: 'submission-pre-session-abort'
  })
  const emitted: Array<{ type: string; run?: { status?: string } }> = []
  const bridge = new CodingAgentRuntimeBridge({
    core,
    emitAppEvent: (_threadId, event) => {
      emitted.push(event)
    }
  })
  ;(bridge as any).rememberInteractionThreadMapping(
    resolved.conversation.id,
    resolved.binding.externalChatId
  )
  ;(bridge as any).activeRunByConversationId.set(resolved.conversation.id, run)

  await bridge.abortConversation(resolved.conversation.id)

  const updated = core.getAgentRun(run.id)
  assert.equal(updated?.status, 'aborted')
  assert.equal(emitted.some((event) => event.type === 'agent.run.aborted'), true)
})

test('runtime bridge keeps auto retry disabled after aborting an active session', async () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:abort-retry-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:abort-retry-thread',
      externalChatId: 'abort-retry-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  const retryStates: boolean[] = []
  const session = {
    autoRetryEnabled: true,
    isStreaming: true,
    setAutoRetryEnabled(value: boolean) {
      retryStates.push(value)
      this.autoRetryEnabled = value
    },
    abort: async () => {}
  }
  const bridge = new CodingAgentRuntimeBridge({ core })
  ;(bridge as any).rememberInteractionThreadMapping(
    resolved.conversation.id,
    resolved.binding.externalChatId
  )
  ;(bridge as any).sessionsByConversationId.set(resolved.conversation.id, {
    conversationId: resolved.conversation.id,
    interactionThreadId: resolved.binding.externalChatId,
    session,
    runtimeAdapter: {
      getSnapshot() {
        return null
      },
      markAbortRequested() {},
      forceAbortIfRunning() {
        return false
      }
    }
  })

  await bridge.abortConversation(resolved.conversation.id)
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(retryStates, [false])
  assert.equal(session.autoRetryEnabled, false)
})

test('runtime bridge does not persist synthetic system followup user prompts', async () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:system-followup-persist-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:system-followup-persist-thread',
      externalChatId: 'system-followup-persist-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  const run = core.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'system_followup',
    traceId: 'transport-account-setup:setup-1:completed:system-event'
  })
  const bridge = new CodingAgentRuntimeBridge({ core })

  const persisted = await (bridge as any).ensureContextConsumedUserMessage(
    'system-followup-persist-thread',
    {
      threadId: 'system-followup-persist-thread',
      text: 'Respond to the system event above in the current conversation.',
      agentRunId: run.id,
      agentTurnId: 'turn-1',
      consumedAt: Date.parse('2026-04-20T08:01:00.000Z'),
      runtimeSequence: 1,
      submissionId: null
    }
  )

  assert.equal(persisted, null)
})

test('runtime bridge excludes persisted synthetic system followup prompts from model seed', async () => {
  const core = createCore()
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:system-followup-seed-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:system-followup-seed-thread',
      externalChatId: 'system-followup-seed-thread',
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z'
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  core.upsertConversationMessage({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    externalMessageId: 'normal-user-message',
    role: 'user',
    direction: 'inbound',
    text: 'hello',
    payload: {
      localThread: {
        includeInAgentContext: true,
        messageKind: 'chat'
      }
    },
    createdAt: '2026-04-20T08:01:00.000Z'
  })
  const systemFollowupRun = core.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'system_followup',
    traceId: 'transport-account-setup:setup-1:completed:system-event'
  })
  core.upsertConversationMessage({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    externalMessageId: 'synthetic-system-followup-prompt',
    role: 'user',
    direction: 'inbound',
    text: 'Respond to the system event above in the current conversation.',
    payload: {
      localThread: {
        includeInAgentContext: true,
        messageKind: 'chat',
        agentRunId: systemFollowupRun.id
      }
    },
    createdAt: '2026-04-20T08:02:00.000Z'
  })
  const bridge = new CodingAgentRuntimeBridge({ core })
  const appended: unknown[] = []
  const session = {
    agent: { state: { messages: [] as unknown[] } },
    sessionManager: {
      appendMessage: (message: unknown) => {
        appended.push(message)
        return String(appended.length)
      }
    }
  }

  await (bridge as any).applyCoreConversationSeed(session, resolved.conversation.id, null)

  assert.deepEqual(session.agent.state.messages, [{ role: 'user', content: 'hello' }])
  assert.deepEqual(appended, [{ role: 'user', content: 'hello' }])
})
