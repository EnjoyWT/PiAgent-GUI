import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryCoreService } from '../../../src/main/core-v2/in-memory-core-service.ts'
import { RuntimeUserInteractionController } from '../../../src/main/runtime-host/user-interaction-controller.ts'
import { createProviderConfigTool } from '../../../src/main/tools/provider-config-tool.ts'
import type { PendingQuestionEvent } from '../../../src/shared/question-tool.ts'
import type { PendingQuestionnaireEvent } from '../../../src/shared/questionnaire-tool.ts'
import {
  SECRET_ANSWER_API_PATH,
  type PendingSecretPromptEvent
} from '../../../src/shared/secret-input.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const createService = () => {
  const service = new InMemoryCoreService()
  const profile = service.upsertAgentProfile({
    id: 'default',
    slug: 'default',
    displayName: 'Default',
    isDefault: true,
    enabledTransportIds: ['desktop-chat'],
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
  const resolved = service.resolveConversationForEnvelope({
    agentProfileId: profile.id,
    envelope: {
      envelopeId: 'env-local',
      transportId: 'desktop-chat',
      transportAccountId: 'desktop',
      externalMessageId: 'msg-local',
      externalChatId: 'thread-local',
      channelKind: 'dm',
      receivedAt: new Date('2026-04-20T12:00:00.000Z').toISOString(),
      text: 'hello'
    },
    desktopVisibilityMode: 'read_write'
  })
  const run = service.requestRun({
    conversationId: resolved.conversation.id,
    triggerKind: 'user_message',
    traceId: 'msg-local'
  })
  return { service, resolved, run }
}

test('question tool waits for gateway answer and clears interaction checkpoint', async () => {
  const { service, resolved, run } = createService()
  const questionEvents: PendingQuestionEvent[] = []
  const controller = new RuntimeUserInteractionController({
    core: service,
    emitQuestionEvent: (event) => questionEvents.push(event)
  })
  const questionTool = controller
    .createTools({
      conversationId: resolved.conversation.id,
      interactionThreadId: 'thread-local',
      getActiveRunId: () => run.id
    })
    .find((tool) => tool.name === 'questionTool')
  assert.ok(questionTool)

  const execution = (questionTool as any).execute('tool-question', {
    questionId: 'q1',
    prompt: 'Pick one',
    mode: 'selection_or_text',
    options: [{ id: 'a', label: 'Alpha', value: 'alpha' }]
  })
  await tick()

  assert.equal(questionEvents[0]?.type, 'set')
  const pending = service.listPendingInteractions(resolved.conversation.id)
  assert.equal(pending.length, 1)
  assert.equal(pending[0]?.kind, 'option_select')

  const answer = await controller.answerQuestion('thread-local', {
    questionId: 'q1',
    inputKind: 'option',
    optionId: 'a'
  })
  const result = await execution

  assert.equal(answer.success, true)
  assert.equal(result.details.status, 'answered')
  assert.equal(result.details.rawInput, 'alpha')
  assert.equal(questionEvents.at(-1)?.type, 'clear')
  assert.equal(service.listPendingInteractions(resolved.conversation.id).length, 0)
})

test('questionnaire tool advances steps through gateway answers', async () => {
  const { service, resolved, run } = createService()
  const questionnaireEvents: PendingQuestionnaireEvent[] = []
  const controller = new RuntimeUserInteractionController({
    core: service,
    emitQuestionnaireEvent: (event) => questionnaireEvents.push(event)
  })
  const questionnaireTool = controller
    .createTools({
      conversationId: resolved.conversation.id,
      interactionThreadId: 'thread-local',
      getActiveRunId: () => run.id
    })
    .find((tool) => tool.name === 'questionnaireTool')
  assert.ok(questionnaireTool)

  const execution = (questionnaireTool as any).execute('tool-form', {
    questionnaireId: 'form-1',
    questions: [
      {
        questionId: 'q1',
        prompt: 'Pick one',
        mode: 'selection_or_text',
        options: [{ id: 'a', label: 'Alpha', value: 'alpha' }]
      },
      {
        questionId: 'q2',
        prompt: 'Write detail',
        mode: 'selection_or_text'
      }
    ]
  })
  await tick()

  assert.equal(questionnaireEvents[0]?.type, 'set')
  assert.equal(service.listPendingInteractions(resolved.conversation.id).length, 1)

  await controller.answerQuestionnaire('thread-local', {
    questionnaireId: 'form-1',
    stepIndex: 0,
    questionId: 'q1',
    inputKind: 'option',
    optionId: 'a'
  })
  await tick()

  const secondStep = questionnaireEvents
    .filter(
      (event): event is Extract<PendingQuestionnaireEvent, { type: 'set' }> => event.type === 'set'
    )
    .at(-1)
  assert.equal(secondStep?.pending.currentStepIndex, 1)

  await controller.answerQuestionnaire('thread-local', {
    questionnaireId: 'form-1',
    stepIndex: 1,
    questionId: 'q2',
    inputKind: 'text',
    rawInput: 'detail'
  })
  const result = await execution

  assert.equal(result.details.status, 'completed')
  assert.equal(result.details.answers.length, 2)
  assert.equal(questionnaireEvents.at(-1)?.type, 'clear')
  assert.equal(service.listPendingInteractions(resolved.conversation.id).length, 0)
})

test('requestFormInput reuses framework questionnaire flow for structured non-secret fields', async () => {
  const { service, resolved, run } = createService()
  const controller = new RuntimeUserInteractionController({
    core: service
  })

  const execution = controller.requestFormInput(
    {
      conversationId: resolved.conversation.id,
      interactionThreadId: 'thread-local',
      getActiveRunId: () => run.id
    },
    {
      formId: 'transport-config',
      title: 'Transport Config',
      fields: [
        {
          key: 'appId',
          label: 'App ID',
          type: 'text',
          required: true
        },
        {
          key: 'enabled',
          label: 'Enabled',
          type: 'boolean',
          required: true
        }
      ]
    }
  )
  await tick()

  await controller.answerQuestionnaire('thread-local', {
    questionnaireId: 'form:transport-config',
    stepIndex: 0,
    questionId: 'appId',
    inputKind: 'text',
    rawInput: 'cli_xxx'
  })
  await tick()

  await controller.answerQuestionnaire('thread-local', {
    questionnaireId: 'form:transport-config',
    stepIndex: 1,
    questionId: 'enabled',
    inputKind: 'option',
    optionId: 'true'
  })

  const result = await execution
  assert.equal(result.status, 'completed')
  assert.deepEqual(result.values, {
    appId: 'cli_xxx',
    enabled: true
  })
})

test('base interaction tools include secret request tool', () => {
  const { service, resolved, run } = createService()
  const controller = new RuntimeUserInteractionController({
    core: service
  })

  const tools = controller.createTools({
    conversationId: resolved.conversation.id,
    interactionThreadId: 'thread-local',
    getActiveRunId: () => run.id
  })

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['questionTool', 'questionnaireTool', 'secretRequestTool']
  )
})

