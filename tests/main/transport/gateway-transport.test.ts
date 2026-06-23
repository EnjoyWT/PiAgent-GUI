import test from 'node:test'
import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import Database from 'better-sqlite3'
import { InMemoryCoreService } from '../../../src/main/core-v2/in-memory-core-service.ts'
import { buildLocalThreadRoutingKey } from '../../../src/main/core-v2/local-thread-binding.ts'
import {
  EmbeddedGatewayService,
  type EmbeddedGatewayInboundResult,
  type EmbeddedGatewayLocalSubmitResult
} from '../../../src/main/transport/embedded-gateway.ts'
import { TransportHost } from '../../../src/main/transport/transport-host.ts'
import type {
  DeliveryCommand,
  TransportPlugin
} from '../../../src/main/transport/transport-contract.ts'
import { TransportPluginConfigService } from '../../../src/main/plugin-system/transport-plugin-config-service.ts'
import type {
  PluginManifest,
  PluginRegistration
} from '../../../src/main/plugin-system/plugin-types.ts'

const createTransportConfigService = () =>
  new TransportPluginConfigService(new Database(':memory:'))

type ScheduledGatewayInboundResult = EmbeddedGatewayInboundResult & {
  action: 'scheduled'
  binding: NonNullable<EmbeddedGatewayInboundResult['binding']>
  run: NonNullable<EmbeddedGatewayInboundResult['run']>
  scheduleDecision: NonNullable<EmbeddedGatewayInboundResult['scheduleDecision']>
}

function assertScheduledGatewayResult(
  result: EmbeddedGatewayInboundResult | EmbeddedGatewayLocalSubmitResult
): asserts result is ScheduledGatewayInboundResult {
  assert.equal(result.action, 'scheduled')
}

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

test('embedded gateway activates builtin desktop transport', async () => {
  const core = createCore()
  const gateway = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: []
  })

  await gateway.start()

  const statuses = gateway.listTransportStatuses()
  assert.equal(statuses.length, 1)
  assert.equal(statuses[0]?.pluginId, 'desktop-chat')
  assert.equal(statuses[0]?.state, 'activated')

  await gateway.stop()
})

test('embedded gateway does not auto-connect Telegram from environment token', async () => {
  const previousToken = process.env.PIAGENT_TELEGRAM_BOT_TOKEN
  process.env.PIAGENT_TELEGRAM_BOT_TOKEN = 'telegram-token'

  class RecordingTransportHost extends TransportHost {
    readonly connectCalls: Array<{ transportId: string; accountId: string }> = []

    override async connect(transportId: string, accountId: string): Promise<void> {
      this.connectCalls.push({ transportId, accountId })
    }
  }

  const transportHost = new RecordingTransportHost()
  const gateway = new EmbeddedGatewayService({
    core: createCore(),
    transportHost,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: []
  })

  try {
    await gateway.start()

    assert.deepEqual(transportHost.connectCalls, [
      { transportId: 'desktop-chat', accountId: 'desktop' }
    ])
  } finally {
    await gateway.stop()
    if (previousToken === undefined) delete process.env.PIAGENT_TELEGRAM_BOT_TOKEN
    else process.env.PIAGENT_TELEGRAM_BOT_TOKEN = previousToken
  }
})

test('embedded gateway redacts Telegram bot tokens from startup connect errors', async () => {
  const token = '123456789:ABCdefGHI-secret_token'
  const telegramManifest: PluginManifest = {
    id: 'telegram',
    kind: 'transport',
    apiVersion: '1',
    version: '0.1.0',
    displayName: 'Telegram',
    contributes: {
      settings: {
        scope: 'transport_account',
        supportsMultipleAccounts: false,
        fields: [
          {
            key: 'botToken',
            type: 'secret',
            label: 'Bot Token',
            required: true
          }
        ]
      }
    }
  }

  class FailingStartupTransportHost extends TransportHost {
    override async activateAll(): Promise<void> {}

    override listRegistrations(): Array<PluginRegistration<TransportPlugin>> {
      return [
        ...super.listRegistrations(),
        {
          manifest: telegramManifest,
          sourceKind: 'user',
          state: 'activated',
          error: null
        }
      ]
    }

    override async connect(transportId: string): Promise<void> {
      if (transportId !== 'telegram') return

      const cause = new Error(
        `request to https://api.telegram.org/bot${token}/getMe failed, reason: ECONNRESET`
      )
      throw new Error('Unable to connect Telegram transport.', { cause })
    }
  }

  const transportPluginConfigService = createTransportConfigService()
  transportPluginConfigService.setPluginEnabled({ pluginId: 'telegram', enabled: true })
  transportPluginConfigService.saveAccount(telegramManifest, {
    pluginId: 'telegram',
    accountId: 'default',
    enabled: true,
    config: {},
    secrets: { botToken: token }
  })

  const gateway = new EmbeddedGatewayService({
    core: createCore(),
    transportHost: new FailingStartupTransportHost(),
    transportPluginConfigService,
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: []
  })
  const originalConsoleError = console.error
  const calls: unknown[][] = []
  console.error = (...args: unknown[]) => {
    calls.push(args)
  }

  try {
    await gateway.start()
  } finally {
    console.error = originalConsoleError
    await gateway.stop()
  }

  const rendered = calls
    .flat()
    .map((arg) => inspect(arg, { depth: 10 }))
    .join('\n')
  assert.match(rendered, /Start transport failed for telegram:default/)
  assert.equal(rendered.includes(token), false)
  assert.match(rendered, /\[REDACTED_TELEGRAM_BOT_TOKEN\]/)
})

