import type {
  MessageRow as DBMessageRow,
  ConversationEventRow as DBConversationEventRow,
  ThreadRow as DBThreadRow,
  WorkspaceRow as DBWorkspaceRow,
  WorkspaceSettingsRow as DBWorkspaceSettingsRow,
  WorkspaceMcpServerRow as DBWorkspaceMcpServerRow
} from './db-types'
import type {
  AgentAppEvent,
  AgentSubmittedQueueItem,
  AgentThreadProjection,
  AgentThreadWindowAroundTarget,
  AgentThreadWindowCursor,
  AgentThreadWindowPage
} from '../shared/agent-runtime'
import type { ChatMessageContent, ChatImageBlock } from '../shared/chat-content'
import type { PendingQuestionEvent, QuestionAnswerPayload } from '../shared/question-tool'
import type {
  PendingQuestionnaireEvent,
  QuestionnaireAnswerPayload
} from '../shared/questionnaire-tool'
import type { PendingSecretPromptEvent, SecretAnswerPayload } from '../shared/secret-input'
import type { ThreadPlanEvent, ThreadPlanState } from '../shared/thread-plan'
import type { SubagentPanelEvent } from '../shared/subagent-panel'
import type {
  FetchProviderModelsInput,
  FetchProviderModelsResult,
  ProviderConfigDetail,
  ProviderConfigSummary,
  ProviderValidationResult,
  SetProviderModelEnabledInput,
  SetupProviderApiKeyInput,
  SetupProviderApiKeyResult,
  UpsertProviderConfigInput,
  ValidateProviderConfigInput
} from '../shared/provider-config'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskValidationResult,
  UpdateScheduledTaskInput
} from '../shared/scheduled-tasks.ts'
import type {
  InstalledTransportPlugin,
  SaveTransportPluginAccountInput,
  StartTransportPluginAccountSetupInput,
  SetTransportPluginEnabledInput,
  TestTransportPluginAccountInput,
  TestTransportPluginAccountResult,
  TransportPluginAccount,
  TransportPluginAccountSetupEvent,
  TransportPluginAccountSetupMethod,
  TransportPluginAccountSetupStartResult
} from '../shared/transport-plugins.ts'
import type {
  InstallAgentPluginInput,
  InstallAgentPluginResult,
  InstalledAgentPlugin,
  ListInstalledAgentPluginsResult,
  SetAgentPluginComponentEnabledInput,
  SetAgentPluginEnabledInput
} from '../shared/agent-plugins.ts'
import type { ContextEngineConfig, ContextThreadDebugSnapshot } from '../shared/context-engine'
import type {
  KnowledgeRelation,
  KnowledgeReflection,
  KnowledgeSearchInput,
  KnowledgeSearchItem,
  KnowledgeSearchResult,
  KnowledgeTraceInput,
  KnowledgeTraceResult
} from '../shared/knowledge.ts'
import type {
  DoctorComponentResult,
  DoctorDomainSummary,
  DoctorDomainInfo
} from '../main/doctor/doctor-types.ts'
import type { ComputerUseDoctorResult } from '../main/computer-use/computer-use-types.ts'

type KnowledgeListQueryOptions = {
  limit?: number
  offset?: number
  from?: string
  to?: string
  query?: string
}

type KnowledgePagedResult<T> = {
  items: T[]
  total: number
}
import type { PluginManifest } from '../main/plugin-system/plugin-types.ts'
import type {
  AgentProfile,
  AgentRun,
  Conversation,
  ConversationBinding,
  ConversationMessage,
  ConversationSearchInput,
  ConversationSearchResult,
  ConversationWindowProjection,
  DeliveryRecord,
  EventLogEntry,
  InboundEnvelope,
  InteractionCheckpoint,
  ListAllConversationMessagesInput,
  ListAllConversationMessagesResult,
  ListConversationMessagesInput,
  ListConversationMessagesResult,
  ListConversationsInput,
  ListConversationsResult,
  ResolveConversationForEnvelopeInput,
  ResolveConversationForEnvelopeResult,
  UpsertAgentProfileInput
} from '../main/core-v2/domain.ts'
import type {
  EmbeddedGatewayInboundResult,
  EmbeddedGatewayLocalSubmitResult,
  SubmitDesktopLocalMessageInput
} from '../main/transport/embedded-gateway.ts'
import type { DispatchDeliveryResult } from '../main/transport/outbound-dispatcher.ts'
import type { TransportHostStatus } from '../main/transport/transport-host.ts'
import type { ComputerUseSetupReport } from '../shared/computer-use-settings.ts'

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
type SkillDoctorEntry = {
  type: 'warning' | 'error' | 'collision'
  message: string
  path?: string
  collision?: {
    resourceType: string
    name: string
    winnerPath: string
    loserPath: string
  }
}
type WorkspaceChangeEvent = {
  action: 'upsert' | 'delete'
  workspacePath: string
}
type ThinkingConfigResponse =
  | {
      success: true
      currentLevel: ThinkingLevel
      availableLevels: ThinkingLevel[]
      supportsThinking: boolean
    }
  | { success: false; error: string }