test('secret request tool description forbids normal chat secrets', () => {
  const { service, resolved, run } = createService()
  const controller = new RuntimeUserInteractionController({
    core: service
  })

  const secretTool = controller
    .createTools({
      conversationId: resolved.conversation.id,
      interactionThreadId: 'thread-local',
      getActiveRunId: () => run.id
    })
    .find((tool) => tool.name === 'secretRequestTool')
  assert.ok(secretTool)
  assert.match(secretTool.description, /MANDATORY: never ask the user to paste, type, send/)
  assert.match(secretTool.description, /providerConfigTool` action `setup_api_key/)
})

test('questionnaire tool description defers account setup to domain tools', () => {
  const { service, resolved, run } = createService()
  const controller = new RuntimeUserInteractionController({
    core: service
  })

  const questionnaireTool = controller
    .createTools({
      conversationId: resolved.conversation.id,
      interactionThreadId: 'thread-local',
      getActiveRunId: () => run.id
    })
    .find((tool) => tool.name === 'questionnaireTool')
  assert.ok(questionnaireTool)
  assert.match(
    questionnaireTool.description,
    /Do not use this tool for IM or transport account setup/
  )
  assert.match(questionnaireTool.description, /imTool` action `setup_account/)
})

test('secret request tool masks input and omits secret from result', async () => {
  const { service, resolved, run } = createService()
  const secretEvents: PendingSecretPromptEvent[] = []
  const controller = new RuntimeUserInteractionController({
    core: service,
    emitSecretEvent: (event) => secretEvents.push(event)
  })
  const secretTool = controller
    .createTools({
      conversationId: resolved.conversation.id,
      interactionThreadId: 'thread-local',
      getActiveRunId: () => run.id
    })
    .find((tool) => tool.name === 'secretRequestTool')
  assert.ok(secretTool)

  const execution = (secretTool as any).execute('tool-secret', {
    secretId: 'api-key:test',
    title: 'API Key',
    prompt: 'Enter API key',
    placeholder: 'sk-...'
  })
  await tick()

  assert.equal(secretEvents[0]?.type, 'set')
  if (secretEvents[0]?.type === 'set') {
    assert.equal(secretEvents[0].pending.secret.apiPath, SECRET_ANSWER_API_PATH)
  }
  const pending = service.listPendingInteractions(resolved.conversation.id)
  assert.equal(pending.length, 1)
  assert.equal(pending[0]?.kind, 'text_input')

  const answer = await controller.answerSecret('thread-local', {
    secretId: 'api-key:test',
    value: 'super-secret-value'
  })
  const result = await execution

  assert.equal(answer.success, true)
  assert.deepEqual(result.details, {
    action: 'request_secret',
    status: 'answered',
    secretId: 'api-key:test',
    received: true,
    apiPath: SECRET_ANSWER_API_PATH
  })
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value/)
  assert.equal(secretEvents.at(-1)?.type, 'clear')
  assert.equal(service.listPendingInteractions(resolved.conversation.id).length, 0)
})