test('embedded gateway restart reinitializes transports after startup', async () => {
  const core = createCore()
  const gateway = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: []
  })

  await gateway.start()
  await gateway.restart()

  const statuses = gateway.listTransportStatuses()
  assert.equal(statuses.length, 1)
  assert.equal(statuses[0]?.pluginId, 'desktop-chat')
  assert.equal(statuses[0]?.state, 'activated')

  await gateway.stop()
})

test('gateway routes inbound envelopes into core conversations and requested runs', async () => {
  const core = createCore()
  const gateway = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: []
  })

  const result = gateway.ingestInbound({
    envelopeId: 'env-1',
    transportId: 'wecom',
    transportAccountId: 'corp-a',
    externalMessageId: 'msg-1',
    externalChatId: 'chat-a',
    externalUserId: 'user-a',
    externalUserDisplayName: '张三',
    channelKind: 'group',
    receivedAt: '2026-04-20T08:00:00.000Z',
    text: 'hello'
  })
  assertScheduledGatewayResult(result)

  const conversation = core.getConversation(result.conversationId)
  const binding = core.getConversationBinding(result.binding.id)
  const messages = core.getConversationMessages(result.conversationId)
  const runs = core.listConversationRuns(result.conversationId)
  const windows = core.listConversationWindows('im')

  assert.equal(conversation?.desktopVisibilityMode, 'readonly')
  assert.equal(result.binding.transportId, 'wecom')
  assert.equal(binding?.sessionScope, 'group_per_member')
  assert.equal(binding?.personId, 'im-person:wecom:corp-a:user-a')
  assert.equal(binding?.lastInboundTraceId, 'im:wecom:corp-a:msg-1')
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.text, 'hello')
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.triggerKind, 'transport_message')
  assert.equal(runs[0]?.traceId, 'im:wecom:corp-a:msg-1')
  assert.equal(result.scheduleDecision.action, 'start')
  assert.equal(windows.length, 1)
})

test('gateway submits persisted desktop local messages without duplicating user rows', async () => {
  const core = createCore()
  const threadId = 'local-thread-a'
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: `local-thread:${threadId}`,
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: `local-thread:${threadId}`,
      externalChatId: threadId,
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z',
      routingKey: buildLocalThreadRoutingKey(threadId)
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  core.upsertConversationMessage({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    externalMessageId: 'local-message-1',
    role: 'user',
    direction: 'inbound',
    text: 'hello local',
    payload: {
      legacy: {
        source: 'test',
        messageKind: 'chat',
        includeInAgentContext: true,
        submissionId: 'submission-1',
        contentJson: JSON.stringify({
          version: 1,
          blocks: [{ type: 'text', text: 'hello local' }]
        })
      }
    },
    createdAt: '2026-04-20T08:00:01.000Z'
  })

  const gateway = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: []
  })

  const result = gateway.submitDesktopLocalMessage({
    threadId,
    text: 'hello local',
    messageId: 'local-message-1',
    submissionId: 'submission-1',
    receivedAt: '2026-04-20T08:00:02.000Z'
  })
  assertScheduledGatewayResult(result)

  const messages = core.getConversationMessages(resolved.conversation.id)
  const runs = core.listConversationRuns(resolved.conversation.id)

  assert.equal(result.conversationId, resolved.conversation.id)
  assert.equal(result.binding.id, resolved.binding.id)
  assert.equal(result.message, null)
  assert.equal(messages.length, 1)
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.triggerKind, 'user_message')
  assert.equal(runs[0]?.traceId, 'local-message-1')
  assert.equal(result.scheduleDecision.action, 'start')
})

test('gateway queues desktop steering prompt into the active runtime instead of scheduling another run', () => {
  const core = createCore()
  const threadId = 'local-thread-runtime-steer'
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: `local-thread:${threadId}`,
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: `local-thread:${threadId}`,
      externalChatId: threadId,
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z',
      routingKey: buildLocalThreadRoutingKey(threadId)
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })
  core.upsertConversationMessage({
    conversationId: resolved.conversation.id,
    bindingId: resolved.binding.id,
    externalMessageId: 'local-message-steer',
    role: 'user',
    direction: 'inbound',
    text: 'steer now',
    payload: {
      localThread: {
        version: 1,
        messageKind: 'chat',
        includeInAgentContext: true,
        submissionId: 'submission-steer',
        content: { version: 1, blocks: [{ type: 'text', text: 'steer now' }] }
      }
    },
    createdAt: '2026-04-20T08:00:01.000Z'
  })
  const queuedPrompts: unknown[] = []
  const gateway = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: [],
    runExecutor: {
      start: async () => undefined,
      queueStreamingPrompt: (input: unknown) => {
        queuedPrompts.push(input)
        return true
      }
    }
  })

  const result = gateway.submitDesktopLocalMessage({
    threadId,
    text: 'steer now',
    messageId: 'local-message-steer',
    submissionId: 'submission-steer',
    receivedAt: '2026-04-20T08:00:02.000Z',
    streamingBehavior: 'steer'
  })

  assert.equal((result as { action: string }).action, 'runtime_queued')
  assert.equal(queuedPrompts.length, 1)
  assert.deepEqual(queuedPrompts[0], {
    conversationId: resolved.conversation.id,
    threadId,
    text: 'steer now',
    submissionId: 'submission-steer',
    streamingBehavior: 'steer',
    images: []
  })
  assert.equal(core.listConversationRuns(resolved.conversation.id).length, 0)
})

