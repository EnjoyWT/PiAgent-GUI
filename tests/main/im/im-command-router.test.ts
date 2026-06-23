import test from 'node:test'
import assert from 'node:assert/strict'
import { ImCommandRouter, parseImCommand } from '../../../src/main/im/im-command-router.ts'

test('parseImCommand strips Telegram bot suffixes from group menu commands', () => {
  const parsed = parseImCommand('/status@piagent_bot now')

  assert.equal(parsed?.kind, 'known')
  assert.equal(parsed?.command, 'status')
  assert.deepEqual(parsed?.args, ['now'])
})

test('parseImCommand recognizes help for Telegram command menus', () => {
  const parsed = parseImCommand('/help')

  assert.equal(parsed?.kind, 'known')
  assert.equal(parsed?.command, 'help')
})

test('parseImCommand recognizes model settings commands', () => {
  const parsed = parseImCommand('/model google::gemini-2.5-flash')

  assert.equal(parsed?.kind, 'known')
  assert.equal(parsed?.command, 'model')
  assert.deepEqual(parsed?.args, ['google::gemini-2.5-flash'])
})

test('parseImCommand recognizes available model list commands', () => {
  const parsed = parseImCommand('/models')

  assert.equal(parsed?.kind, 'known')
  assert.equal(parsed?.command, 'models')
})

const createRouterHarness = (
  input: {
    conversationOverride?: Record<string, unknown>
    schedulerResetResult?: Record<string, unknown>
    modelCatalog?: Record<string, unknown>
  } = {}
) => {
  const deliveries: any[] = []
  const updates: any[] = []
  const prunes: any[] = []
  const schedulerResets: string[] = []
  const conversation = {
    id: 'conversation-a',
    agentProfileId: 'default',
    status: 'active',
    executionOverride: null,
    desktopVisibilityMode: 'readonly',
    createdAt: '2026-04-28T06:00:00.000Z',
    updatedAt: '2026-04-28T06:00:00.000Z',
    ...input.conversationOverride
  } as any
  const binding = {
    id: 'binding-a',
    conversationId: conversation.id,
    routingKey: 'im:telegram:default:dm:42',
    sessionScope: 'dm',
    personId: 'im-person:telegram:default:42'
  } as any
  const core = {
    requestDelivery: (delivery: any) => {
      deliveries.push(delivery)
      return {
        id: `delivery-${deliveries.length}`,
        conversationId: conversation.id,
        bindingId: binding.id,
        payloadJson: JSON.stringify(delivery.payload),
        status: 'requested'
      }
    },
    listPendingInteractions: () => [],
    getDeliveryRecords: () => [],
    getAgentProfile: () => ({
      id: 'default',
      defaultExecutionPolicy: {
        model: {
          providerId: 'openai',
          modelId: 'gpt-5.4',
          reasoningLevel: 'medium'
        },
        contextEngineId: 'summary',
        memoryProviderId: 'local-facts'
      }
    }),
    updateConversation: (update: any) => {
      updates.push(update)
      conversation.executionOverride = update.executionOverride
      return conversation
    },
    pruneConversationRuntimeAfter: (prune: any) => {
      prunes.push(prune)
    }
  }
  const scheduler = {
    listQueuedRuns: () => [],
    stopConversation: () => ({ stoppedActiveRun: false, queueLength: 0 }),
    resetConversation: (conversationId: string) => {
      schedulerResets.push(conversationId)
      return input.schedulerResetResult ?? { stoppedActiveRun: false, clearedQueueLength: 0 }
    }
  }
  const router = new ImCommandRouter({
    core: core as any,
    runScheduler: scheduler as any,
    doctorPlane: {
      getTrace: () => ({ steps: [] }),
      recordStep: () => undefined
    } as any,
    modelCatalog: input.modelCatalog as any
  })
  const run = (text: string) =>
    router.tryHandle({
      imTraceId: 'im:telegram:default:message-a',
      envelope: {
        envelopeId: 'envelope-a',
        externalMessageId: 'message-a',
        text
      } as any,
      conversation,
      binding
    })

  return { run, deliveries, updates, prunes, schedulerResets, conversation }
}

