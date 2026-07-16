import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

const { InMemoryCoreService } = await import('../../../src/main/core-v2/in-memory-core-service.ts')
const { buildLocalThreadRoutingKey } = await import(
  '../../../src/main/core-v2/local-thread-binding.ts'
)
const { listLocalThreadRowsFromService } = await import(
  '../../../src/main/core-v2/local-thread-query.ts'
)

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

const createLocalThreadConversation = (core: InstanceType<typeof InMemoryCoreService>, id: string) =>
  core.resolveConversationForTarget({
    agentProfileId: 'default',
    workspaceId: `/tmp/${id}`,
    title: id,
    target: {
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalChatId: id,
      channelKind: 'dm'
    }
  })

const upsertLocalThreadMessage = (
  core: InstanceType<typeof InMemoryCoreService>,
  input: {
    conversationId: string
    bindingId: string
    externalMessageId: string
    role: 'user' | 'assistant'
    text: string
    messageKind?: 'chat' | 'automation'
    includeInAgentContext?: boolean
    agentRunId?: string | null
  }
) =>
  core.upsertConversationMessage({
    conversationId: input.conversationId,
    bindingId: input.bindingId,
    externalMessageId: input.externalMessageId,
    role: input.role,
    direction: input.role === 'assistant' ? 'outbound' : 'internal',
    text: input.text,
    payload: {
      localThread: {
        version: 1,
        messageKind: input.messageKind ?? 'chat',
        includeInAgentContext: input.includeInAgentContext ?? true,
        agentRunId: input.agentRunId ?? null,
        agentEntryId: null,
        agentTurnId: null,
        toolCallId: null,
        stepIndex: null,
        runtimeSequence: null,
        content: {
          version: 1,
          blocks: [{ type: 'text', text: input.text }]
        }
      }
    }
  })

test('listLocalThreadRowsFromService hides automation-only scheduled task threads', () => {
  const core = createCore()

  const automationThreadId = 'thread-automation'
  const automation = createLocalThreadConversation(core, automationThreadId)
  assert.equal(
    core.getConversationByBindingRoutingKey(buildLocalThreadRoutingKey(automationThreadId))
      ?.conversation.id,
    automation.conversation.id
  )
  const run = core.requestRun({
    conversationId: automation.conversation.id,
    triggerKind: 'automation',
    traceId: 'scheduled-task:task-1:run:run-1'
  })
  upsertLocalThreadMessage(core, {
    conversationId: automation.conversation.id,
    bindingId: automation.binding.id,
    externalMessageId: 'automation-prompt',
    role: 'user',
    text: 'automation prompt',
    messageKind: 'automation',
    includeInAgentContext: false
  })
  upsertLocalThreadMessage(core, {
    conversationId: automation.conversation.id,
    bindingId: automation.binding.id,
    externalMessageId: 'automation-result',
    role: 'assistant',
    text: 'automation result',
    agentRunId: run.id,
    includeInAgentContext: false
  })

  const normalThreadId = 'thread-normal'
  const normal = createLocalThreadConversation(core, normalThreadId)
  upsertLocalThreadMessage(core, {
    conversationId: normal.conversation.id,
    bindingId: normal.binding.id,
    externalMessageId: 'normal-user',
    role: 'user',
    text: 'hello'
  })

  const rows = listLocalThreadRowsFromService(core)

  assert.equal(rows.some((row) => row.id === automationThreadId), false)
  assert.equal(rows.some((row) => row.id === normalThreadId), true)
})

test('listLocalThreadRowsFromService hides legacy automation prompts stored as chat messages', () => {
  const core = createCore()

  const automationThreadId = 'thread-legacy-automation'
  const automation = createLocalThreadConversation(core, automationThreadId)
  const run = core.requestRun({
    conversationId: automation.conversation.id,
    triggerKind: 'automation',
    traceId: 'scheduled-task:task-legacy:run:run-legacy'
  })
  upsertLocalThreadMessage(core, {
    conversationId: automation.conversation.id,
    bindingId: automation.binding.id,
    externalMessageId: 'legacy-automation-prompt',
    role: 'user',
    text: '[SYSTEM: You are running as a scheduled automation task. The system manages run history and delivery.]',
    messageKind: 'chat',
    includeInAgentContext: true
  })
  upsertLocalThreadMessage(core, {
    conversationId: automation.conversation.id,
    bindingId: automation.binding.id,
    externalMessageId: 'legacy-automation-result',
    role: 'assistant',
    text: 'automation result',
    agentRunId: run.id,
    includeInAgentContext: false
  })

  const rows = listLocalThreadRowsFromService(core)

  assert.equal(rows.some((row) => row.id === automationThreadId), false)
})