test('gateway appends desktop local message when the persisted row is missing', async () => {
  const core = createCore()
  const threadId = 'local-thread-missing-message'
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: `local-thread:${threadId}`,
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: `local-thread:${threadId}`,
      externalChatId: threadId,
      channelKind: 'dm',
      receivedAt: '2026-04-20T08:00:00.000Z',
      routingKey: buildLocalThreadRoutingKey(threadId)
    },
    workspaceId: '/tmp/piagent-project',
    title: 'Local Thread',
    desktopVisibilityMode: 'read_write'
  })

  const gateway = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: []
  })

  const result = gateway.submitDesktopLocalMessage({
    threadId,
    text: 'hello after stale cache',
    messageId: 'missing-local-message-1',
    submissionId: 'submission-missing-1',
    receivedAt: '2026-04-20T08:00:02.000Z'
  })
  assertScheduledGatewayResult(result)

  const messages = core.getConversationMessages(resolved.conversation.id)
  const runs = core.listConversationRuns(resolved.conversation.id)

  assert.equal(result.conversationId, resolved.conversation.id)
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.externalMessageId, 'missing-local-message-1')
  assert.equal(messages[0]?.text, 'hello after stale cache')
  assert.equal(result.message?.id, messages[0]?.id)
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.traceId, 'missing-local-message-1')
  assert.equal(result.scheduleDecision.action, 'start')
})

test('gateway dispatches requested deliveries through transport plugin and updates delivery status', async () => {
  const core = createCore()
  const gateway = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: []
  })
  await gateway.start()

  const inbound = gateway.ingestInbound({
    envelopeId: 'env-2',
    transportId: 'desktop-chat',
    transportAccountId: 'desktop',
    externalMessageId: 'msg-2',
    externalChatId: 'local-thread-a',
    externalUserId: 'local-user',
    externalUserDisplayName: 'Local',
    channelKind: 'dm',
    receivedAt: '2026-04-20T08:00:00.000Z',
    text: 'hello'
  })
  assertScheduledGatewayResult(inbound)
  const requested = core.requestDelivery({
    conversationId: inbound.conversationId,
    bindingId: inbound.binding.id,
    mode: 'send',
    payload: { text: 'reply' }
  })

  const results = await gateway.dispatchPendingDeliveries()
  const updated = core.getDeliveryRecord(requested.id)

  assert.equal(results.length, 1)
  assert.equal(results[0]?.deliveryId, requested.id)
  assert.equal(results[0]?.status, 'sent')
  assert.equal(updated?.status, 'sent')

  await gateway.stop()
})

test('gateway immediately dispatches IM command replies from transport inbound events', async () => {
  const core = createCore()
  const transportHost = new TransportHost()
  const sentCommands: DeliveryCommand[] = []

  transportHost.discoverBuiltin({
    manifest: {
      id: 'feishu',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Feishu'
    },
    register: () => ({
      metadata: {
        id: 'feishu',
        displayName: 'Feishu',
        version: '0.1.0'
      },
      getCapabilities: () => ({
        canEditMessage: false,
        canStreamByEdit: false,
        canRenderButtons: false,
        canRenderRichCards: false,
        canReplyInThread: true,
        canUploadImage: false,
        canUploadFile: false,
        canCollectStructuredForm: false
      }),
      connect: async () => undefined,
      disconnect: async () => undefined,
      send: async (command: DeliveryCommand) => {
        sentCommands.push(command)
        return { status: 'sent', externalMessageId: `sent:${command.deliveryId}` }
      },
      onInbound: () => () => undefined
    })
  })

  const gateway = new EmbeddedGatewayService({
    core,
    transportHost,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: []
  })
  await gateway.start()

  await transportHost.emitInbound({
    envelopeId: 'env-im-status',
    transportId: 'feishu',
    transportAccountId: 'default',
    externalMessageId: 'msg-im-status',
    externalChatId: 'chat-a',
    externalUserId: 'user-a',
    externalUserDisplayName: 'Alice',
    channelKind: 'group',
    receivedAt: '2026-04-30T08:00:00.000Z',
    text: '/status'
  })

  assert.equal(sentCommands.length, 1)
  assert.equal(sentCommands[0]?.externalChatId, 'chat-a')
  assert.match(JSON.stringify(sentCommands[0]?.payload ?? {}), /Session/)

  const deliveries = core.getDeliveryRecords(sentCommands[0]?.conversationId ?? '')
  assert.equal(deliveries[0]?.status, 'sent')

  await gateway.stop()
})

test('gateway executor starts first scheduled run and queues same-conversation runs until completion', async () => {
  const core = createCore()
  let resolveFirstRun: () => void = () => {}
  const startedRunIds: string[] = []
  const gateway = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: [],
    runExecutor: {
      start: async (run) => {
        startedRunIds.push(run.id)
        if (startedRunIds.length === 1) {
          await new Promise<void>((resolve) => {
            resolveFirstRun = resolve
          })
        }
      }
    }
  })

  const first = gateway.ingestInbound({
    envelopeId: 'env-queue-1',
    transportId: 'wecom',
    transportAccountId: 'corp-a',
    externalMessageId: 'msg-queue-1',
    externalChatId: 'chat-queue',
    externalUserId: 'user-a',
    externalUserDisplayName: '张三',
    channelKind: 'group',
    receivedAt: '2026-04-20T08:00:00.000Z',
    text: 'first'
  })
  assertScheduledGatewayResult(first)
  const second = gateway.ingestInbound({
    envelopeId: 'env-queue-2',
    transportId: 'wecom',
    transportAccountId: 'corp-a',
    externalMessageId: 'msg-queue-2',
    externalChatId: 'chat-queue',
    externalUserId: 'user-a',
    externalUserDisplayName: '张三',
    channelKind: 'group',
    receivedAt: '2026-04-20T08:00:01.000Z',
    text: 'second'
  })
  assertScheduledGatewayResult(second)

  assert.equal(first.scheduleDecision.action, 'start')
  assert.equal(second.scheduleDecision.action, 'queued')
  assert.deepEqual(startedRunIds, [first.run.id])

  resolveFirstRun()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(startedRunIds, [first.run.id, second.run.id])
})