test('provider config tool setup_api_key validates and saves without leaking secret', async () => {
  const { service, resolved, run } = createService()
  const secretEvents: PendingSecretPromptEvent[] = []
  const controller = new RuntimeUserInteractionController({
    core: service,
    emitSecretEvent: (event) => secretEvents.push(event)
  })
  let capturedApiKey = ''
  const providerConfigService = {
    getProviderDetail: async (providerId: string) => ({
      id: providerId,
      displayName: 'Test Provider',
      runtimeProvider: 'openai',
      enabled: true,
      baseUrl: null,
      settings: {},
      hasApiKey: false,
      modelCount: 0,
      apiKey: null,
      models: []
    }),
    setupApiKey: async (input: { providerId: string; apiKey: string }) => {
      capturedApiKey = input.apiKey
      return {
        providerId: input.providerId,
        saved: true,
        validation: {
          ok: true,
          providerId: input.providerId,
          modelId: 'model-a',
          message: `连接成功 ${input.apiKey}`,
          ms: 12,
          checkedAt: new Date('2026-04-20T12:00:00.000Z').toISOString(),
          discoveredModelCount: 1
        },
        models: [],
        modelCount: 1
      }
    }
  } as any
  const providerConfigTool = createProviderConfigTool({
    interactionController: controller,
    context: {
      conversationId: resolved.conversation.id,
      interactionThreadId: 'thread-local',
      getActiveRunId: () => run.id,
      interactionController: controller
    },
    providerConfigService
  })

  const execution = (providerConfigTool as any).execute('tool-provider-secret', {
    action: 'setup_api_key',
    providerId: 'openai',
    modelId: 'model-a'
  })
  await tick()

  assert.equal(secretEvents[0]?.type, 'set')
  if (secretEvents[0]?.type === 'set') {
    assert.equal(secretEvents[0].pending.secret.secretId, 'provider-api-key:openai')
    assert.equal(secretEvents[0].pending.secret.apiPath, SECRET_ANSWER_API_PATH)
  }

  const answer = await controller.answerSecret('thread-local', {
    secretId: 'provider-api-key:openai',
    value: 'super-secret-provider-key'
  })
  const result = await execution

  assert.equal(answer.success, true)
  assert.equal(capturedApiKey, 'super-secret-provider-key')
  assert.equal(result.details.providerId, 'openai')
  assert.equal(result.details.saved, true)
  assert.equal(result.details.validation.message, '连接成功 [REDACTED_SECRET]')
  assert.doesNotMatch(JSON.stringify(result), /super-secret-provider-key/)
  assert.equal(service.listPendingInteractions(resolved.conversation.id).length, 0)
})
