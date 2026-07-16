import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  createExtensionRuntime,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  type ResourceLoader
} from '@earendil-works/pi-coding-agent'
import type {
  StartWorkerAttemptInput,
  WorkerResultEnvelope,
  WorkerSessionHandle
} from './subagent-types.ts'
import { parseWorkerResultFromSessionState } from './worker-result-parser.ts'

type AgentSessionLike = CreateAgentSessionResult['session']
type CreateAgentSessionLike = (
  options: CreateAgentSessionOptions
) => Promise<{ session: AgentSessionLike }>

export type WorkerSessionFactoryOptions = {
  createAgentSession?: CreateAgentSessionLike
}

export interface WorkerSessionFactory {
  create(input: StartWorkerAttemptInput): Promise<WorkerSessionHandle>
}

export class WorkerSessionFactoryImpl implements WorkerSessionFactory {
  private readonly createAgentSession: CreateAgentSessionLike

  constructor(options: WorkerSessionFactoryOptions = {}) {
    this.createAgentSession = options.createAgentSession ?? createAgentSession
  }

  async create(input: StartWorkerAttemptInput): Promise<WorkerSessionHandle> {
    const authStorage = AuthStorage.inMemory()
    if (input.runtimeModel.providerConfig.apiKey) {
      authStorage.setRuntimeApiKey(input.runtimeModel.providerId, input.runtimeModel.providerConfig.apiKey)
    }
    const modelRegistry = ModelRegistry.inMemory(authStorage)
    modelRegistry.registerProvider(input.runtimeModel.providerId, {
      baseUrl: input.runtimeModel.providerConfig.baseUrl,
      apiKey: input.runtimeModel.providerConfig.apiKey,
      api: input.runtimeModel.providerConfig.api as any,
      authHeader: input.runtimeModel.providerConfig.authHeader,
      headers: input.runtimeModel.providerConfig.headers,
      models: input.runtimeModel.providerConfig.models.map((model) => ({
        ...model,
        api: model.api as any,
        compat: model.compat as any
      })) as any
    })
    const model = modelRegistry.find(input.runtimeModel.providerId, input.runtimeModel.modelId)
    if (!model) {
      throw new Error(
        `Worker runtime model not found: ${input.runtimeModel.providerId}::${input.runtimeModel.modelId}`
      )
    }

    const { session } = await this.createAgentSession({
      cwd: input.cwd,
      model,
      thinkingLevel: input.runtimeModel.reasoningLevel as any,
      authStorage,
      modelRegistry,
      tools: input.toolPolicy.activeToolNames,
      resourceLoader: new StaticWorkerResourceLoader(input.promptPackage.systemPrompt),
      sessionManager: SessionManager.inMemory(input.cwd)
    })

    return new SdkWorkerSessionHandle(input, session)
  }
}

class SdkWorkerSessionHandle implements WorkerSessionHandle {
  readonly workerSessionId: string

  constructor(
    private readonly input: StartWorkerAttemptInput,
    private readonly session: AgentSessionLike
  ) {
    this.workerSessionId = session.sessionId ?? input.attemptId
  }

  async run(signal: AbortSignal, onEvent: (event: unknown) => void): Promise<WorkerResultEnvelope> {
    const unsubscribe = this.session.subscribe((event) => onEvent(event))
    const abortSession = () => {
      void this.session.abort()
    }

    signal.addEventListener('abort', abortSession, { once: true })

    if (signal.aborted) {
      abortSession()
    }

    try {
      await this.session.prompt(formatWorkerPrompt(this.input))
      return parseWorkerResultFromSessionState(this.session.state)
    } finally {
      signal.removeEventListener('abort', abortSession)
      unsubscribe()
    }
  }

  async dispose(): Promise<void> {
    this.session.dispose()
  }
}

class StaticWorkerResourceLoader implements ResourceLoader {
  constructor(private readonly systemPrompt: string) {}

  getExtensions() {
    return { extensions: [], errors: [], runtime: createExtensionRuntime() }
  }

  getSkills() {
    return { skills: [], diagnostics: [] }
  }

  getPrompts() {
    return { prompts: [], diagnostics: [] }
  }

  getThemes() {
    return { themes: [], diagnostics: [] }
  }

  getAgentsFiles() {
    return { agentsFiles: [] }
  }

  getSystemPrompt(): string {
    return this.systemPrompt
  }

  getAppendSystemPrompt(): string[] {
    return []
  }

  extendResources(_paths: unknown): void {}

  async reload(): Promise<void> {}
}

const formatWorkerPrompt = (input: StartWorkerAttemptInput): string => {
  const context = input.promptPackage.contextMessages
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n\n')

  return [
    'Context:',
    context || '(none)',
    '',
    'Task:',
    input.promptPackage.taskInstruction,
    '',
    'Result contract:',
    input.promptPackage.resultContract
  ].join('\n')
}