test('gateway sends typing action while an IM scheduled run is active', async () => {
  const core = createCore()
  const transportHost = new TransportHost()
  const sentModes: string[] = []
  let finishRun: () => void = () => undefined

  transportHost.discoverBuiltin({
    manifest: {
      id: 'wecom',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'WeCom'
    },
    register: () => ({
      metadata: {
        id: 'wecom',
        displayName: 'WeCom',
        version: '0.1.0'
      },
      getCapabilities: () => ({
        canEditMessage: false,
        canStreamByEdit: false,
        canRenderButtons: false,
        canRenderRichCards: false,
        canReplyInThread: true,
        canUploadImage: false,
        canUploadFile: false,
        canCollectStructuredForm: false
      }),
      connect: async () => undefined,
      disconnect: async () => undefined,
      send: async (command) => {
        sentModes.push(command.mode)
        return { status: 'sent', externalMessageId: null }
      },
      onInbound: () => () => undefined
    })
  })
  await transportHost.activateAll()

  const gateway = new EmbeddedGatewayService({
    core,
    transportHost,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    externalPluginDirectories: [],
    runExecutor: {
      start: async () => {
        await new Promise<void>((resolve) => {
          finishRun = resolve
        })
      }
    }
  })

  const result = gateway.ingestInbound({
    envelopeId: 'env-typing-1',
    transportId: 'wecom',
    transportAccountId: 'corp-a',
    externalMessageId: 'msg-typing-1',
    externalChatId: 'chat-typing',
    externalUserId: 'user-a',
    externalUserDisplayName: '张三',
    channelKind: 'group',
    receivedAt: '2026-04-20T08:00:00.000Z',
    text: 'please think'
  })
  assertScheduledGatewayResult(result)

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(sentModes, ['typing'])

  finishRun()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

test('gateway lists configurable transport plugins and auto-connects saved accounts on start', async () => {
  const core = createCore()
  const db = new Database(':memory:')
  const configService = new TransportPluginConfigService(db)
  const transportHost = new TransportHost()
  const connectCalls: string[] = []

  transportHost.discoverBuiltin({
    manifest: {
      id: 'feishu',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Feishu',
      contributes: {
        settings: {
          scope: 'transport_account',
          supportsMultipleAccounts: false,
          fields: [
            {
              key: 'appId',
              type: 'text',
              label: 'App ID',
              required: true
            },
            {
              key: 'appSecret',
              type: 'secret',
              label: 'App Secret',
              required: true
            }
          ]
        }
      }
    },
    register: () => ({
      metadata: {
        id: 'feishu',
        displayName: 'Feishu',
        version: '0.1.0'
      },
      getCapabilities: () => ({
        canEditMessage: false,
        canStreamByEdit: false,
        canRenderButtons: false,
        canRenderRichCards: false,
        canReplyInThread: true,
        canUploadImage: false,
        canUploadFile: false,
        canCollectStructuredForm: false
      }),
      connect: async (accountId: string) => {
        connectCalls.push(accountId)
      },
      disconnect: async () => undefined,
      send: async () => ({ status: 'sent', externalMessageId: 'external-msg-1' }),
      onInbound: () => () => undefined
    })
  })

  const gateway = new EmbeddedGatewayService({
    core,
    resolveAgentProfileId: () => 'default',
    transportHost,
    transportPluginConfigService: configService,
    externalPluginDirectories: []
  })

  const listedBeforeSave = await gateway.listInstalledTransportPlugins()
  assert.equal(listedBeforeSave.length, 1)
  assert.equal(listedBeforeSave[0]?.pluginId, 'feishu')
  assert.equal(listedBeforeSave[0]?.accountCount, 0)
  assert.equal(listedBeforeSave[0]?.enabled, false)
  assert.equal(listedBeforeSave[0]?.validationStatus, 'unknown')

  const saved = await gateway.saveTransportAccount({
    pluginId: 'feishu',
    accountId: 'default',
    config: {
      appId: 'cli_xxx'
    },
    secrets: {
      appSecret: 'secret-xxx'
    }
  })
  assert.equal(saved.accountId, 'default')
  assert.deepEqual(saved.hasSecrets, { appSecret: true })

  const listedAfterSave = await gateway.listInstalledTransportPlugins()
  assert.equal(listedAfterSave[0]?.accountCount, 1)
  assert.equal(listedAfterSave[0]?.enabled, false)
  assert.equal(listedAfterSave[0]?.validationStatus, 'unknown')

  await gateway.setTransportPluginEnabled({
    pluginId: 'feishu',
    enabled: true
  })

  await gateway.start()
  assert.deepEqual(connectCalls, ['default'])
  await gateway.stop()
})

test('gateway validates transport accounts via plugin probe when available', async () => {
  const core = createCore()
  const db = new Database(':memory:')
  const configService = new TransportPluginConfigService(db)
  const transportHost = new TransportHost()
  const validateCalls: string[] = []
  const connectCalls: string[] = []

  transportHost.discoverBuiltin({
    manifest: {
      id: 'feishu',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Feishu',
      contributes: {
        settings: {
          scope: 'transport_account',
          supportsMultipleAccounts: false,
          fields: [
            {
              key: 'appId',
              type: 'text',
              label: 'App ID',
              required: true
            },
            {
              key: 'appSecret',
              type: 'secret',
              label: 'App Secret',
              required: true
            }
          ]
        }
      }
    },
    register: () => ({
      metadata: {
        id: 'feishu',
        displayName: 'Feishu',
        version: '0.1.0'
      },
      getCapabilities: () => ({
        canEditMessage: false,
        canStreamByEdit: false,
        canRenderButtons: false,
        canRenderRichCards: false,
        canReplyInThread: true,
        canUploadImage: false,
        canUploadFile: false,
        canCollectStructuredForm: false
      }),
      validateAccount: async (accountId: string) => {
        validateCalls.push(accountId)
      },
      connect: async (accountId: string) => {
        connectCalls.push(accountId)
      },
      disconnect: async () => undefined,
      send: async () => ({ status: 'sent', externalMessageId: 'external-msg-1' }),
      onInbound: () => () => undefined
    })
  })

  const gateway = new EmbeddedGatewayService({
    core,
    resolveAgentProfileId: () => 'default',
    transportHost,
    transportPluginConfigService: configService,
    externalPluginDirectories: []
  })

  await gateway.saveTransportAccount({
    pluginId: 'feishu',
    accountId: 'default',
    config: {
      appId: 'cli_xxx'
    },
    secrets: {
      appSecret: 'secret-xxx'
    }
  })

  const result = await gateway.testTransportAccount({
    pluginId: 'feishu',
    accountId: 'default'
  })

  assert.equal(result.success, true)
  assert.deepEqual(validateCalls, ['default'])
  assert.deepEqual(connectCalls, [])
})

test('gateway starts account setup sessions and saves completed plugin results', async () => {
  const core = createCore()
  const db = new Database(':memory:')
  const configService = new TransportPluginConfigService(db)
  const transportHost = new TransportHost()
  const setupEvents: unknown[] = []
  const startCalls: unknown[] = []

  transportHost.discoverBuiltin({
    manifest: {
      id: 'wechat',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'WeChat',
      contributes: {
        settings: {
          scope: 'transport_account',
          supportsMultipleAccounts: false,
          setupMethods: [
            {
              id: 'wechat_qr_login',
              kind: 'qr',
              label: '扫码登录',
              recommended: true,
              outputConfigKeys: ['accountExternalId', 'baseUrl'],
              outputSecretKeys: ['token']
            }
          ],
          fields: [
            {
              key: 'accountExternalId',
              type: 'text',
              label: 'iLink Bot ID',
              required: true
            },
            {
              key: 'token',
              type: 'secret',
              label: 'iLink Bot Token',
              required: true
            },
            {
              key: 'baseUrl',
              type: 'text',
              label: 'Base URL'
            }
          ]
        }
      }
    } as any,
    register: () =>
      ({
        metadata: {
          id: 'wechat',
          displayName: 'WeChat',
          version: '0.1.0'
        },
        getCapabilities: () => ({
          canEditMessage: false,
          canStreamByEdit: false,
          canRenderButtons: false,
          canRenderRichCards: false,
          canReplyInThread: false,
          canUploadImage: false,
          canUploadFile: false,
          canCollectStructuredForm: false
        }),
        validateAccount: async () => undefined,
        connect: async () => undefined,
        disconnect: async () => undefined,
        send: async () => ({ status: 'sent', externalMessageId: 'external-msg-1' }),
        onInbound: () => () => undefined,
        startAccountSetup: async (input: unknown) => {
          startCalls.push(input)
          return {
            sessionId: 'setup-1',
            accountId: 'default',
            methodId: 'wechat_qr_login',
            startedAt: '2026-04-29T00:00:00.000Z',
            expiresAt: '2026-04-29T00:08:00.000Z',
            events: [
              {
                type: 'qr',
                sessionId: 'setup-1',
                qrUrl: 'https://example.test/qr',
                expiresAt: '2026-04-29T00:08:00.000Z'
              },
              {
                type: 'completed',
                sessionId: 'setup-1',
                config: {
                  accountExternalId: 'wx-bot-1',
                  baseUrl: 'https://ilink.example.test'
                },
                secrets: {
                  token: 'wechat-token'
                }
              }
            ]
          }
        }
      }) as any
  })

  const gateway = new EmbeddedGatewayService({
    core,
    resolveAgentProfileId: () => 'default',
    transportHost,
    transportPluginConfigService: configService,
    externalPluginDirectories: []
  })

  ;(gateway as any).onTransportAccountSetupEvent((event: unknown) => {
    setupEvents.push(event)
  })

  const methods = await (gateway as any).listTransportAccountSetupMethods('wechat')
  assert.equal(methods[0]?.id, 'wechat_qr_login')

  const started = await (gateway as any).startTransportAccountSetup({
    pluginId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login'
  })

  assert.equal(started.sessionId, 'setup-1')
  assert.deepEqual(startCalls, [
    {
      accountId: 'default',
      methodId: 'wechat_qr_login',
      initialValues: {}
    }
  ])
  assert.equal(setupEvents.length, 2)
  assert.equal((setupEvents[0] as any).type, 'qr')
  assert.equal((setupEvents[1] as any).type, 'completed')

  const account = await gateway.getTransportAccount('wechat', 'default')
  assert.equal(account?.enabled, true)
  assert.deepEqual(account?.config, {
    accountExternalId: 'wx-bot-1',
    baseUrl: 'https://ilink.example.test'
  })
  assert.deepEqual(account?.hasSecrets, {
    token: true
  })
  assert.equal(account?.validationStatus, 'validated')

  const setupLogEntries = core
    .listEventLog()
    .filter((entry) => entry.eventType === 'transport.account_setup.event')
  assert.deepEqual(
    setupLogEntries.map((entry) => JSON.parse(entry.payloadJson).event.type),
    ['qr', 'completed']
  )
  const completedPayload = JSON.parse(setupLogEntries[1]!.payloadJson)
  assert.equal(completedPayload.event.sessionId, 'setup-1')
  assert.equal(completedPayload.event.secrets, undefined)
  assert.equal(JSON.stringify(completedPayload).includes('wechat-token'), false)
})

test('gateway dispatches one model system followup when chat-linked QR setup completes', async () => {
  const core = createCore()
  const startedRuns: Array<{ id: string; triggerKind: string; traceId: string }> = []
  const resolved = core.resolveConversationForEnvelope({
    agentProfileId: 'default',
    envelope: {
      envelopeId: 'local-thread:qr-followup-thread',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'local-thread:qr-followup-thread',
      externalChatId: 'qr-followup-thread',
      externalUserId: 'desktop-user',
      externalUserDisplayName: 'Desktop',
      channelKind: 'dm',
      receivedAt: '2026-04-29T00:00:00.000Z',
      routingKey: buildLocalThreadRoutingKey('qr-followup-thread')
    },
    workspaceId: '/tmp/piagent-qr-followup',
    title: 'QR Followup',
    desktopVisibilityMode: 'read_write'
  })
  const setupRun = core.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    traceId: 'setup-request'
  })
  core.upsertAgentRun({
    id: setupRun.id,
    conversationId: setupRun.conversationId,
    triggerKind: setupRun.triggerKind,
    requestedExecutionPolicy: setupRun.requestedExecutionPolicy,
    effectiveExecutionSnapshot: setupRun.effectiveExecutionSnapshot,
    status: 'finished',
    traceId: setupRun.traceId,
    projectionText: '',
    projectionTurns: [
      {
        agentTurnId: 'turn-setup',
        index: 0,
        status: 'done',
        startedAt: Date.parse('2026-04-29T00:00:01.000Z'),
        endedAt: Date.parse('2026-04-29T00:00:02.000Z'),
        text: '',
        timelineItems: [],
        toolCallIds: ['call-setup'],
        toolCalls: [
          {
            toolCallId: 'call-setup',
            agentTurnId: 'turn-setup',
            name: 'imTool',
            kind: 'tool',
            invocation: 'direct',
            origin: 'runtime',
            status: 'done',
            args: {
              action: 'setup_account',
              transportId: 'wechat'
            },
            accountSetupQr: {
              transportId: 'wechat',
              accountId: 'default',
              methodId: 'wechat_qr_login',
              sessionId: 'setup-followup-1',
              imageUrl: 'https://example.test/qr',
              expiresAt: '2026-04-29T00:08:00.000Z',
              status: 'active'
            },
            startedAt: Date.parse('2026-04-29T00:00:01.000Z'),
            endedAt: Date.parse('2026-04-29T00:00:02.000Z')
          }
        ]
      }
    ],
    startedAt: setupRun.startedAt,
    endedAt: '2026-04-29T00:00:02.000Z'
  })

  const gateway = new EmbeddedGatewayService({
    core,
    resolveAgentProfileId: () => 'default',
    transportPluginConfigService: createTransportConfigService(),
    externalPluginDirectories: [],
    runExecutor: {
      start: async (run) => {
        startedRuns.push({
          id: run.id,
          triggerKind: run.triggerKind,
          traceId: run.traceId
        })
      }
    }
  })

  await (gateway as any).emitTransportAccountSetupEvent({
    type: 'completed',
    pluginId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login',
    sessionId: 'setup-followup-1',
    config: {},
    secrets: {}
  })
  await (gateway as any).emitTransportAccountSetupEvent({
    type: 'completed',
    pluginId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login',
    sessionId: 'setup-followup-1',
    config: {},
    secrets: {}
  })

  assert.equal(startedRuns.length, 1)
  assert.equal(startedRuns[0]?.triggerKind, 'system_followup')
  assert.equal(
    startedRuns[0]?.traceId,
    'transport-account-setup:setup-followup-1:completed:system-event'
  )
  const systemMessage = core
    .getConversationMessages(resolved.conversation.id)
    .find((message) => message.externalMessageId === startedRuns[0]?.traceId)
  assert.equal(systemMessage?.role, 'system')
  assert.equal(systemMessage?.direction, 'internal')
  assert.match(systemMessage?.text ?? '', /System event/)
  assert.match(systemMessage?.text ?? '', /completed/)
  assert.match(systemMessage?.text ?? '', /Do not ask the user to scan again/)

  const expiredRun = core.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    traceId: 'setup-request-expired'
  })
  core.upsertAgentRun({
    id: expiredRun.id,
    conversationId: expiredRun.conversationId,
    triggerKind: expiredRun.triggerKind,
    requestedExecutionPolicy: expiredRun.requestedExecutionPolicy,
    effectiveExecutionSnapshot: expiredRun.effectiveExecutionSnapshot,
    status: 'finished',
    traceId: expiredRun.traceId,
    projectionText: '',
    projectionTurns: [
      {
        agentTurnId: 'turn-expired',
        index: 0,
        status: 'done',
        startedAt: Date.parse('2026-04-29T00:10:01.000Z'),
        endedAt: Date.parse('2026-04-29T00:10:02.000Z'),
        text: '',
        timelineItems: [],
        toolCallIds: ['call-expired'],
        toolCalls: [
          {
            toolCallId: 'call-expired',
            agentTurnId: 'turn-expired',
            name: 'imTool',
            kind: 'tool',
            invocation: 'direct',
            origin: 'runtime',
            status: 'done',
            args: {
              action: 'setup_account',
              transportId: 'wechat'
            },
            accountSetupQr: {
              transportId: 'wechat',
              accountId: 'default',
              methodId: 'wechat_qr_login',
              sessionId: 'setup-followup-expired',
              imageUrl: 'https://example.test/qr-expired',
              expiresAt: '2026-04-29T00:18:00.000Z',
              status: 'active'
            },
            startedAt: Date.parse('2026-04-29T00:10:01.000Z'),
            endedAt: Date.parse('2026-04-29T00:10:02.000Z')
          }
        ]
      }
    ],
    startedAt: expiredRun.startedAt,
    endedAt: '2026-04-29T00:10:02.000Z'
  })

  await new Promise((resolve) => setImmediate(resolve))
  await (gateway as any).emitTransportAccountSetupEvent({
    type: 'expired',
    pluginId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login',
    sessionId: 'setup-followup-expired',
    reason: 'timeout'
  })

  const expiredTraceId = 'transport-account-setup:setup-followup-expired:expired:system-event'
  const expiredMessage = core
    .getConversationMessages(resolved.conversation.id)
    .find((message) => message.externalMessageId === expiredTraceId)
  assert.equal(expiredMessage?.role, 'system')
  assert.match(expiredMessage?.text ?? '', /expired/)
  assert.match(expiredMessage?.text ?? '', /Ask whether they want to generate a new QR code/)
  assert.match(expiredMessage?.text ?? '', /call imTool setup_account again/)
})