declare global {
  type WorkspaceRow = DBWorkspaceRow
  type WorkspaceSettingsRow = DBWorkspaceSettingsRow
  type WorkspaceMcpServerRow = DBWorkspaceMcpServerRow
  type ThreadRow = DBThreadRow
  type MessageRow = DBMessageRow
  type ConversationEventRow = DBConversationEventRow

  interface Window {
    electron: import('@electron-toolkit/preload').ElectronAPI
    api: {
      openSettings: (category?: string) => void
      openKnowledgeManager: () => void
      openRuntimeInspector: (threadId?: string | null) => void
      setRuntimeInspectorThread: (threadId?: string | null) => void
      onSettingsCategory: (callback: (category: string) => void) => void
      onRuntimeInspectorThread: (callback: (threadId: string) => void) => () => void
      onOpenThread: (callback: (threadId: string) => void) => () => void
      openExternal: (url: string) => void
      openPath: (path: string) => Promise<string>
      showItemInFolder: (path: string) => void
      showFileContextMenu: (input: {
        path: string
        threadId?: string | null
        workspacePath?: string | null
      }) => Promise<{ success: boolean; path?: string; error?: string }>
      webfetch: {
        openBrowser: (url?: string) => Promise<{ success: true }>
      }
      dialog: {
        openFolder: () => Promise<string | null>
        saveFile: (payload: {
          content: string
          defaultPath?: string
          filters?: Array<{ name: string; extensions: string[] }>
        }) => Promise<string | null>
      }
      chatAssets: {
        persistImages: (
          inputs: Array<{
            mimeType: string
            name?: string
            filePath?: string
            data?: ArrayBuffer | Uint8Array
          }>
        ) => Promise<ChatImageBlock[]>
      }
      db: {
        settings: {
          get: (key: string) => Promise<string | null>
          set: (key: string, value: string) => Promise<void>
          all: () => Promise<Record<string, string>>
        }
        providers: {
          list: () => Promise<
            {
              id: string
              displayName: string
              runtimeProvider: string
              enabled: boolean
              baseUrl: string | null
              settingsJson: string | null
            }[]
          >
          upsert: (provider: {
            id: string
            displayName: string
            runtimeProvider: string
            enabled?: boolean
            baseUrl?: string | null
            settingsJson?: string | null
          }) => Promise<void>
          getApiKey: (providerId: string) => Promise<string | null>
          setApiKey: (providerId: string, apiKey: string) => Promise<void>
          delete: (providerId: string) => Promise<void>
          models: {
            list: (providerId: string) => Promise<
              {
                providerId: string
                modelId: string
                label: string
                contextWindowTokens: number | null
                capabilitiesJson: string | null
                enabled: boolean
                rawJson: string | null
                updatedAt: string
              }[]
            >
            replace: (
              providerId: string,
              models: Array<{
                modelId: string
                label: string
                contextWindowTokens?: number | null
                capabilitiesJson?: string | null
                rawJson?: string | null
              }>,
              enabledByDefault?: boolean
            ) => Promise<void>
            setEnabled: (providerId: string, modelId: string, enabled: boolean) => Promise<void>
          }
        }
        workspaces: {
          list: () => Promise<WorkspaceRow[]>
          upsert: (workspacePath: string, name?: string) => Promise<void>
          delete: (workspacePath: string) => Promise<void>
          onChanged: (callback: (event: WorkspaceChangeEvent) => void) => () => void
        }
        workspaceSettings: {
          get: (workspacePath: string) => Promise<WorkspaceSettingsRow | null>
          set: (
            workspacePath: string,
            settings: { model?: string; mcp_enabled?: string }
          ) => Promise<void>
        }
        workspaceMcpServers: {
          list: (workspacePath: string) => Promise<WorkspaceMcpServerRow[]>
          setEnabled: (workspacePath: string, serverId: string, enabled: boolean) => Promise<void>
          clear: (workspacePath: string) => Promise<void>
        }
        mcpServers: {
          list: () => Promise<
            {
              id: string
              name: string
              description: string | null
              transport_type: 'stdio' | 'sse' | 'http'
              command: string | null
              args: string | null
              env: string | null
              url: string | null
              headers: string | null
              enabled: number
              created_at: string
            }[]
          >
          upsert: (server: {
            id: string
            name: string
            description?: string | null
            transport_type?: 'stdio' | 'sse' | 'http'
            command?: string | null
            args?: string | null
            env?: string | null
            url?: string | null
            headers?: string | null
            enabled?: boolean
          }) => Promise<void>
          delete: (id: string) => Promise<void>
        }
      }
      providerConfig: {
        listProviders: () => Promise<ProviderConfigSummary[]>
        getProviderDetail: (providerId: string) => Promise<ProviderConfigDetail>
        upsertProvider: (input: UpsertProviderConfigInput) => Promise<ProviderConfigDetail>
        validate: (input: ValidateProviderConfigInput) => Promise<ProviderValidationResult>
        fetchModels: (input: FetchProviderModelsInput) => Promise<FetchProviderModelsResult>
        setupApiKey: (input: SetupProviderApiKeyInput) => Promise<SetupProviderApiKeyResult>
        setModelEnabled: (input: SetProviderModelEnabledInput) => Promise<ProviderConfigDetail>
        deleteProvider: (providerId: string) => Promise<{ success: true }>
      }
      plugins: {
        listInstalled: () => Promise<InstalledTransportPlugin[]>
        getManifest: (pluginId: string) => Promise<PluginManifest | null>
        setEnabled: (
          input: SetTransportPluginEnabledInput
        ) => Promise<{ pluginId: string; enabled: boolean }>
        listTransportAccounts: (pluginId: string) => Promise<TransportPluginAccount[]>
        getTransportAccount: (
          pluginId: string,
          accountId: string
        ) => Promise<TransportPluginAccount | null>
        saveTransportAccount: (
          input: SaveTransportPluginAccountInput
        ) => Promise<TransportPluginAccount>
        testTransportAccount: (
          input: TestTransportPluginAccountInput
        ) => Promise<TestTransportPluginAccountResult>
        listTransportSetupMethods: (
          pluginId: string
        ) => Promise<TransportPluginAccountSetupMethod[]>
        startTransportAccountSetup: (
          input: StartTransportPluginAccountSetupInput
        ) => Promise<TransportPluginAccountSetupStartResult>
        cancelTransportAccountSetup: (
          pluginId: string,
          sessionId: string
        ) => Promise<{ success: true }>
        onTransportAccountSetupEvent: (
          callback: (event: TransportPluginAccountSetupEvent) => void
        ) => () => void
        deleteTransportAccount: (pluginId: string, accountId: string) => Promise<{ success: true }>
      }
      imTransports: {
        listInstalled: () => Promise<InstalledTransportPlugin[]>
        getManifest: (pluginId: string) => Promise<PluginManifest | null>
        setEnabled: (
          input: SetTransportPluginEnabledInput
        ) => Promise<{ pluginId: string; enabled: boolean }>
        listAccounts: (pluginId: string) => Promise<TransportPluginAccount[]>
        getAccount: (pluginId: string, accountId: string) => Promise<TransportPluginAccount | null>
        saveAccount: (input: SaveTransportPluginAccountInput) => Promise<TransportPluginAccount>
        testAccount: (
          input: TestTransportPluginAccountInput
        ) => Promise<TestTransportPluginAccountResult>
        listSetupMethods: (pluginId: string) => Promise<TransportPluginAccountSetupMethod[]>
        startAccountSetup: (
          input: StartTransportPluginAccountSetupInput
        ) => Promise<TransportPluginAccountSetupStartResult>
        cancelAccountSetup: (pluginId: string, sessionId: string) => Promise<{ success: true }>
        onAccountSetupEvent: (
          callback: (event: TransportPluginAccountSetupEvent) => void
        ) => () => void
        deleteAccount: (pluginId: string, accountId: string) => Promise<{ success: true }>
      }
      agentPlugins: {
        listInstalled: () => Promise<ListInstalledAgentPluginsResult>
        getManifest: (pluginId: string) => Promise<InstalledAgentPlugin['manifest'] | null>
        setEnabled: (
          input: SetAgentPluginEnabledInput
        ) => Promise<{ pluginId: string; enabled: boolean }>
        setComponentEnabled: (input: SetAgentPluginComponentEnabledInput) => Promise<{
          pluginId: string
          componentType: SetAgentPluginComponentEnabledInput['componentType']
          componentId: string
          enabled: boolean
        }>
        install: (input: InstallAgentPluginInput) => Promise<InstallAgentPluginResult>
        remove: (pluginId: string) => Promise<{ success: true }>
      }
      scheduledTasks: {
        list: (options?: { includeDisabled?: boolean }) => Promise<ScheduledTask[]>
        get: (taskId: string) => Promise<ScheduledTask | null>
        create: (input: CreateScheduledTaskInput) => Promise<ScheduledTask>
        update: (input: UpdateScheduledTaskInput) => Promise<ScheduledTask>
        validate: (
          input: CreateScheduledTaskInput | UpdateScheduledTaskInput
        ) => Promise<ScheduledTaskValidationResult>
        pause: (taskId: string) => Promise<ScheduledTask>
        resume: (taskId: string) => Promise<ScheduledTask>
        delete: (taskId: string) => Promise<{ success: true }>
        runNow: (taskId: string) => Promise<ScheduledTask>
        listRuns: (taskId: string, limit?: number) => Promise<ScheduledTaskRun[]>
      }
      doctor: {
        listDomains: () => Promise<DoctorDomainInfo[]>
        listComponents: (domain: string) => Promise<DoctorComponentResult[]>
        getComponentStatus: (domain: string, componentId: string) => Promise<DoctorComponentResult>
        getDomainSummary: (domain: string) => Promise<DoctorDomainSummary>
      }
      computerUse: {
        doctor: () => Promise<ComputerUseDoctorResult>
        requestPermissions: (timeoutMs?: number) => Promise<Record<string, unknown>>
        testSetup: () => Promise<ComputerUseSetupReport>
      }
      coreV2: {
        agentProfiles: {
          upsert: (input: UpsertAgentProfileInput) => Promise<AgentProfile>
        }
        conversations: {
          resolveEnvelope: (
            input: ResolveConversationForEnvelopeInput
          ) => Promise<ResolveConversationForEnvelopeResult>
          get: (conversationId: string) => Promise<Conversation | null>
          getLocalByThread: (threadId: string) => Promise<{
            conversation: Conversation
            binding: ConversationBinding
          } | null>
          listLocalThreadRows: () => Promise<ThreadRow[]>
          listWindows: (
            sourceKind?: 'local' | 'im' | 'all'
          ) => Promise<ConversationWindowProjection[]>
        }
        localThreads: {
          create: (
            workspacePath: string,
            model?: string | null,
            title?: string | null
          ) => Promise<ThreadRow>
          update: (
            id: string,
            fields: { title?: string; started_at?: string; model?: string }
          ) => Promise<ThreadRow>
          generateTitle: (input: {
            text: string
            imageCount?: number
          }) => Promise<{ title: string; source: 'model' | 'fallback'; modelKey: string | null }>
          delete: (id: string) => Promise<void>
          getUserChatOrdinal: (threadId: string, messageId: string) => Promise<number | null>
          pruneRuntimeAfter: (threadId: string, cutoffCreatedAt: string) => Promise<void>
        }
        messages: {
          list: (conversationId: string) => Promise<ConversationMessage[]>
          search: (input: ConversationSearchInput) => Promise<ConversationSearchResult>
          listConversations: (input: ListConversationsInput) => Promise<ListConversationsResult>
          listConversationMessages: (input: ListConversationMessagesInput) => Promise<ListConversationMessagesResult>
          listAllConversationMessages: (input: ListAllConversationMessagesInput) => Promise<ListAllConversationMessagesResult>
        }
        localMessages: {
          add: (
            threadId: string,
            role: 'user' | 'assistant' | 'tool',
            content: string,
            agentRunId?: string | null,
            contentJson?: ChatMessageContent | null,
            options?: {
              messageKind?:
                | 'chat'
                | 'automation'
                | 'question_answer'
                | 'questionnaire_question'
                | 'questionnaire_answer'
              includeInAgentContext?: boolean
              submissionId?: string | null
              agentTurnId?: string | null
              toolCallId?: string
              stepIndex?: number
              runtimeSequence?: number | null
              createdAt?: string | number | Date | null
            }
          ) => Promise<MessageRow>
          update: (
            id: string,
            content: string,
            contentJson?: ChatMessageContent | null
          ) => Promise<MessageRow | null>
          delete: (id: string) => Promise<boolean>
          setAgentEntryId: (id: string, agentEntryId: string) => Promise<MessageRow | null>
          updateRuntimeLink: (
            id: string,
            fields: {
              agentRunId?: string | null
              submissionId?: string | null
              agentTurnId?: string | null
              runtimeSequence?: number | null
              createdAt?: string | number | Date | null
            }
          ) => Promise<MessageRow | null>
          prepareForRetry: (id: string) => Promise<MessageRow | null>
        }
        runs: {
          get: (runId: string) => Promise<AgentRun | null>
          list: (conversationId: string) => Promise<AgentRun[]>
        }
        interactions: {
          listPending: (conversationId?: string) => Promise<InteractionCheckpoint[]>
        }
        deliveries: {
          list: (conversationId: string) => Promise<DeliveryRecord[]>
        }
        threadPlans: {
          get: (threadId: string) => Promise<ThreadPlanState | null>
        }
        events: {
          list: () => Promise<EventLogEntry[]>
          pruneOld: (retentionDays?: number) => Promise<number>
          stats: () => Promise<{
            totalCount: number
            oldestEntry: string | null
            newestEntry: string | null
          }>
        }
      }
      gateway: {
        start: () => Promise<{ success: true }>
        stop: () => Promise<{ success: true }>
        restart: () => Promise<{ success: true }>
        listTransportStatuses: () => Promise<TransportHostStatus[]>
        ingestInbound: (envelope: InboundEnvelope) => Promise<EmbeddedGatewayInboundResult>
        submitLocalMessage: (
          input: SubmitDesktopLocalMessageInput
        ) => Promise<EmbeddedGatewayLocalSubmitResult>
        resetLocalConversation: (threadId: string) => Promise<{ success: true }>
        answerQuestion: (
          threadId: string,
          payload: QuestionAnswerPayload
        ) => Promise<{ success: true } | { success: false; error: string }>
        answerQuestionnaire: (
          threadId: string,
          payload: QuestionnaireAnswerPayload
        ) => Promise<{ success: true } | { success: false; error: string }>
        answerSecret: (
          threadId: string,
          payload: SecretAnswerPayload
        ) => Promise<{ success: true } | { success: false; error: string }>
        dispatchPendingDeliveries: () => Promise<DispatchDeliveryResult[]>
        onQuestion: (callback: (event: PendingQuestionEvent) => void) => () => void
        onQuestionnaire: (callback: (event: PendingQuestionnaireEvent) => void) => () => void
        onSecret: (callback: (event: PendingSecretPromptEvent) => void) => () => void
        onThreadPlan: (callback: (event: ThreadPlanEvent) => void) => () => void
        onSubagentPanel: (callback: (event: SubagentPanelEvent) => void) => () => void
      }
      widget: {
        registerHtml: (threadId: string, html: string) => Promise<{ id: string; url: string }>
        delete: (id: string) => Promise<void>
        setInactive: (id: string, inactive: boolean) => Promise<void>
      }
      mcp: {
        marketplace: {
          list: (input?: {
            query?: string
            page?: number
            limit?: number
            cursor?: string
          }) => Promise<{
            items: Array<{
              id: string
              name: string
              author: string
              description: string
              tags: string[]
              detailUrl: string
            }>
            page: number
            limit: number
            hasMore: boolean
            nextCursor?: string
            source: string
          }>
        }
      }
      runtime: {
        prepareThread: (chatThreadId: string) => Promise<{ success: true; chatThreadId: string }>
        abortThread: (chatThreadId: string) => Promise<{ success: true }>
        disposeThread: (chatThreadId: string) => Promise<{ success: true }>
        setActiveThread: (chatThreadId?: string | null) => Promise<{ success: true }>
        reload: (chatThreadId?: string | null) => Promise<
          | {
              success: true
              chatThreadId: string | null
              reloaded: boolean
              deferred: boolean
              reason?: 'no-target' | 'not-initialized'
            }
          | { success: false; chatThreadId: string | null; error: string }
        >
        compactContext: (chatThreadId: string) => Promise<
          | {
              success: true
              changed: boolean
              revision: number
              summaryEntryId?: string | null
            }
          | { success: false; error: string }
        >
        getUserMessagesForForking: (
          chatThreadId: string
        ) => Promise<{ entryId: string; text: string }[]>
        getQueuedMessages: (chatThreadId: string) => Promise<AgentSubmittedQueueItem[]>
        getThreadProjection: (chatThreadId: string) => Promise<AgentThreadProjection>
        getThreadWindow: (
          chatThreadId: string,
          options?: {
            limit?: number
            beforeCursor?: AgentThreadWindowCursor | null
            around?: AgentThreadWindowAroundTarget | null
          }
        ) => Promise<AgentThreadWindowPage>
        getThinkingConfig: (chatThreadId: string) => Promise<ThinkingConfigResponse>
        setThinkingLevel: (
          chatThreadId: string,
          level: ThinkingLevel
        ) => Promise<ThinkingConfigResponse>
        listRuntimeEvents: (
          chatThreadId: string,
          agentRunId?: string
        ) => Promise<ConversationEventRow[]>
        recordRendererDebugEvent: (
          chatThreadId: string,
          event: ConversationEventRow
        ) => Promise<void>
        navigateTree: (
          chatThreadId: string,
          targetId: string,
          options?: {
            summarize?: boolean
            customInstructions?: string
            replaceInstructions?: boolean
            label?: string
          }
        ) => Promise<{
          cancelled: boolean
          editorText?: string
          aborted?: boolean
        }>
        notifyRunFinished: (payload: {
          threadId: string
          runId: string
          preview: string
        }) => Promise<{ success: true; notificationShown: boolean }>
        setRunFinishedBadgeCount: (count: number) => Promise<{ success: true }>
        onEvent: (
          callback: (event: AgentAppEvent & { __chatThreadId?: string }) => void
        ) => () => void
        onDebugEvent: (
          callback: (event: ConversationEventRow & { __chatThreadId?: string }) => void
        ) => () => void
      }
      context: {
        getConfig: () => Promise<{ path: string; config: ContextEngineConfig }>
        setConfig: (
          config: ContextEngineConfig
        ) => Promise<{ path: string; config: ContextEngineConfig }>
        getThreadDebug: (chatThreadId: string) => Promise<ContextThreadDebugSnapshot>
      }
      e2e: {
        enabled: boolean
        agent: {
          simulateStream: (
            chatThreadId: string,
            input: { text: string; chunkSize?: number; delayMs?: number }
          ) => Promise<{ success: true; runId: string; agentMessageId: string }>
        }
      }
      skills: {
        getRootDir: () => Promise<{
          rootDir: string
          defaultRootDir: string
          installRootDir: string
          extraDirs: string[]
        }>
        openFolder: () => Promise<{
          success: boolean
          rootDir: string
          defaultRootDir: string
          installRootDir: string
          extraDirs: string[]
        }>
        addExtraDir: (dir: string) => Promise<
          | {
              success: true
              rootDir: string
              defaultRootDir: string
              installRootDir: string
              extraDirs: string[]
            }
          | { success: false; error: string }
        >
        removeExtraDir: (dir: string) => Promise<{
          success: true
          rootDir: string
          defaultRootDir: string
          installRootDir: string
          extraDirs: string[]
        }>
        list: () => Promise<{
          rootDir: string
          defaultRootDir: string
          installRootDir: string
          extraDirs: string[]
          skills: {
            name: string
            description: string
            path: string
            source: string
            enabled: boolean
            disableModelInvocation: boolean
          }[]
          doctor: SkillDoctorEntry[]
        }>
        setEnabled: (name: string, enabled: boolean) => Promise<{ success: boolean }>
        install: (
          source: string,
          options?: { force?: boolean; ref?: string }
        ) => Promise<
          | {
              success: true
              rootDir: string
              installRootDir: string
              result: {
                owner: string
                repo: string
                ref: string
                repoUrl: string
                skillsPath: string
                targetDir: string
                fileCount: number
                installedEntries: string[]
              }
            }
          | { success: false; error: string }
        >
        read: (
          name: string
        ) => Promise<{ success: boolean; path?: string; content?: string; error?: string }>
        delete: (name: string) => Promise<{ success: boolean; error?: string }>
      }
      workspace: {
        getTempRoot: () => Promise<{ rootDir: string }>
        openTempRoot: () => Promise<{ success: boolean; rootDir: string }>
        createTemp: () => Promise<{ workspacePath: string; rootDir: string }>
        deleteDirectory: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
      }
      knowledge: {
        search: (input: KnowledgeSearchInput) => Promise<KnowledgeSearchResult>
        trace: (input: KnowledgeTraceInput) => Promise<KnowledgeTraceResult | null>
        getSettings: () => Promise<{
          enabled: boolean
          autoExtractEnabled: boolean
          autoInjectEnabled: boolean
          embeddingModel: string
          injectionTokenBudget: number
          extractionModel: string
          consolidationModel: string
          dreamModel: string
        }>
        setSettings: (patch: Partial<{
          enabled: boolean
          autoExtractEnabled: boolean
          autoInjectEnabled: boolean
          embeddingModel: string
          injectionTokenBudget: number
          extractionModel: string
          consolidationModel: string
          dreamModel: string
        }>) => Promise<{
          enabled: boolean
          autoExtractEnabled: boolean
          autoInjectEnabled: boolean
          embeddingModel: string
          injectionTokenBudget: number
          extractionModel: string
          consolidationModel: string
          dreamModel: string
        }>
        getThreadCapture: (threadId: string) => Promise<{ threadId: string; enabled: boolean }>
        setThreadCapture: (threadId: string, enabled: boolean) => Promise<{ threadId: string; enabled: boolean }>
        stats: () => Promise<{
          entities: number
          activeClaims: number
          activeTasks: number
          taskRuns: number
          patterns: number
          profiles: number
          relations: number
          vectors: number
        }>
        listEntities: (limit?: number) => Promise<Array<{
          id: string
          type: string
          canonicalName: string
          aliases: string[]
          summary: string | null
          updatedAt: string
        }>>
        listActiveTasks: (limit?: number) => Promise<Array<{
          id: string
          conversationId: string
          threadId: string | null
          workspacePath: string | null
          runIds: string[]
          runCount: number
          startedAt: string
          updatedAt: string
          triggerReason: string | null
          lastUserText: string | null
        }>>
        finalizeActiveTask: (taskId: string) => Promise<{
          insertedClaims: number
          skippedClaims: number
          affectedEntityIds: string[]
        } | null>
        discardActiveTask: (taskId: string) => Promise<{ discarded: boolean }>
        getEntity: (entityId: string) => Promise<{
          entity: {
            id: string
            type: string
            canonicalName: string
            aliases: string[]
            summary: string | null
          } | null
          profiles: KnowledgeReflection[]
          patterns: KnowledgeReflection[]
          claims: KnowledgeSearchItem[]
          relations: KnowledgeRelation[]
        } | null>
        listAllClaims: (options?: KnowledgeListQueryOptions) => Promise<KnowledgePagedResult<KnowledgeSearchItem>>
        listAllPatterns: (options?: KnowledgeListQueryOptions) => Promise<KnowledgePagedResult<KnowledgeReflection>>
        listAllProfiles: (options?: KnowledgeListQueryOptions) => Promise<KnowledgePagedResult<KnowledgeReflection>>
        deleteClaim: (claimId: string) => Promise<{ deleted: boolean }>
        deleteReflection: (reflectionId: string) => Promise<{ deleted: boolean }>
        deleteEntity: (entityId: string) => Promise<{ deleted: boolean }>
        runDream: (options?: { force?: boolean }) => Promise<{
          processedEntities: number
          deduplicatedClaims: number
          archivedClaims: number
          patternsCreated: number
          profilesUpdated: number
          createdReflections: number
        }>
        embeddingModels: {
          list: () => Promise<Array<{
            key: string
            label: string
            providerName: string
            description: string
            sourceType: 'local' | 'remote'
            approximateSizeMb: number | null
            dimensions: number | null
            languageHint: string | null
            license: string | null
            publicResourceUrl: string | null
            downloaded: boolean
            cacheDir: string | null
          }>>
          download: (key: string) => Promise<{ success: boolean; error?: string }>
          openCacheDir: (key: string) => Promise<{ cacheDir: string }>
          onDownloadProgress: (callback: (event: {
            key: string
            file: string
            downloadedBytes: number
            totalBytes: number | null
            fileIndex: number
            fileCount: number
          }) => void) => () => void
        }
      }
    }
  }
}
