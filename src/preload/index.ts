import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  MessageRow,
  ThreadRow,
  WorkspaceRow,
  WorkspaceSettingsRow,
  WorkspaceMcpServerRow,
  ConversationEventRow
} from './db-types'
import { shell } from 'electron'
import type {
  AgentAppEvent,
  AgentSubmittedQueueItem,
  AgentThreadProjection,
  AgentThreadWindowAroundTarget,
  AgentThreadWindowCursor,
  AgentThreadWindowPage
} from '../shared/agent-runtime'
import type { ChatImageBlock, ChatMessageContent } from '../shared/chat-content'
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
  DoctorComponentResult,
  DoctorDomainSummary,
  DoctorDomainInfo
} from '../main/doctor/doctor-types.ts'
import type { ComputerUseDoctorResult } from '../main/computer-use/computer-use-types.ts'
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
const isE2EMode = process.env.PIAGENT_E2E === '1'
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

const api = {
  openSettings: (category?: string) => ipcRenderer.send('open-settings', category),
  openKnowledgeManager: () => ipcRenderer.send('open-knowledge-manager'),
  openRuntimeInspector: (threadId?: string | null) =>
    ipcRenderer.send('open-runtime-inspector', threadId ?? null),
  setRuntimeInspectorThread: (threadId?: string | null) =>
    ipcRenderer.send('runtime-inspector:set-thread', threadId ?? null),
  onSettingsCategory: (callback: (category: string) => void) =>
    ipcRenderer.on('set-settings-category', (_, category: string) => callback(category)),
  onRuntimeInspectorThread: (callback: (threadId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, threadId: string) => callback(threadId)
    ipcRenderer.on('runtime-inspector:set-thread', listener)
    return () => ipcRenderer.removeListener('runtime-inspector:set-thread', listener)
  },
  onOpenThread: (callback: (threadId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, threadId: string) => callback(threadId)
    ipcRenderer.on('main-window:open-thread', listener)
    return () => ipcRenderer.removeListener('main-window:open-thread', listener)
  },
  openExternal: (url: string) => shell.openExternal(url),
  openPath: (path: string) => shell.openPath(path),
  showItemInFolder: (path: string) => {
    shell.showItemInFolder(path)
  },
  showFileContextMenu: (input: {
    path: string
    threadId?: string | null
    workspacePath?: string | null
  }) => ipcRenderer.invoke('file-context-menu:show', input),

  webfetch: {
    openBrowser: (url?: string): Promise<{ success: true }> =>
      ipcRenderer.invoke('webfetch:open-browser', url)
  },

  dialog: {
    openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:open-folder'),
    saveFile: (payload: {
      content: string
      defaultPath?: string
      filters?: Array<{ name: string; extensions: string[] }>
    }): Promise<string | null> => ipcRenderer.invoke('dialog:save-file', payload)
  },

  chatAssets: {
    persistImages: (
      inputs: Array<{
        mimeType: string
        name?: string
        filePath?: string
        data?: ArrayBuffer | Uint8Array
      }>
    ): Promise<ChatImageBlock[]> => ipcRenderer.invoke('chat-assets:images:persist', inputs)
  },

  db: {
    settings: {
      get: (key: string): Promise<string | null> => ipcRenderer.invoke('db:settings:get', key),
      set: (key: string, value: string): Promise<void> =>
        ipcRenderer.invoke('db:settings:set', key, value),
      all: (): Promise<Record<string, string>> => ipcRenderer.invoke('db:settings:all')
    },
    mcpServers: {
      list: (): Promise<
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
      > => ipcRenderer.invoke('db:mcp-servers:list'),
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
      }): Promise<void> => ipcRenderer.invoke('db:mcp-servers:upsert', server),
      delete: (id: string): Promise<void> => ipcRenderer.invoke('db:mcp-servers:delete', id)
    },
    providers: {
      list: (): Promise<
        {
          id: string
          displayName: string
          runtimeProvider: string
          enabled: boolean
          baseUrl: string | null
          settingsJson: string | null
        }[]
      > => ipcRenderer.invoke('db:providers:list'),
      upsert: (provider: {
        id: string
        displayName: string
        runtimeProvider: string
        enabled?: boolean
        baseUrl?: string | null
        settingsJson?: string | null
      }): Promise<void> => ipcRenderer.invoke('db:providers:upsert', provider),
      getApiKey: (providerId: string): Promise<string | null> =>
        ipcRenderer.invoke('db:providers:get-api-key', providerId),
      setApiKey: (providerId: string, apiKey: string): Promise<void> =>
        ipcRenderer.invoke('db:providers:set-api-key', providerId, apiKey),
      delete: (providerId: string): Promise<void> =>
        ipcRenderer.invoke('db:providers:delete', providerId),
      models: {
        list: (
          providerId: string
        ): Promise<
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
        > => ipcRenderer.invoke('db:providers:models:list', providerId),
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
        ): Promise<void> =>
          ipcRenderer.invoke('db:providers:models:replace', providerId, models, enabledByDefault),
        setEnabled: (providerId: string, modelId: string, enabled: boolean): Promise<void> =>
          ipcRenderer.invoke('db:providers:models:set-enabled', providerId, modelId, enabled)
      }
    },
    workspaces: {
      list: (): Promise<WorkspaceRow[]> => ipcRenderer.invoke('db:workspaces:list'),
      upsert: (workspacePath: string, name?: string): Promise<void> =>
        ipcRenderer.invoke('db:workspaces:upsert', workspacePath, name),
      delete: (workspacePath: string): Promise<void> =>
        ipcRenderer.invoke('db:workspaces:delete', workspacePath),
      onChanged: (callback: (event: WorkspaceChangeEvent) => void): (() => void) => {
        const listener = (_: Electron.IpcRendererEvent, event: WorkspaceChangeEvent) =>
          callback(event)
        ipcRenderer.on('db:workspaces:changed', listener)
        return () => ipcRenderer.removeListener('db:workspaces:changed', listener)
      }
    },
    workspaceSettings: {
      get: (workspacePath: string): Promise<WorkspaceSettingsRow | null> =>
        ipcRenderer.invoke('db:workspace-settings:get', workspacePath),
      set: (
        workspacePath: string,
        settings: { model?: string; mcp_enabled?: string }
      ): Promise<void> => ipcRenderer.invoke('db:workspace-settings:set', workspacePath, settings)
    },
    workspaceMcpServers: {
      list: (workspacePath: string): Promise<WorkspaceMcpServerRow[]> =>
        ipcRenderer.invoke('db:workspace-mcp-servers:list', workspacePath),
      setEnabled: (workspacePath: string, serverId: string, enabled: boolean): Promise<void> =>
        ipcRenderer.invoke(
          'db:workspace-mcp-servers:set-enabled',
          workspacePath,
          serverId,
          enabled
        ),
      clear: (workspacePath: string): Promise<void> =>
        ipcRenderer.invoke('db:workspace-mcp-servers:clear', workspacePath)
    }
  },

  providerConfig: {
    listProviders: (): Promise<ProviderConfigSummary[]> =>
      ipcRenderer.invoke('provider-config:list'),
    getProviderDetail: (providerId: string): Promise<ProviderConfigDetail> =>
      ipcRenderer.invoke('provider-config:get-detail', providerId),
    upsertProvider: (input: UpsertProviderConfigInput): Promise<ProviderConfigDetail> =>
      ipcRenderer.invoke('provider-config:upsert', input),
    validate: (input: ValidateProviderConfigInput): Promise<ProviderValidationResult> =>
      ipcRenderer.invoke('provider-config:validate', input),
    fetchModels: (input: FetchProviderModelsInput): Promise<FetchProviderModelsResult> =>
      ipcRenderer.invoke('provider-config:fetch-models', input),
    setupApiKey: (input: SetupProviderApiKeyInput): Promise<SetupProviderApiKeyResult> =>
      ipcRenderer.invoke('provider-config:setup-api-key', input),
    setModelEnabled: (input: SetProviderModelEnabledInput): Promise<ProviderConfigDetail> =>
      ipcRenderer.invoke('provider-config:set-model-enabled', input),
    deleteProvider: (providerId: string): Promise<{ success: true }> =>
      ipcRenderer.invoke('provider-config:delete', providerId)
  },

  plugins: {
    listInstalled: (): Promise<InstalledTransportPlugin[]> =>
      ipcRenderer.invoke('plugins:list-installed'),
    getManifest: (pluginId: string): Promise<PluginManifest | null> =>
      ipcRenderer.invoke('plugins:get-manifest', pluginId),
    setEnabled: (
      input: SetTransportPluginEnabledInput
    ): Promise<{ pluginId: string; enabled: boolean }> =>
      ipcRenderer.invoke('plugins:set-enabled', input),
    listTransportAccounts: (pluginId: string): Promise<TransportPluginAccount[]> =>
      ipcRenderer.invoke('plugins:list-transport-accounts', pluginId),
    getTransportAccount: (
      pluginId: string,
      accountId: string
    ): Promise<TransportPluginAccount | null> =>
      ipcRenderer.invoke('plugins:get-transport-account', pluginId, accountId),
    saveTransportAccount: (
      input: SaveTransportPluginAccountInput
    ): Promise<TransportPluginAccount> =>
      ipcRenderer.invoke('plugins:save-transport-account', input),
    testTransportAccount: (
      input: TestTransportPluginAccountInput
    ): Promise<TestTransportPluginAccountResult> =>
      ipcRenderer.invoke('plugins:test-transport-account', input),
    listTransportSetupMethods: (pluginId: string): Promise<TransportPluginAccountSetupMethod[]> =>
      ipcRenderer.invoke('plugins:list-transport-setup-methods', pluginId),
    startTransportAccountSetup: (
      input: StartTransportPluginAccountSetupInput
    ): Promise<TransportPluginAccountSetupStartResult> =>
      ipcRenderer.invoke('plugins:start-transport-account-setup', input),
    cancelTransportAccountSetup: (
      pluginId: string,
      sessionId: string
    ): Promise<{ success: true }> =>
      ipcRenderer.invoke('plugins:cancel-transport-account-setup', pluginId, sessionId),
    onTransportAccountSetupEvent: (
      callback: (event: TransportPluginAccountSetupEvent) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        value: TransportPluginAccountSetupEvent
      ): void => callback(value)
      ipcRenderer.on('plugins:transport-account-setup-event', listener)
      return () => ipcRenderer.removeListener('plugins:transport-account-setup-event', listener)
    },
    deleteTransportAccount: (pluginId: string, accountId: string): Promise<{ success: true }> =>
      ipcRenderer.invoke('plugins:delete-transport-account', pluginId, accountId)
  },

  imTransports: {
    listInstalled: (): Promise<InstalledTransportPlugin[]> =>
      ipcRenderer.invoke('imTransports:listInstalled'),
    getManifest: (pluginId: string): Promise<PluginManifest | null> =>
      ipcRenderer.invoke('imTransports:getManifest', pluginId),
    setEnabled: (
      input: SetTransportPluginEnabledInput
    ): Promise<{ pluginId: string; enabled: boolean }> =>
      ipcRenderer.invoke('imTransports:setEnabled', input),
    listAccounts: (pluginId: string): Promise<TransportPluginAccount[]> =>
      ipcRenderer.invoke('imTransports:listAccounts', pluginId),
    getAccount: (pluginId: string, accountId: string): Promise<TransportPluginAccount | null> =>
      ipcRenderer.invoke('imTransports:getAccount', pluginId, accountId),
    saveAccount: (input: SaveTransportPluginAccountInput): Promise<TransportPluginAccount> =>
      ipcRenderer.invoke('imTransports:saveAccount', input),
    testAccount: (
      input: TestTransportPluginAccountInput
    ): Promise<TestTransportPluginAccountResult> =>
      ipcRenderer.invoke('imTransports:testAccount', input),
    listSetupMethods: (pluginId: string): Promise<TransportPluginAccountSetupMethod[]> =>
      ipcRenderer.invoke('imTransports:listSetupMethods', pluginId),
    startAccountSetup: (
      input: StartTransportPluginAccountSetupInput
    ): Promise<TransportPluginAccountSetupStartResult> =>
      ipcRenderer.invoke('imTransports:startAccountSetup', input),
    cancelAccountSetup: (pluginId: string, sessionId: string): Promise<{ success: true }> =>
      ipcRenderer.invoke('imTransports:cancelAccountSetup', pluginId, sessionId),
    onAccountSetupEvent: (
      callback: (event: TransportPluginAccountSetupEvent) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        value: TransportPluginAccountSetupEvent
      ): void => callback(value)
      ipcRenderer.on('imTransports:accountSetupEvent', listener)
      return () => ipcRenderer.removeListener('imTransports:accountSetupEvent', listener)
    },
    deleteAccount: (pluginId: string, accountId: string): Promise<{ success: true }> =>
      ipcRenderer.invoke('imTransports:deleteAccount', pluginId, accountId)
  },

  agentPlugins: {
    listInstalled: (): Promise<ListInstalledAgentPluginsResult> =>
      ipcRenderer.invoke('agentPlugins:listInstalled'),
    getManifest: (pluginId: string): Promise<InstalledAgentPlugin['manifest'] | null> =>
      ipcRenderer.invoke('agentPlugins:getManifest', pluginId),
    setEnabled: (
      input: SetAgentPluginEnabledInput
    ): Promise<{ pluginId: string; enabled: boolean }> =>
      ipcRenderer.invoke('agentPlugins:setEnabled', input),
    setComponentEnabled: (
      input: SetAgentPluginComponentEnabledInput
    ): Promise<{
      pluginId: string
      componentType: SetAgentPluginComponentEnabledInput['componentType']
      componentId: string
      enabled: boolean
    }> => ipcRenderer.invoke('agentPlugins:setComponentEnabled', input),
    install: (input: InstallAgentPluginInput): Promise<InstallAgentPluginResult> =>
      ipcRenderer.invoke('agentPlugins:install', input),
    remove: (pluginId: string): Promise<{ success: true }> =>
      ipcRenderer.invoke('agentPlugins:remove', pluginId)
  },

  scheduledTasks: {
    list: (options?: { includeDisabled?: boolean }): Promise<ScheduledTask[]> =>
      ipcRenderer.invoke('scheduled-tasks:list', options),
    get: (taskId: string): Promise<ScheduledTask | null> =>
      ipcRenderer.invoke('scheduled-tasks:get', taskId),
    create: (input: CreateScheduledTaskInput): Promise<ScheduledTask> =>
      ipcRenderer.invoke('scheduled-tasks:create', input),
    update: (input: UpdateScheduledTaskInput): Promise<ScheduledTask> =>
      ipcRenderer.invoke('scheduled-tasks:update', input),
    validate: (
      input: CreateScheduledTaskInput | UpdateScheduledTaskInput
    ): Promise<ScheduledTaskValidationResult> =>
      ipcRenderer.invoke('scheduled-tasks:validate', input),
    pause: (taskId: string): Promise<ScheduledTask> =>
      ipcRenderer.invoke('scheduled-tasks:pause', taskId),
    resume: (taskId: string): Promise<ScheduledTask> =>
      ipcRenderer.invoke('scheduled-tasks:resume', taskId),
    delete: (taskId: string): Promise<{ success: true }> =>
      ipcRenderer.invoke('scheduled-tasks:delete', taskId),
    runNow: (taskId: string): Promise<ScheduledTask> =>
      ipcRenderer.invoke('scheduled-tasks:run-now', taskId),
    listRuns: (taskId: string, limit?: number): Promise<ScheduledTaskRun[]> =>
      ipcRenderer.invoke('scheduled-tasks:runs:list', taskId, limit)
  },

  doctor: {
    listDomains: (): Promise<DoctorDomainInfo[]> => ipcRenderer.invoke('doctor:list-domains'),
    listComponents: (domain: string): Promise<DoctorComponentResult[]> =>
      ipcRenderer.invoke('doctor:list-components', domain),
    getComponentStatus: (domain: string, componentId: string): Promise<DoctorComponentResult> =>
      ipcRenderer.invoke('doctor:get-component-status', domain, componentId),
    getDomainSummary: (domain: string): Promise<DoctorDomainSummary> =>
      ipcRenderer.invoke('doctor:get-domain-summary', domain)
  },

  computerUse: {
    doctor: (): Promise<ComputerUseDoctorResult> => ipcRenderer.invoke('computer-use:doctor'),
    requestPermissions: (timeoutMs?: number): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke('computer-use:request-permissions', timeoutMs),
    testSetup: (): Promise<ComputerUseSetupReport> => ipcRenderer.invoke('computer-use:test-setup')
  },

  coreV2: {
    agentProfiles: {
      upsert: (input: UpsertAgentProfileInput): Promise<AgentProfile> =>
        ipcRenderer.invoke('core-v2:agent-profiles:upsert', input)
    },
    conversations: {
      resolveEnvelope: (
        input: ResolveConversationForEnvelopeInput
      ): Promise<ResolveConversationForEnvelopeResult> =>
        ipcRenderer.invoke('core-v2:conversations:resolve-envelope', input),
      get: (conversationId: string): Promise<Conversation | null> =>
        ipcRenderer.invoke('core-v2:conversations:get', conversationId),
      getLocalByThread: (
        threadId: string
      ): Promise<{ conversation: Conversation; binding: ConversationBinding } | null> =>
        ipcRenderer.invoke('core-v2:conversations:get-local-by-thread', threadId),
      listLocalThreadRows: (): Promise<ThreadRow[]> =>
        ipcRenderer.invoke('core-v2:conversations:list-local-thread-rows'),
      listWindows: (sourceKind?: 'local' | 'im' | 'all'): Promise<ConversationWindowProjection[]> =>
        ipcRenderer.invoke('core-v2:conversations:list-windows', sourceKind)
    },
    localThreads: {
      create: (
        workspacePath: string,
        model?: string | null,
        title?: string | null
      ): Promise<ThreadRow> =>
        ipcRenderer.invoke(
          'core-v2:local-threads:create',
          workspacePath,
          model ?? null,
          title ?? null
        ),
      update: (
        id: string,
        fields: { title?: string; started_at?: string; model?: string }
      ): Promise<ThreadRow> => ipcRenderer.invoke('core-v2:local-threads:update', id, fields),
      generateTitle: (input: {
        text: string
        imageCount?: number
      }): Promise<{ title: string; source: 'model' | 'fallback'; modelKey: string | null }> =>
        ipcRenderer.invoke('core-v2:local-threads:generate-title', input),
      delete: (id: string): Promise<void> => ipcRenderer.invoke('core-v2:local-threads:delete', id),
      getUserChatOrdinal: (threadId: string, messageId: string): Promise<number | null> =>
        ipcRenderer.invoke('core-v2:local-threads:get-user-chat-ordinal', threadId, messageId),
      pruneRuntimeAfter: (threadId: string, cutoffCreatedAt: string): Promise<void> =>
        ipcRenderer.invoke('core-v2:local-threads:prune-runtime-after', threadId, cutoffCreatedAt)
    },
    messages: {
      list: (conversationId: string): Promise<ConversationMessage[]> =>
        ipcRenderer.invoke('core-v2:messages:list', conversationId),
      search: (input: ConversationSearchInput): Promise<ConversationSearchResult> =>
        ipcRenderer.invoke('core-v2:messages:search', input),
      listConversations: (input: ListConversationsInput): Promise<ListConversationsResult> =>
        ipcRenderer.invoke('core-v2:messages:list-conversations', input),
      listConversationMessages: (input: ListConversationMessagesInput): Promise<ListConversationMessagesResult> =>
        ipcRenderer.invoke('core-v2:messages:list-conversation-messages', input),
      listAllConversationMessages: (input: ListAllConversationMessagesInput): Promise<ListAllConversationMessagesResult> =>
        ipcRenderer.invoke('core-v2:messages:list-all-messages', input)
    },
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
          agentTurnId?: string | null
          toolCallId?: string
          stepIndex?: number
          runtimeSequence?: number | null
          createdAt?: string | number | Date | null
        }
      ): Promise<MessageRow> =>
        ipcRenderer.invoke(
          'core-v2:local-messages:add',
          threadId,
          role,
          content,
          agentRunId,
          contentJson,
          options
        ),
      update: (
        id: string,
        content: string,
        contentJson?: ChatMessageContent | null
      ): Promise<MessageRow | null> =>
        ipcRenderer.invoke('core-v2:local-messages:update', id, content, contentJson),
      delete: (id: string): Promise<boolean> =>
        ipcRenderer.invoke('core-v2:local-messages:delete', id),
      setAgentEntryId: (id: string, agentEntryId: string): Promise<MessageRow | null> =>
        ipcRenderer.invoke('core-v2:local-messages:set-agent-entry-id', id, agentEntryId),
      updateRuntimeLink: (
        id: string,
        fields: {
          agentRunId?: string | null
          agentTurnId?: string | null
          runtimeSequence?: number | null
          createdAt?: string | number | Date | null
        }
      ): Promise<MessageRow | null> =>
        ipcRenderer.invoke('core-v2:local-messages:update-runtime-link', id, fields),
      prepareForRetry: (id: string): Promise<MessageRow | null> =>
        ipcRenderer.invoke('core-v2:local-messages:prepare-for-retry', id)
    },
    runs: {
      get: (runId: string): Promise<AgentRun | null> =>
        ipcRenderer.invoke('core-v2:runs:get', runId),
      list: (conversationId: string): Promise<AgentRun[]> =>
        ipcRenderer.invoke('core-v2:runs:list', conversationId)
    },
    interactions: {
      listPending: (conversationId?: string): Promise<InteractionCheckpoint[]> =>
        ipcRenderer.invoke('core-v2:interactions:list-pending', conversationId)
    },
    deliveries: {
      list: (conversationId: string): Promise<DeliveryRecord[]> =>
        ipcRenderer.invoke('core-v2:deliveries:list', conversationId)
    },
    threadPlans: {
      get: (threadId: string): Promise<ThreadPlanState | null> =>
        ipcRenderer.invoke('core-v2:thread-plans:get', threadId)
    },
    events: {
      list: (): Promise<EventLogEntry[]> => ipcRenderer.invoke('core-v2:events:list'),
      pruneOld: (retentionDays?: number): Promise<number> =>
        ipcRenderer.invoke('core-v2:events:prune-old', retentionDays),
      stats: (): Promise<{
        totalCount: number
        oldestEntry: string | null
        newestEntry: string | null
      }> => ipcRenderer.invoke('core-v2:events:stats')
    }
  },

  gateway: {
    start: (): Promise<{ success: true }> => ipcRenderer.invoke('gateway:start'),
    stop: (): Promise<{ success: true }> => ipcRenderer.invoke('gateway:stop'),
    restart: (): Promise<{ success: true }> => ipcRenderer.invoke('gateway:restart'),
    listTransportStatuses: (): Promise<TransportHostStatus[]> =>
      ipcRenderer.invoke('gateway:transports:list-statuses'),
    ingestInbound: (envelope: InboundEnvelope): Promise<EmbeddedGatewayInboundResult> =>
      ipcRenderer.invoke('gateway:ingest-inbound', envelope),
    submitLocalMessage: (
      input: SubmitDesktopLocalMessageInput
    ): Promise<EmbeddedGatewayLocalSubmitResult> =>
      ipcRenderer.invoke('gateway:desktop:submit-local-message', input),
    resetLocalConversation: (threadId: string): Promise<{ success: true }> =>
      ipcRenderer.invoke('gateway:desktop:reset-local-conversation', threadId),
    answerQuestion: (
      threadId: string,
      payload: QuestionAnswerPayload
    ): Promise<{ success: true } | { success: false; error: string }> =>
      ipcRenderer.invoke('gateway:desktop:answer-question', threadId, payload),
    answerQuestionnaire: (
      threadId: string,
      payload: QuestionnaireAnswerPayload
    ): Promise<{ success: true } | { success: false; error: string }> =>
      ipcRenderer.invoke('gateway:desktop:answer-questionnaire', threadId, payload),
    answerSecret: (
      threadId: string,
      payload: SecretAnswerPayload
    ): Promise<{ success: true } | { success: false; error: string }> =>
      ipcRenderer.invoke('gateway:desktop:answer-secret', threadId, payload),
    dispatchPendingDeliveries: (): Promise<DispatchDeliveryResult[]> =>
      ipcRenderer.invoke('gateway:deliveries:dispatch-pending'),
    onQuestion: (callback: (event: PendingQuestionEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: PendingQuestionEvent): void =>
        callback(value)
      ipcRenderer.on('agent:question', listener)
      return () => ipcRenderer.removeListener('agent:question', listener)
    },
    onQuestionnaire: (callback: (event: PendingQuestionnaireEvent) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        value: PendingQuestionnaireEvent
      ): void => callback(value)
      ipcRenderer.on('agent:questionnaire', listener)
      return () => ipcRenderer.removeListener('agent:questionnaire', listener)
    },
    onSecret: (callback: (event: PendingSecretPromptEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: PendingSecretPromptEvent): void =>
        callback(value)
      ipcRenderer.on('agent:secret', listener)
      return () => ipcRenderer.removeListener('agent:secret', listener)
    },
    onThreadPlan: (callback: (event: ThreadPlanEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: ThreadPlanEvent): void =>
        callback(value)
      ipcRenderer.on('agent:thread-plan', listener)
      return () => ipcRenderer.removeListener('agent:thread-plan', listener)
    },
    onSubagentPanel: (callback: (event: SubagentPanelEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: SubagentPanelEvent): void =>
        callback(value)
      ipcRenderer.on('agent:subagent-panel', listener)
      return () => ipcRenderer.removeListener('agent:subagent-panel', listener)
    }
  },

  widget: {
    registerHtml: (threadId: string, html: string): Promise<{ id: string; url: string }> =>
      ipcRenderer.invoke('widget:register-html', { threadId, html }),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('widget:delete', id),
    setInactive: (id: string, inactive: boolean): Promise<void> =>
      ipcRenderer.invoke('widget:set-inactive', id, inactive)
  },

  mcp: {
    marketplace: {
      list: (input?: {
        query?: string
        page?: number
        limit?: number
        cursor?: string
      }): Promise<{
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
      }> => ipcRenderer.invoke('mcp:marketplace:list', input)
    }
  },


  runtime: {
    prepareThread: (chatThreadId: string): Promise<{ success: true; chatThreadId: string }> =>
      ipcRenderer.invoke('runtime:prepare-thread', chatThreadId),
    abortThread: (chatThreadId: string): Promise<{ success: true }> =>
      ipcRenderer.invoke('runtime:abort-thread', chatThreadId),
    disposeThread: (chatThreadId: string): Promise<{ success: true }> =>
      ipcRenderer.invoke('runtime:dispose-thread', chatThreadId),
    setActiveThread: (chatThreadId?: string | null): Promise<{ success: true }> =>
      ipcRenderer.invoke('runtime:set-active-thread', chatThreadId),
    reload: async (
      chatThreadId?: string | null
    ): Promise<
      | {
          success: true
          chatThreadId: string | null
          reloaded: boolean
          deferred: boolean
          reason?: 'no-target' | 'not-initialized'
        }
      | { success: false; chatThreadId: string | null; error: string }
    > => await ipcRenderer.invoke('runtime:reload', chatThreadId),
    compactContext: (
      chatThreadId: string
    ): Promise<
      | {
          success: true
          changed: boolean
          revision: number
          summaryEntryId?: string | null
        }
      | { success: false; error: string }
    > => ipcRenderer.invoke('runtime:compact-context', chatThreadId),
    getUserMessagesForForking: (
      chatThreadId: string
    ): Promise<{ entryId: string; text: string }[]> =>
      ipcRenderer.invoke('runtime:get-user-messages-for-forking', chatThreadId),
    getQueuedMessages: (chatThreadId: string): Promise<AgentSubmittedQueueItem[]> =>
      ipcRenderer.invoke('runtime:get-queued-messages', chatThreadId),
    getThreadProjection: (chatThreadId: string): Promise<AgentThreadProjection> =>
      ipcRenderer.invoke('runtime:get-thread-projection', chatThreadId),
    getThreadWindow: (
      chatThreadId: string,
      options?: {
        limit?: number
        beforeCursor?: AgentThreadWindowCursor | null
        around?: AgentThreadWindowAroundTarget | null
      }
    ): Promise<AgentThreadWindowPage> =>
      ipcRenderer.invoke('runtime:get-thread-window', chatThreadId, options),
    getThinkingConfig: (chatThreadId: string): Promise<ThinkingConfigResponse> =>
      ipcRenderer.invoke('runtime:get-thinking-config', chatThreadId),
    setThinkingLevel: (
      chatThreadId: string,
      level: ThinkingLevel
    ): Promise<ThinkingConfigResponse> =>
      ipcRenderer.invoke('runtime:set-thinking-level', chatThreadId, level),
    listRuntimeEvents: (
      chatThreadId: string,
      agentRunId?: string
    ): Promise<ConversationEventRow[]> =>
      ipcRenderer.invoke('runtime:list-events', chatThreadId, agentRunId),
    recordRendererDebugEvent: (chatThreadId: string, event: ConversationEventRow): Promise<void> =>
      ipcRenderer.invoke('runtime:record-renderer-debug-event', chatThreadId, event),
    navigateTree: (
      chatThreadId: string,
      targetId: string,
      options?: {
        summarize?: boolean
        customInstructions?: string
        replaceInstructions?: boolean
        label?: string
      }
    ): Promise<{ cancelled: boolean; editorText?: string; aborted?: boolean }> =>
      ipcRenderer.invoke('runtime:navigate-tree', chatThreadId, targetId, options),
    notifyRunFinished: (payload: {
      threadId: string
      runId: string
      preview: string
    }): Promise<{ success: true; notificationShown: boolean }> =>
      ipcRenderer.invoke('runtime:notify-run-finished', payload),
    setRunFinishedBadgeCount: (count: number): Promise<{ success: true }> =>
      ipcRenderer.invoke('runtime:set-run-finished-badge-count', count),
    onEvent: (
      callback: (event: AgentAppEvent & { __chatThreadId?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        value: AgentAppEvent & { __chatThreadId?: string }
      ): void => callback(value)
      ipcRenderer.on('agent:event', listener)
      return () => ipcRenderer.removeListener('agent:event', listener)
    },
    onDebugEvent: (
      callback: (event: ConversationEventRow & { __chatThreadId?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        value: ConversationEventRow & { __chatThreadId?: string }
      ): void => callback(value)
      ipcRenderer.on('agent:debug-event', listener)
      return () => ipcRenderer.removeListener('agent:debug-event', listener)
    }
  },

  context: {
    getConfig: (): Promise<{ path: string; config: ContextEngineConfig }> =>
      ipcRenderer.invoke('context:get-config'),
    setConfig: (
      config: ContextEngineConfig
    ): Promise<{ path: string; config: ContextEngineConfig }> =>
      ipcRenderer.invoke('context:set-config', config),
    getThreadDebug: (chatThreadId: string): Promise<ContextThreadDebugSnapshot> =>
      ipcRenderer.invoke('context:get-thread-debug', chatThreadId)
  },

  e2e: {
    enabled: isE2EMode,
    agent: {
      simulateStream: (
        chatThreadId: string,
        input: { text: string; chunkSize?: number; delayMs?: number }
      ): Promise<{ success: true; runId: string; agentMessageId: string }> => {
        if (!isE2EMode) {
          return Promise.reject(new Error('E2E helpers are only available in PIAGENT_E2E mode'))
        }
        return ipcRenderer.invoke('e2e:agent:simulate-stream', {
          chatThreadId,
          text: input.text,
          chunkSize: input.chunkSize,
          delayMs: input.delayMs
        })
      }
    }
  },

  skills: {
    getRootDir: (): Promise<{
      rootDir: string
      defaultRootDir: string
      installRootDir: string
      extraDirs: string[]
    }> => ipcRenderer.invoke('skills:get-root-dir'),
    openFolder: (): Promise<{
      success: boolean
      rootDir: string
      defaultRootDir: string
      installRootDir: string
      extraDirs: string[]
    }> => ipcRenderer.invoke('skills:open-folder'),
    addExtraDir: (
      dir: string
    ): Promise<
      | {
          success: true
          rootDir: string
          defaultRootDir: string
          installRootDir: string
          extraDirs: string[]
        }
      | { success: false; error: string }
    > => ipcRenderer.invoke('skills:add-extra-dir', dir),
    removeExtraDir: (
      dir: string
    ): Promise<{
      success: true
      rootDir: string
      defaultRootDir: string
      installRootDir: string
      extraDirs: string[]
    }> => ipcRenderer.invoke('skills:remove-extra-dir', dir),
    list: (): Promise<{
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
    }> => ipcRenderer.invoke('skills:list'),
    setEnabled: (name: string, enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('skills:set-enabled', name, enabled),
    install: (
      source: string,
      options?: { force?: boolean; ref?: string }
    ): Promise<
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
    > => ipcRenderer.invoke('skills:install', source, options),
    read: (
      name: string
    ): Promise<{ success: boolean; path?: string; content?: string; error?: string }> =>
      ipcRenderer.invoke('skills:read', name),
    delete: (name: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('skills:delete', name)
  },

  workspace: {
    getTempRoot: (): Promise<{ rootDir: string }> => ipcRenderer.invoke('workspace:get-temp-root'),
    openTempRoot: (): Promise<{ success: boolean; rootDir: string }> =>
      ipcRenderer.invoke('workspace:open-temp-root'),
    createTemp: (): Promise<{ workspacePath: string; rootDir: string }> =>
      ipcRenderer.invoke('workspace:create-temp'),
    deleteDirectory: (workspacePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workspace:delete-directory', workspacePath)
  },

  knowledge: {
    search: (input: any): Promise<any> => ipcRenderer.invoke('knowledge:search', input),
    trace: (input: any): Promise<any> => ipcRenderer.invoke('knowledge:trace', input),
    getSettings: (): Promise<any> => ipcRenderer.invoke('knowledge:settings:get'),
    setSettings: (patch: any): Promise<any> => ipcRenderer.invoke('knowledge:settings:set', patch),
    getThreadCapture: (threadId: string): Promise<any> => ipcRenderer.invoke('knowledge:thread-capture:get', threadId),
    setThreadCapture: (threadId: string, enabled: boolean): Promise<any> => ipcRenderer.invoke('knowledge:thread-capture:set', threadId, enabled),
    stats: (): Promise<any> => ipcRenderer.invoke('knowledge:stats'),
    listEntities: (limit?: number): Promise<any> => ipcRenderer.invoke('knowledge:entities:list', limit),
    listActiveTasks: (limit?: number): Promise<any> => ipcRenderer.invoke('knowledge:active-tasks:list', limit),
    finalizeActiveTask: (taskId: string): Promise<any> => ipcRenderer.invoke('knowledge:active-task:finalize', taskId),
    discardActiveTask: (taskId: string): Promise<any> => ipcRenderer.invoke('knowledge:active-task:discard', taskId),
    getEntity: (entityId: string): Promise<any> => ipcRenderer.invoke('knowledge:entity:get', entityId),
    listAllClaims: (options?: { limit?: number; offset?: number; from?: string; to?: string; query?: string }): Promise<any> => ipcRenderer.invoke('knowledge:claims:list-all', options),
    listAllPatterns: (options?: { limit?: number; offset?: number; from?: string; to?: string; query?: string }): Promise<any> => ipcRenderer.invoke('knowledge:patterns:list-all', options),
    listAllProfiles: (options?: { limit?: number; offset?: number; from?: string; to?: string; query?: string }): Promise<any> => ipcRenderer.invoke('knowledge:profiles:list-all', options),
    deleteClaim: (claimId: string): Promise<any> => ipcRenderer.invoke('knowledge:claim:delete', claimId),
    deleteReflection: (reflectionId: string): Promise<any> => ipcRenderer.invoke('knowledge:reflection:delete', reflectionId),
    deleteEntity: (entityId: string): Promise<any> => ipcRenderer.invoke('knowledge:entity:delete', entityId),
    runDream: (options?: any): Promise<any> => ipcRenderer.invoke('knowledge:dream:run', options),
    embeddingModels: {
      list: (): Promise<any> => ipcRenderer.invoke('knowledge:embedding-models:list'),
      download: (key: string): Promise<any> => ipcRenderer.invoke('knowledge:embedding-models:download', key),
      openCacheDir: (key: string): Promise<any> => ipcRenderer.invoke('knowledge:embedding-models:open-cache-dir', key),
      onDownloadProgress: (callback: (event: any) => void): (() => void) => {
        const listener = (_e: Electron.IpcRendererEvent, progress: any) => callback(progress)
        ipcRenderer.on('knowledge:embedding-models:download-progress', listener)
        return () => ipcRenderer.removeListener('knowledge:embedding-models:download-progress', listener)
      }
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