test('gateway exposes unified IM transport operations for accounts, targets, and direct sends', async () => {
  const core = createCore()
  const db = new Database(':memory:')
  const configService = new TransportPluginConfigService(db)
  const transportHost = new TransportHost()
  const connectCalls: string[] = []
  const disconnectCalls: string[] = []
  const targetQueries: string[] = []
  const sendCalls: Array<{
    transportId: string
    transportAccountId: string
    externalChatId: string
    payload: unknown
  }> = []

  transportHost.discoverBuiltin({
    manifest: {
      id: 'feishu',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Feishu',
      contributes: {
        settings: {
          scope: 'transport_account',
          supportsMultipleAccounts: false,
          fields: [
            {
              key: 'appId',
              type: 'text',
              label: 'App ID',
              required: true
            },
            {
              key: 'appSecret',
              type: 'secret',
              label: 'App Secret',
              required: true
            }
          ]
        }
      }
    },
    register: () => ({
      metadata: {
        id: 'feishu',
        displayName: 'Feishu',
        version: '0.1.0'
      },
      getCapabilities: () => ({
        canEditMessage: false,
        canStreamByEdit: false,
        canRenderButtons: false,
        canRenderRichCards: false,
        canReplyInThread: true,
        canUploadImage: false,
        canUploadFile: false,
        canCollectStructuredForm: false
      }),
      listTargets: async ({ accountId, query }) => {
        targetQueries.push(`${accountId}:${query ?? ''}`)
        return [
          {
            transportId: 'feishu',
            transportAccountId: accountId,
            externalChatId: 'chat-ops',
            externalUserId: 'group-ops',
            channelKind: 'group',
            externalUserDisplayName: 'Ops Group',
            title: 'Ops Group',
            description: 'Operations room',
            source: 'plugin',
            targetKind: 'group'
          }
        ]
      },
      connect: async (accountId: string) => {
        connectCalls.push(accountId)
      },
      disconnect: async (accountId: string) => {
        disconnectCalls.push(accountId)
      },
      send: async (command) => {
        sendCalls.push({
          transportId: command.transportId,
          transportAccountId: command.transportAccountId,
          externalChatId: command.externalChatId,
          payload: command.payload
        })
        return { status: 'sent', externalMessageId: 'external-msg-im-1' }
      },
      onInbound: () => () => undefined
    })
  })

  const gateway = new EmbeddedGatewayService({
    core,
    resolveAgentProfileId: () => 'default',
    transportHost,
    transportPluginConfigService: configService,
    externalPluginDirectories: []
  })

  await gateway.saveTransportAccount({
    pluginId: 'feishu',
    accountId: 'default',
    config: {
      appId: 'cli_xxx'
    },
    secrets: {
      appSecret: 'secret-xxx'
    }
  })

  const connected = await gateway.connectTransportAccount({
    transportId: 'feishu',
    accountId: 'default'
  })
  assert.equal(connected.enabled, true)
  assert.equal(connected.validationStatus, 'validated')
  assert.deepEqual(connectCalls, ['default'])

  const transports = await gateway.listImTransports()
  assert.equal(transports.length, 1)
  assert.equal(transports[0]?.transportId, 'feishu')
  assert.equal(transports[0]?.accounts[0]?.accountId, 'default')
  assert.equal(transports[0]?.accounts[0]?.runtimeState, 'connected')
  assert.equal(transports[0]?.accounts[0]?.capabilities?.canReplyInThread, true)

  const targetsBeforeSend = await gateway.listImTargets({
    transportId: 'feishu',
    accountId: 'default'
  })
  assert.equal(targetsBeforeSend.length, 1)
  assert.equal(targetsBeforeSend[0]?.source, 'plugin')
  assert.equal(targetsBeforeSend[0]?.title, 'Ops Group')

  const sent = await gateway.sendImMessage({
    transportId: 'feishu',
    accountId: 'default',
    externalChatId: 'chat-ops',
    channelKind: 'group',
    text: 'hello im',
    title: 'Ops Group'
  })
  assert.equal(sent.dispatch.status, 'sent')
  assert.equal(sent.binding.transportId, 'feishu')
  assert.equal(sent.binding.transportAccountId, 'default')
  assert.equal(sent.binding.externalChatId, 'chat-ops')
  assert.deepEqual(sendCalls, [
    {
      transportId: 'feishu',
      transportAccountId: 'default',
      externalChatId: 'chat-ops',
      payload: { text: 'hello im' }
    }
  ])

  const routedTargets = await gateway.listImTargets({
    transportId: 'feishu',
    accountId: 'default'
  })
  const routed = routedTargets.find((item) => item.routingKey === sent.binding.routingKey)
  assert.equal(routed?.source, 'binding')
  assert.equal(routed?.bindingId, sent.binding.id)
  assert.equal(routed?.conversationId, sent.conversation.id)
  assert.deepEqual(targetQueries, ['default:', 'default:'])

  const disconnected = await gateway.disconnectTransportAccount({
    transportId: 'feishu',
    accountId: 'default'
  })
  assert.equal(disconnected.enabled, false)
  assert.deepEqual(disconnectCalls, ['default'])
})