test('IM command router reports and updates the current conversation model', () => {
  const harness = createRouterHarness()

  harness.run('/model')
  assert.match(harness.deliveries.at(-1)?.payload.text, /Current model: openai::gpt-5.4/)

  harness.run('/model google::gemini-2.5-flash')
  assert.deepEqual(harness.updates.at(-1)?.executionOverride, {
    model: {
      providerId: 'google',
      modelId: 'gemini-2.5-flash'
    }
  })
  assert.match(harness.deliveries.at(-1)?.payload.text, /Model updated: google::gemini-2.5-flash/)

  harness.run('/model')
  assert.match(harness.deliveries.at(-1)?.payload.text, /Current model: google::gemini-2.5-flash/)
})

test('IM command router lists enabled models with copyable switch commands', () => {
  const harness = createRouterHarness({
    modelCatalog: {
      listProviders: () => [
        { id: 'openai', displayName: 'OpenAI', enabled: true },
        { id: 'google', displayName: 'Google', enabled: true },
        { id: 'disabled', displayName: 'Disabled', enabled: false }
      ],
      listProviderModels: (providerId: string) =>
        ({
          openai: [
            { providerId: 'openai', modelId: 'gpt-5.4', label: 'GPT 5.4', enabled: true },
            { providerId: 'openai', modelId: 'gpt-old', label: 'Old', enabled: false }
          ],
          google: [
            {
              providerId: 'google',
              modelId: 'gemini-2.5-flash',
              label: 'Gemini 2.5 Flash',
              enabled: true
            }
          ],
          disabled: [
            { providerId: 'disabled', modelId: 'hidden-model', label: 'Hidden', enabled: true }
          ]
        })[providerId] ?? []
    }
  })

  harness.run('/models')

  const text = harness.deliveries.at(-1)?.payload.text
  assert.match(text, /Current model: openai::gpt-5.4/)
  assert.match(text, /Available models/)
  assert.match(text, /\/model openai::gpt-5.4/)
  assert.match(text, /\/model google::gemini-2.5-flash/)
  assert.doesNotMatch(text, /gpt-old/)
  assert.doesNotMatch(text, /hidden-model/)
})

test('IM command router accepts all supported reasoning levels in model commands', () => {
  const harness = createRouterHarness()

  harness.run('/model openai::gpt-5.5 xhigh')

  assert.deepEqual(harness.updates.at(-1)?.executionOverride, {
    model: {
      providerId: 'openai',
      modelId: 'gpt-5.5',
      reasoningLevel: 'xhigh'
    }
  })
})

test('IM command router resets a model override without dropping other overrides', () => {
  const harness = createRouterHarness({
    conversationOverride: {
      executionOverride: {
        model: { providerId: 'google', modelId: 'gemini-2.5-flash' },
        toolProfileId: 'tools-a'
      }
    }
  })

  harness.run('/model default')

  assert.deepEqual(harness.updates.at(-1)?.executionOverride, {
    toolProfileId: 'tools-a'
  })
  assert.match(harness.deliveries.at(-1)?.payload.text, /Model override cleared/)
})

test('IM command router resets current session runtime state', () => {
  const harness = createRouterHarness({
    schedulerResetResult: { stoppedActiveRun: true, clearedQueueLength: 2 }
  })

  harness.run('/reset')

  assert.deepEqual(harness.schedulerResets, ['conversation-a'])
  assert.equal(harness.prunes.at(-1)?.conversationId, 'conversation-a')
  assert.match(harness.deliveries.at(-1)?.payload.text, /Session reset/)
  assert.match(harness.deliveries.at(-1)?.payload.text, /Cleared queued runs: 2/)
})

test('IM command router explains why new IM sessions cannot be created yet', () => {
  const harness = createRouterHarness()

  harness.run('/newsession')

  assert.equal(harness.updates.length, 0)
  assert.equal(harness.prunes.length, 0)
  assert.match(harness.deliveries.at(-1)?.payload.text, /not supported yet/i)
  assert.match(harness.deliveries.at(-1)?.payload.text, /routing key/i)
})