test('gateway sends direct IM messages with externalUserId when no chat id is available', async () => {
  const core = createCore()
  const transportHost = new TransportHost()
  const sendCalls: Array<{
    externalChatId: string
    externalUserId: string | null
    channelKind: string | null
    payload: unknown
  }> = []

  transportHost.discoverBuiltin({
    manifest: {
      id: 'feishu',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Feishu'
    },
    register: () => ({
      metadata: {
        id: 'feishu',
        displayName: 'Feishu',
        version: '0.1.0'
      },
      getCapabilities: () => ({
        canEditMessage: false,
        canStreamByEdit: false,
        canRenderButtons: false,
        canRenderRichCards: false,
        canReplyInThread: true,
        canUploadImage: false,
        canUploadFile: false,
        canCollectStructuredForm: false
      }),
      connect: async () => undefined,
      disconnect: async () => undefined,
      send: async (command) => {
        sendCalls.push({
          externalChatId: command.externalChatId,
          externalUserId: command.externalUserId ?? null,
          channelKind: command.channelKind ?? null,
          payload: command.payload
        })
        return { status: 'sent', externalMessageId: 'external-msg-dm-1' }
      },
      onInbound: () => () => undefined
    })
  })

  const gateway = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    transportHost,
    externalPluginDirectories: []
  })

  const sent = await gateway.sendImMessage({
    transportId: 'feishu',
    accountId: 'default',
    externalUserId: 'ou_alice',
    channelKind: 'dm',
    text: 'hello alice',
    title: 'Alice'
  })

  assert.equal(sent.dispatch.status, 'sent')
  assert.equal(sent.binding.externalChatId, 'ou_alice')
  assert.equal(sent.binding.externalUserId, 'ou_alice')
  assert.deepEqual(sendCalls, [
    {
      externalChatId: 'ou_alice',
      externalUserId: 'ou_alice',
      channelKind: 'dm',
      payload: { text: 'hello alice' }
    }
  ])
})

test('gateway surfaces plugin target lookup errors for explicit IM target searches', async () => {
  const core = createCore()
  const transportHost = new TransportHost()

  transportHost.discoverBuiltin({
    manifest: {
      id: 'feishu',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Feishu'
    },
    register: () => ({
      metadata: {
        id: 'feishu',
        displayName: 'Feishu',
        version: '0.1.0'
      },
      getCapabilities: () => ({
        canEditMessage: false,
        canStreamByEdit: false,
        canRenderButtons: false,
        canRenderRichCards: false,
        canReplyInThread: true,
        canUploadImage: false,
        canUploadFile: false,
        canCollectStructuredForm: false
      }),
      listTargets: async () => {
        throw new Error('Feishu contact.list failed (99991663): no contact scope')
      },
      connect: async () => undefined,
      disconnect: async () => undefined,
      send: async () => ({ status: 'sent', externalMessageId: 'external-msg-1' }),
      onInbound: () => () => undefined
    })
  })

  const gateway = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    transportHost,
    externalPluginDirectories: []
  })

  await assert.rejects(
    () =>
      gateway.listImTargets({
        transportId: 'feishu',
        accountId: 'default',
        query: 'alice',
        channelKind: 'dm'
      }),
    /Feishu contact\.list failed/
  )
})

test('gateway can attach and switch active IM routes for an existing conversation', async () => {
  const core = createCore()
  const transportHost = new TransportHost()

  transportHost.discoverBuiltin({
    manifest: {
      id: 'slack',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Slack'
    },
    register: () => ({
      metadata: {
        id: 'slack',
        displayName: 'Slack',
        version: '0.1.0'
      },
      getCapabilities: () => ({
        canEditMessage: false,
        canStreamByEdit: false,
        canRenderButtons: false,
        canRenderRichCards: false,
        canReplyInThread: true,
        canUploadImage: false,
        canUploadFile: false,
        canCollectStructuredForm: false
      }),
      connect: async () => undefined,
      disconnect: async () => undefined,
      send: async () => ({ status: 'sent', externalMessageId: 'external-msg-2' }),
      onInbound: () => () => undefined
    })
  })

  const gateway = new EmbeddedGatewayService({
    core,
    transportPluginConfigService: createTransportConfigService(),
    resolveAgentProfileId: () => 'default',
    transportHost,
    externalPluginDirectories: []
  })

  const base = gateway.ingestInbound({
    envelopeId: 'env-route-1',
    transportId: 'wecom',
    transportAccountId: 'corp-a',
    externalMessageId: 'msg-route-1',
    externalChatId: 'chat-route-a',
    externalUserId: 'user-route-a',
    externalUserDisplayName: 'Route User',
    channelKind: 'dm',
    receivedAt: '2026-04-20T08:00:00.000Z',
    text: 'route seed'
  })
  assertScheduledGatewayResult(base)

  const attached = await gateway.attachImRoute({
    conversationId: base.conversationId,
    transportId: 'slack',
    accountId: 'workspace-bot',
    externalChatId: 'slack-chat-a',
    externalUserId: 'slack-user-a',
    channelKind: 'dm',
    setAsActiveRoute: true
  })
  assert.equal(attached.createdConversation, false)
  assert.equal(attached.createdBinding, true)
  assert.equal(attached.conversation.id, base.conversationId)
  assert.equal(attached.binding.transportId, 'slack')

  const bindings = core.listConversationBindings({
    conversationId: base.conversationId
  })
  assert.equal(bindings.length, 2)
  assert.equal(core.getConversation(base.conversationId)?.activeBindingId, attached.binding.id)

  const updated = gateway.setActiveConversationRoute(base.conversationId, base.binding.id)
  assert.equal(updated.activeBindingId, base.binding.id)
})
