<template>
  <div
    class="window-shell h-screen w-full overflow-hidden relative bg-(--theme-bg-main)"
    data-testid="app-shell"
  >
    <!-- 1. Runtime Inspector Window -->
    <div v-if="isRuntimeInspectorPage" class="h-full w-full bg-slate-50">
      <RuntimeDebugPanel
        :is-open="true"
        :standalone="true"
        :thread-id="currentRuntimeDebugThreadId ?? null"
        :events="runtimeDebugEvents"
        :loading="runtimeDebugLoading"
        :context-snapshot="runtimeContextDebug"
        :context-loading="runtimeContextLoading"
        :context-compacting="runtimeContextCompacting"
        :run-options="runtimeDebugRunOptions"
        :selected-run-id="runtimeDebugSelectedRunId"
        @close="closeWindow"
        @refresh="refreshActiveRuntimeDebug"
        @compact-context="compactActiveRuntimeContext"
        @open-context-settings="openContextSettings"
        @select-run="selectRuntimeDebugRun"
      />
    </div>

    <!-- 2. Settings Page -->
    <div v-else-if="isSettingsPage" class="h-full w-full">
      <SettingsWindow
        :is-open="true"
        :is-standalone="true"
        :hide-header="true"
        @close="closeWindow"
      />
    </div>

    <!-- 3. Knowledge Manager Window -->
    <div v-else-if="isKnowledgeManagerPage" class="h-full w-full">
      <KnowledgeSettings mode="manager" @close="closeWindow" />
    </div>

    <!-- 4. Onboarding Page (No Workspace) -->
    <Onboarding
      v-else-if="workspaces.length === 0"
      @action="createNewThread"
      @open-settings="openSettings"
    />

    <!-- 4. Main App Interface -->
    <div v-else class="flex flex-col h-full w-full text-gray-800 overflow-hidden">
      <AppHeader
        :is-sidebar-visible="isSidebarVisible"
        :sidebar-width="sidebarWidth"
        :is-sidebar-resize-active="isSidebarResizeActive"
        :message-count="messages.length"
        :workspace-path="currentWorkspacePath"
        :runtime-status-tone="runtimeStatus.tone"
        :is-runtime-debug-visible="isRuntimeDebugOpen"
        @toggle-sidebar="toggleSidebar"
        @toggle-runtime-debug="toggleRuntimeDebug"
        @open-search="openSearchPalette"
        @create-thread="createNewThread"
        @create-temp-thread="createTemporaryThread"
        @create-new-workspace-thread="createNewThread"
        @open-workspace-folder="openWorkspaceFolder"
      />

      <!-- Body: sidebar + main content -->
      <div class="flex flex-1 overflow-y-hidden overflow-x-visible bg-(--theme-bg-main)">
        <AppSidebar
          :is-sidebar-visible="isSidebarVisible"
          :sidebar-width="sidebarWidth"
          :threads="threads"
          :workspaces="workspaces"
          :active-thread-id="activeThread?.id ?? null"
          :current-workspace-path="currentWorkspacePath"
          :streaming-by-thread-id="streamingByThreadId"
          :run-finished-indicator-by-thread-id="runFinishedIndicatorByThreadId"
          :has-update="hasUpdate"
          @update:sidebar-width="(value) => (sidebarWidth = value)"
          @update:resize-active="(value) => (isSidebarResizeActive = value)"
          @select-thread="selectThreadById"
          @select-workspace="selectWorkspaceByPath"
          @delete-thread="deleteThreadById"
          @delete-workspace="deleteWorkspaceByPath"
          @open-settings="openSettings"
          @create-thread-in-workspace="createThreadInWorkspace"
          @create-thread="createNewThread"
          @create-temp-thread="createTemporaryThread"
        />

        <div
          class="flex min-h-0 min-w-0 flex-1"
          @pointerdown.capture="clearActiveRunFinishedIndicator"
        >
          <KeepAlive :max="3">
            <RightArea
              :key="activeThread?.id || 'none'"
              ref="rightAreaRef"
              :messages="messages"
              :has-active-thread="Boolean(activeThread)"
              :has-any-workspace="workspaces.length > 0"
              :is-streaming="isStreaming"
              :can-abort="canAbortCurrentRun"
              :input-text="inputText"
              :input-history-entries="activeInputHistoryEntries"
              :attachments="composerAttachments"
              :pending-queue="pendingQueue"
              :queue-runtime-state="queueRuntimeState"
              :queue-dispatch-policy="queueDispatchPolicy"
              :has-more-history="activeHasMoreHistory"
              :history-loading="activeHistoryLoading"
              :thread-id="activeThread?.id ?? null"
              :workspace-path="currentWorkspacePath"
              :model-label="runtimeModelLabel"
              :model-options="runtimeModelOptions"
              :selected-model-id="selectedRuntimeModel"
              :thinking-level="activeThinkingLevel"
              :thinking-levels="activeThinkingLevels"
              :thinking-supported="activeThinkingSupported"
              :supports-image-input="currentModelSupportsImageInput"
              :context-used-tokens="runtimeContextUsedTokens"
              :context-total-tokens="runtimeContextTotalTokens"
              :is-runtime-debug-open="isRuntimeDebugOpen"
              :runtime-debug-thread-id="activeThread?.id ?? null"
              :runtime-debug-events="runtimeDebugEvents"
              :runtime-debug-loading="runtimeDebugLoading"
              :runtime-debug-run-options="runtimeDebugRunOptions"
              :runtime-debug-selected-run-id="runtimeDebugSelectedRunId"
              :active-plan-state="activeThreadPlanState"
              :hidden-plan-revision="activeThreadHiddenPlanRevision"
              :active-subagent-panel-state="activeSubagentPanelState"
              :hidden-subagent-panel-revision="activeThreadHiddenSubagentPanelRevision"
              :active-question="
                activeThread
                  ? (pendingQuestionsByThreadId.get(activeThread.id)?.question ?? null)
                  : null
              "
              :active-questionnaire="
                activeThread ? (pendingQuestionnairesByThreadId.get(activeThread.id) ?? null) : null
              "
              :active-secret="
                activeThread
                  ? (pendingSecretsByThreadId.get(activeThread.id)?.secret ?? null)
                  : null
              "
              :edit-mode="Boolean(editingMessage)"
              edit-hint="编辑"
              @update:input-text="(v) => (inputText = v)"
              @update:attachments="(v) => (composerAttachments = v)"
              @select-model="selectRuntimeModel"
              @select-thinking-level="selectThinkingLevel"
              @send="sendMessage"
              @cancel="cancelCurrentProcessing"
              @drop-images="onDropImages"
              @message-regenerate="regenerateFromUserMessage"
              @message-start-edit="startEditUserMessage"
              @message-delete="deleteUserMessage"
              @message-widget-action="sendWidgetMessage($event.text)"
              @message-transport-setup-regenerate="regenerateTransportSetupQr"
              @message-widget-visible="hydrateVisibleWidget"
              @queue-dispatch-item="dispatchActiveQueuedItem"
              @queue-dispatch-all="dispatchAllActiveQueuedItems"
              @queue-delete-item="deleteActiveQueuedItem"
              @load-older="loadActiveThreadOlderHistory"
              @widget-send="sendWidgetMessage"
              @question-answer-option="answerQuestionWithOption"
              @questionnaire-answer-option="answerQuestionnaireWithOption"
              @secret-submit="submitSecretValue"
              @cancel-edit="cancelEditUserMessage"
              @close-runtime-debug="closeRuntimeDebug"
              @runtime-debug-refresh="refreshActiveRuntimeDebug"
              @runtime-debug-select-run="selectRuntimeDebugRun"
              @hide-thread-plan="hideActiveThreadPlanPanel"
              @hide-subagent-panel="hideActiveSubagentPanel"
              @create-thread="handleRightAreaCreateThread"
            />
          </KeepAlive>
        </div>
      </div>
    </div>

    <GlobalSearchPalette
      :open="isSearchPaletteOpen"
      :current-workspace-path="currentWorkspacePath"
      :current-thread-id="activeThread?.id ?? null"
      @close="closeSearchPalette"
      @open-result="openSearchResult"
    />

    <GlobalDialogHost />
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed, reactive, watch } from 'vue'
import SettingsWindow from './windows/settings/SettingsWindow.vue'
import KnowledgeSettings from './windows/settings/components/KnowledgeSettings.vue'
import AppHeader from './components/layout/AppHeader.vue'
import AppSidebar from './components/layout/AppSidebar.vue'
import Onboarding from './components/layout/Onboarding.vue'
import RightArea from './components/layout/RightArea.vue'
import RuntimeDebugPanel from './components/debug/RuntimeDebugPanel.vue'
import GlobalSearchPalette from './components/search/GlobalSearchPalette.vue'
import GlobalDialogHost from './components/common/GlobalDialogHost.vue'
import { globalDialog } from './utils/dialog'
import type {
  AgentRun,
  AgentTurn,
  ChatWidget,
  ChatMessage
} from './components/chat/types'
import type { ConversationSearchResultItem } from '../../main/core-v2/domain'
import type { AgentAppEvent, AgentThreadProjection } from '@shared/agent-runtime'
import type { TransportPluginAccountSetupEvent } from '@shared/transport-plugins'
import type { WorkspaceRow, ThreadRow } from '../../preload/db-types'
import {
  getAssistantDisplayContentForRun,
  getAssistantDisplayContentForTurn,
  getRunTurnById,
  projectRunToChatRun,
  shouldCreateAssistantMessageForTurn,
  syncChatRunFromProjection,
  applyTransportAccountSetupEventToRuns,
  ensureAssistantTurnMessageIn,
  findAssistantTurnMessageIn,
  turnHasVisibleAssistantOutput
} from './utils/app-runtime'
import { resolveInlineWidgetFromMessage } from './utils/inline-widget'
import { usePendingInteractionState } from './utils/app-pending-state'
import type { PendingQuestionEvent } from '@shared/question-tool'
import type { PendingQuestionnaireEvent } from '@shared/questionnaire-tool'
import type { PendingSecretPromptEvent } from '@shared/secret-input'
import type { ThreadPlanEvent } from '@shared/thread-plan'
import type { SubagentPanelEvent } from '@shared/subagent-panel'
import type { WorkspaceSandboxPermissionPrompt } from '@shared/workspace-sandbox-permission'
import {
  appendChatInputHistoryEntry,
  createChatInputHistoryStore,
  getChatInputHistoryEntries,
  removeChatInputHistoryThread,
  type ChatInputHistoryStore
} from './utils/chat-input-history'
import { useRuntimeDebugState } from './utils/app-runtime-debug'
import { useRuntimeModelState } from './utils/app-runtime-model'
import { useThreadWindowState } from './utils/app-thread-window'
import { useQueueDispatcher } from './utils/app-queue-dispatcher'
import {
  clearRunFinishedIndicator,
  markRunFinishedIndicatorIfNeeded,
  type RunFinishedIndicatorMap
} from './utils/app-run-finished-indicators'
import {
  confirmTextOnlyFallback,
  useComposerActions,
  type EditingMessageState
} from './utils/app-composer-actions'
import { createRuntimeEventBridge } from './utils/app-runtime-event-bridge'
import {
  applyContextCompactionEventToMessages,
  isContextCompactionEvent
} from './utils/context-compaction-messages'

// ── 路由 ─────────────────────────────────────────────────────────
const getHashRoute = (): string => window.location.hash.split('?')[0]
const getHashParam = (key: string): string | null => {
  const hash = window.location.hash
  if (!hash.includes('?')) return null
  return new URLSearchParams(hash.split('?')[1]).get(key)
}

const isSettingsPage = ref(getHashRoute() === '#settings')
const isKnowledgeManagerPage = ref(getHashRoute() === '#knowledge-manager')
const isRuntimeInspectorPage = ref(getHashRoute() === '#runtime-inspector')
const runtimeInspectorThreadId = ref<string | null>(getHashParam('threadId'))
window.addEventListener('hashchange', () => {
  isSettingsPage.value = getHashRoute() === '#settings'
  isKnowledgeManagerPage.value = getHashRoute() === '#knowledge-manager'
  isRuntimeInspectorPage.value = getHashRoute() === '#runtime-inspector'
  runtimeInspectorThreadId.value = getHashParam('threadId')
})

const closeWindow = (): void => window.close()

// ── 侧边栏 ────────────────────────────────────────────────────────
const isSidebarVisible = ref(true)
const sidebarWidth = ref(260)
const isSidebarResizeActive = ref(false)
const isSearchPaletteOpen = ref(false)
const toggleSidebar = (): void => {
  isSidebarVisible.value = !isSidebarVisible.value
}

const openSearchPalette = (): void => {
  isSearchPaletteOpen.value = true
}

const closeSearchPalette = (): void => {
  isSearchPaletteOpen.value = false
}

// ── 线程状态 ──────────────────────────────────────────────────────
const threads = ref<ThreadRow[]>([])
const workspaces = ref<WorkspaceRow[]>([])
const activeThread = ref<ThreadRow | null>(null)
const messages = ref<ChatMessage[]>([])
const inputText = ref('')
const composerAttachments = ref<File[]>([])
const chatInputHistoryStore = ref<ChatInputHistoryStore>(createChatInputHistoryStore())
const streamingByThreadId = ref<Record<string, boolean>>({})
const runFinishedIndicatorByThreadId = ref<RunFinishedIndicatorMap>({})
const agentRunsByThreadId = new Map<string, Map<string, AgentRun>>()
const activeRunByThreadId = new Map<string, AgentRun>()
const widgetHydrationPendingKeys = new Set<string>()
const {
  pendingQuestionsByThreadId,
  pendingQuestionnairesByThreadId,
  pendingSecretsByThreadId,
  threadPlanStateByThreadId,
  subagentPanelStateByThreadId,
  hiddenThreadPlanRevisionByThreadId,
  hiddenSubagentPanelRevisionByThreadId,
  getPendingQuestion,
  getPendingQuestionnaire,
  getPendingSecret,
  activeThreadPlanState,
  activeThreadHiddenPlanRevision,
  activeSubagentPanelState,
  activeThreadHiddenSubagentPanelRevision,
  setPendingQuestionForThread,
  clearPendingQuestionForThread,
  setPendingQuestionnaireForThread,
  clearPendingQuestionnaireForThread,
  setPendingSecretForThread,
  clearPendingSecretForThread,
  setThreadPlanStateForThread,
  clearThreadPlanStateForThread,
  hideActiveThreadPlanPanel,
  setSubagentPanelStateForThread,
  clearSubagentPanelStateForThread,
  hideActiveSubagentPanel
} = usePendingInteractionState(activeThread)
const threadInputCache = new Map<string, { text: string; attachments: File[] }>()
const rightAreaRef = ref<InstanceType<typeof RightArea> | null>(null)
let scrollToBottomRafId: number | null = null
const hasUpdate = ref(false)
const {
  runtimeModelOptions,
  selectedRuntimeModel,
  thinkingLevelByThreadId,
  thinkingLevelsByThreadId,
  thinkingSupportByThreadId,
  runtimeStatus,
  runtimeBinding,
  currentModelSupportsImageInput,
  runtimeModelLabel,
  activeThinkingLevel,
  activeThinkingLevels,
  activeThinkingSupported,
  selectedContextWindowTokens,
  estimatedContextUsedTokens,
  applyFallbackThinkingConfig,
  buildRuntimeModels,
  applyThreadModelSelection,
  resolveWorkspaceModel,
  selectRuntimeModel,
  selectThinkingLevel,
  refreshRuntimeModels
} = useRuntimeModelState({
  activeThread,
  threads,
  messages,
  inputText
})

const recordChatInputHistory = (threadId: string | null | undefined, text: string): void => {
  chatInputHistoryStore.value = appendChatInputHistoryEntry(
    chatInputHistoryStore.value,
    threadId,
    text
  )
}

const activeInputHistoryEntries = computed(() =>
  getChatInputHistoryEntries(chatInputHistoryStore.value, activeThread.value?.id)
)

const loadThreadPlanState = async (threadId: string): Promise<void> => {
  if (!threadId) return
  try {
    const state = await window.api.coreV2.threadPlans.get(threadId)
    if (state) setThreadPlanStateForThread(state)
    else clearThreadPlanStateForThread(threadId)
  } catch (err) {
    console.error('Load thread plan state failed', err)
  }
}

const getAgentRunMap = (threadId: string): Map<string, AgentRun> => {
  const existing = agentRunsByThreadId.get(threadId)
  if (existing) return existing
  const created = new Map<string, AgentRun>()
  agentRunsByThreadId.set(threadId, created)
  return created
}

const setActiveRun = (threadId: string, run: AgentRun): void => {
  activeRunByThreadId.set(threadId, run)
  const runs = getAgentRunMap(threadId)
  runs.set(run.id, run)
}

const getActiveRun = (threadId: string): AgentRun | null => {
  return activeRunByThreadId.get(threadId) ?? null
}

const isStreaming = computed<boolean>((): boolean => {
  const id = activeThread.value?.id
  if (!id) return false
  return Boolean(streamingByThreadId.value[id])
})

const setThreadStreaming = (threadId: string, value: boolean): void => {
  if (!threadId) return
  if (Boolean(streamingByThreadId.value[threadId]) === value) return
  streamingByThreadId.value = { ...streamingByThreadId.value, [threadId]: value }
}

const syncRunFinishedBadgeCount = (count: number): void => {
  if (isSettingsPage.value || isKnowledgeManagerPage.value || isRuntimeInspectorPage.value) return
  void window.api.runtime.setRunFinishedBadgeCount(count).catch((error) => {
    console.error('Sync run finished badge count failed', error)
  })
}

const markThreadRunFinishedIfNeeded = (threadId: string, notificationShown: boolean): void => {
  runFinishedIndicatorByThreadId.value = markRunFinishedIndicatorIfNeeded(
    runFinishedIndicatorByThreadId.value,
    {
      finishedThreadId: threadId,
      activeThreadId: activeThread.value?.id ?? null,
      notificationShown
    }
  )
}

const clearRunFinishedIndicatorForThread = (threadId?: string | null): void => {
  runFinishedIndicatorByThreadId.value = clearRunFinishedIndicator(
    runFinishedIndicatorByThreadId.value,
    threadId
  )
}

const clearActiveRunFinishedIndicator = (): void => {
  clearRunFinishedIndicatorForThread(activeThread.value?.id ?? null)
}

const getThreadRowById = (threadId: string): ThreadRow | null => {
  if (activeThread.value?.id === threadId) return activeThread.value
  return threads.value.find((thread) => thread.id === threadId) ?? null
}

const {
  queueControllersByThreadId,
  pendingQueue,
  queueRuntimeState,
  queueDispatchPolicy,
  canAbortCurrentRun,
  ensureQueueController,
  removeQueueItem,
  removeRuntimeQueueItemByText,
  syncRuntimeQueue,
  enqueuePendingMessage,
  dispatchMessageNow,
  dispatchActiveQueuedItem,
  dispatchAllActiveQueuedItems,
  deleteActiveQueuedItem,
  onRunSettled,
  cancelCurrentProcessing
} = useQueueDispatcher({
  activeThread,
  messages,
  inputText,
  composerAttachments,
  currentModelSupportsImageInput,
  runtimeStatus,
  runtimeBinding,
  activeRunByThreadId,
  getAgentRunMap,
  getThreadRowById,
  ensureThreadTitleFromText: (...args) => ensureThreadTitleFromText(...args),
  ensureThreadStarted: (...args) => ensureThreadStarted(...args),
  ensureMessageBuffer: (threadId) => ensureMessageBuffer(threadId),
  setThreadStreaming,
  scrollToBottom: (options) => scrollToBottom(options),
  loadLatestThreadWindow: (...args) => loadLatestThreadWindow(...args),
  confirmTextOnlyFallback,
  isStreaming,
  onRunFinishedNotificationState: ({ threadId, notificationShown }) => {
    markThreadRunFinishedIfNeeded(threadId, notificationShown)
  }
})

const patchThreadRow = (threadId: string, patch: Partial<ThreadRow>): void => {
  threads.value = threads.value.map((thread) =>
    thread.id === threadId ? { ...thread, ...patch } : thread
  )
  if (activeThread.value?.id === threadId) {
    activeThread.value = { ...activeThread.value, ...patch }
  }
}

const resetActiveThreadState = (workspacePath = ''): void => {
  activeThread.value = null
  currentWorkspacePath.value = workspacePath
  messages.value = []
  inputText.value = ''
  composerAttachments.value = []
  editingMessage.value = null
  runtimeBinding.value = null
  runtimeStatus.value = { text: '', tone: 'idle' }
  rightAreaRef.value?.clearQuestion?.()
  rightAreaRef.value?.clearQuestionnaire?.()
}

const editingMessage = ref<EditingMessageState>(null)

// 当前工作目录（对话未开始时可改）
const currentWorkspacePath = ref<string>('')

const upsertProjectedRun = (
  threadId: string,
  projection: AgentThreadProjection['runs'][number]
): AgentRun => {
  const runs = getAgentRunMap(threadId)
  const existing = runs.get(projection.agentRunId)
  if (existing) {
    syncChatRunFromProjection(existing, projection)
    if (projection.status === 'running') activeRunByThreadId.set(threadId, existing)
    return existing
  }
  const created = reactive(projectRunToChatRun(projection))
  runs.set(created.id, created)
  if (projection.status === 'running') activeRunByThreadId.set(threadId, created)
  return created
}

const {
  runtimeLiveDebugEventsByThreadId,
  runtimeContextDebugByThreadId,
  runtimeDebugRefreshTimersByThreadId,
  isRuntimeDebugOpen,
  runtimeDebugLoadingByThreadId,
  runtimeContextLoadingByThreadId,
  runtimeContextCompactingByThreadId,
  runtimeDebugRunFilterByThreadId,
  currentRuntimeDebugThreadId,
  isRuntimeDebugVisible,
  runtimeContextDebug,
  runtimeContextLoading,
  runtimeContextCompacting,
  runtimeDebugEvents,
  runtimeDebugLoading,
  runtimeDebugSelectedRunId,
  runtimeDebugRunOptions,
  getRuntimeDebugSelectedRunId,
  refreshRuntimeDebugEvents,
  refreshRuntimeContextDebug,
  appendRuntimeLiveDebugEvent,
  createRuntimeLiveEventFromAppEvent,
  emitRendererDebugEvent,
  clearRuntimeDebugRefreshTimer,
  scheduleRuntimeDebugRefresh,
  toggleRuntimeDebug,
  closeRuntimeDebug,
  refreshActiveRuntimeDebug,
  selectRuntimeDebugRun,
  compactActiveRuntimeContext
} = useRuntimeDebugState({
  activeThread,
  isRuntimeInspectorPage,
  runtimeInspectorThreadId,
  getAgentRunMap,
  upsertProjectedRun
})

const normalizeTokenCount = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.floor(value)
}

const runtimeContextUsedTokens = computed(() => {
  const pressure = runtimeContextDebug.value?.pressure
  return (
    normalizeTokenCount(pressure?.currentContextTokens) ??
    normalizeTokenCount(pressure?.estimatedPromptTokens) ??
    estimatedContextUsedTokens.value
  )
})

const runtimeContextTotalTokens = computed(() => {
  return (
    normalizeTokenCount(runtimeContextDebug.value?.managedThread.contextWindow) ??
    selectedContextWindowTokens.value
  )
})

const shouldRefreshContextUsageForEvent = (event: AgentAppEvent): boolean =>
  event.type === 'agent.message.finished' ||
  event.type === 'agent.run.finished' ||
  event.type === 'agent.run.failed' ||
  event.type === 'agent.run.aborted' ||
  event.type === 'agent.thread.compacted' ||
  event.type === 'agent.thread.started' ||
  event.type === 'agent.thread.switched' ||
  event.type === 'agent.thread.forked'

const getRuntimeEventThreadId = (
  event: AgentAppEvent & { __chatThreadId?: string }
): string | null =>
  event.__chatThreadId ||
  event.threadId ||
  runtimeBinding.value?.chatThreadId ||
  activeThread.value?.id ||
  null

const {
  messageCacheByThreadId,
  hasMoreHistoryByThreadId,
  historyLoadingByThreadId,
  oldestCursorByThreadId,
  threadWindowInitializedByThreadId,
  activeHasMoreHistory,
  activeHistoryLoading,
  ensureMessageBuffer,
  loadLatestThreadWindow,
  loadThreadWindowAround,
  loadOlderThreadWindow
} = useThreadWindowState({
  activeThread,
  messages,
  streamingByThreadId,
  agentRunsByThreadId,
  activeRunByThreadId,
  rightAreaRef,
  ensureQueueController,
  setThreadStreaming,
  emitRendererDebugEvent
})

const ensureAssistantRunMessage = (run: AgentRun | null, allowCreate = true): ChatMessage | null =>
  ensureAssistantTurnMessageIn(messages.value, run, run?.turns.at(-1) ?? null, allowCreate)

const {
  sendWidgetMessage,
  regenerateTransportSetupQr,
  answerQuestionWithOption,
  answerQuestionnaireWithOption,
  submitSecretValue,
  sendMessage,
  deleteUserMessage,
  startEditUserMessage,
  cancelEditUserMessage,
  regenerateFromUserMessage,
  onDropImages
} = useComposerActions({
  activeThread,
  messages,
  inputText,
  composerAttachments,
  editingMessage,
  rightAreaRef,
  currentModelSupportsImageInput,
  isStreaming,
  runtimeStatus,
  runtimeBinding,
  activeRunByThreadId,
  getPendingQuestion,
  getPendingQuestionnaire,
  getPendingSecret,
  clearPendingQuestionForThread,
  clearPendingSecretForThread,
  getActiveRun,
  ensureQueueController,
  enqueuePendingMessage,
  dispatchMessageNow,
  ensureAssistantRunMessage,
  setThreadStreaming,
  scrollToBottom: (options) => scrollToBottom(options),
  loadLatestThreadWindow,
  loadThreadPlanState,
  recordChatInputHistory
})

const syncAssistantTurnMessage = (
  list: ChatMessage[],
  run: AgentRun | null,
  turn: AgentTurn | null,
  allowCreate = true
): ChatMessage | null => {
  const assistant = ensureAssistantTurnMessageIn(list, run, turn, allowCreate)
  if (!assistant) return null
  assistant.run = run ?? undefined
  assistant.agentRunId = run?.id
  assistant.agentTurnId = turn?.id
  assistant.content = getAssistantDisplayContentForTurn(run, turn)
  assistant.isPending = Boolean(
    run?.status === 'running' &&
    turn?.status === 'running' &&
    !assistant.content.trim() &&
    !turnHasVisibleAssistantOutput(turn)
  )
  return assistant
}

const syncAssistantMessagesForRun = (
  list: ChatMessage[],
  run: AgentRun | null,
  allowCreate = true
): void => {
  if (!run) return
  for (const turn of run.turns) {
    const shouldCreate = allowCreate && shouldCreateAssistantMessageForTurn(turn)
    syncAssistantTurnMessage(list, run, turn, shouldCreate)
  }
}

const applyInlineWidgetToAssistantMessage = (
  list: ChatMessage[],
  run: AgentRun | null,
  turnId: string | null,
  widget: ChatWidget
): void => {
  const assistant = ensureAssistantTurnMessageIn(list, run, getRunTurnById(run, turnId), true)
  if (!assistant) return
  assistant.widget = widget
}

const finalizeAssistantMessageForThread = async (
  _threadId: string,
  list: ChatMessage[],
  run: AgentRun | null
): Promise<void> => {
  if (!run) return

  const resolveAssistantTurnCreatedAt = (turn: AgentTurn | null): number | undefined => {
    if (!turn) return undefined
    if (typeof turn.endedAt === 'number') return turn.endedAt

    let latestTimelineAt: number | undefined
    for (const item of turn.timelineItems) {
      if (item.kind !== 'text' && item.kind !== 'thinking') continue
      const candidate =
        typeof item.endedAt === 'number'
          ? item.endedAt
          : typeof item.startedAt === 'number'
            ? item.startedAt
            : undefined
      if (candidate == null) continue
      latestTimelineAt =
        latestTimelineAt == null ? candidate : Math.max(latestTimelineAt, candidate)
    }

    if (latestTimelineAt != null) return latestTimelineAt
    if (typeof turn.startedAt === 'number') return turn.startedAt
    if (typeof run.endedAt === 'number') return run.endedAt
    return run.startedAt
  }

  for (const turn of run.turns) {
    const assistant =
      syncAssistantTurnMessage(
        list,
        run,
        turn,
        turnHasVisibleAssistantOutput(turn) || Boolean(turn.text.trim())
      ) ?? findAssistantTurnMessageIn(list, run, turn.id ?? null)
    if (!assistant) continue

    if (!assistant.content.trim() && !turnHasVisibleAssistantOutput(turn)) {
      const idx = list.lastIndexOf(assistant)
      if (idx >= 0 && !assistant.id) list.splice(idx, 1)
      continue
    }
    assistant.isPending = false
    assistant.createdAt =
      assistant.createdAt ??
      new Date(resolveAssistantTurnCreatedAt(turn) ?? run.startedAt).toISOString()
  }

  if (run.turns.length === 0) {
    const assistant = ensureAssistantTurnMessageIn(list, run, null, true)
    if (!assistant) return
    assistant.isPending = false
    assistant.run = run
    assistant.agentRunId = run.id
    if (!assistant.content.trim()) assistant.content = getAssistantDisplayContentForRun(run)
    if (!assistant.content.trim()) return
    assistant.createdAt =
      assistant.createdAt ?? new Date(run.endedAt ?? run.startedAt).toISOString()
  }
}

const buildWidgetHydrationKey = (threadId: string, message: ChatMessage, index: number): string =>
  `${threadId}:${message.id ?? message.agentRunId ?? index}`

const hydrateInlineWidgetMessage = async (
  threadId: string,
  message: ChatMessage,
  index: number
): Promise<void> => {
  const widget = resolveInlineWidgetFromMessage(message)
  if (!widget || widget.placement !== 'inline' || widget.kind !== 'html' || !widget.html) return
  message.widget = widget
  if (widget.url) return

  const hydrationKey = buildWidgetHydrationKey(threadId, message, index)
  if (widgetHydrationPendingKeys.has(hydrationKey)) return
  widgetHydrationPendingKeys.add(hydrationKey)

  try {
    const registered = await window.api.widget.registerHtml(threadId, widget.html)
    message.widget = {
      ...widget,
      url: registered.url,
      widgetId: registered.id
    }
  } catch (error) {
    console.error('Failed to hydrate inline widget on visibility', error)
  } finally {
    widgetHydrationPendingKeys.delete(hydrationKey)
  }
}

const hydrateVisibleWidget = ({ id, index }: { id?: string; index: number }): void => {
  const threadId = activeThread.value?.id
  if (!threadId) return
  const message = messages.value[index]
  if (!message) return
  if (id && message.id && message.id !== id) return
  void hydrateInlineWidgetMessage(threadId, message, index)
}

const ensureThreadStarted = async (thread: ThreadRow): Promise<ThreadRow> => {
  if (thread.started_at) return thread
  const now = new Date().toISOString()
  await window.api.coreV2.localThreads.update(thread.id, { started_at: now })
  patchThreadRow(thread.id, { started_at: now })
  const updated = getThreadRowById(thread.id)
  return updated ?? { ...thread, started_at: now }
}

const ensureThreadTitleFromText = async (
  thread: ThreadRow,
  text: string,
  imageCount = 0
): Promise<void> => {
  if (thread.title && thread.title !== 'newchat') return
  try {
    const result = await window.api.coreV2.localThreads.generateTitle({ text, imageCount })
    const title = result.title?.trim() || (imageCount > 0 ? '图片消息' : '新对话')
    await window.api.coreV2.localThreads.update(thread.id, { title })
    patchThreadRow(thread.id, { title })
  } catch (err) {
    console.error('Update thread title failed', err)
  }
}

// ── 滚动 ──────────────────────────────────────────────────────────
const scrollToBottom = async (options?: { force?: boolean }): Promise<void> => {
  if (scrollToBottomRafId != null) return
  scrollToBottomRafId = window.requestAnimationFrame(async () => {
    scrollToBottomRafId = null
    await nextTick()
    await rightAreaRef.value?.scrollToBottom(options)
  })
}

const switchThread = async (thread: ThreadRow): Promise<void> => {
  if (activeThread.value?.id === thread.id) return
  const prevThreadId = activeThread.value?.id
  if (prevThreadId) {
    clearRuntimeDebugRefreshTimer(prevThreadId)
    // 保存当前线程的输入框内容和附件，以便切换回来时恢复
    threadInputCache.set(prevThreadId, {
      text: inputText.value,
      attachments: [...composerAttachments.value]
    })
  }

  activeThread.value = thread
  currentWorkspacePath.value = thread.workspace_path

  // 恢复新线程的输入框内容和附件
  const cachedInput = threadInputCache.get(thread.id)
  inputText.value = cachedInput?.text || ''
  composerAttachments.value = cachedInput?.attachments || []

  applyThreadModelSelection(thread.model)
  applyFallbackThinkingConfig(thread.id, selectedRuntimeModel.value)
  void loadThreadPlanState(thread.id)

  const cached = messageCacheByThreadId.get(thread.id)
  const initialized = Boolean(threadWindowInitializedByThreadId.value[thread.id])
  if (cached && initialized) {
    messages.value = cached
    await loadLatestThreadWindow(thread.id, 'replace')
  } else {
    // Avoid rendering stale messages from the previous thread while the new thread window loads.
    messages.value = []
    await loadLatestThreadWindow(thread.id, 'replace')
  }

  await syncRuntimeQueue(thread.id)
  void refreshRuntimeContextDebug(thread.id)
  scrollToBottom({ force: true })

  // NOTE: We don't perform eager thinking level sync on thread switch to avoid
  // redundant IPC/Agent overhead during fast switching.
  // The correct levels will be used if already cached (verifiedModelCapabilities)
  // or discovered when the first prompt is sent.
}

const loadActiveThreadOlderHistory = async (): Promise<void> => {
  const threadId = activeThread.value?.id
  if (!threadId) return
  await loadOlderThreadWindow(threadId)
}

const openSearchResult = async (item: ConversationSearchResultItem): Promise<void> => {
  closeSearchPalette()
  const thread = threads.value.find((entry) => entry.id === item.threadId)
  if (!thread) {
    globalDialog.alert({ title: '找不到会话', message: '这个搜索结果对应的会话已经不存在。' })
    return
  }

  await switchThread(thread)
  let found = await rightAreaRef.value?.scrollToMessage?.(item.messageId)
  if (!found) found = await rightAreaRef.value?.scrollToMessage?.(item.messageId)
  if (!found) {
    await loadThreadWindowAround(item.threadId, {
      messageId: item.messageId,
      before: 30,
      after: 30
    })
    await nextTick()
    await rightAreaRef.value?.scrollToMessage?.(item.messageId)
  }
}

// ── 新建线程 ──────────────────────────────────────────────────────
const createNewThread = async (): Promise<void> => {
  const workspacePath = await window.api.dialog.openFolder()
  if (!workspacePath) return
  await createThreadInWorkspace(workspacePath)
}

const createTemporaryThread = async (): Promise<void> => {
  const result = await window.api.workspace.createTemp()
  if (result && result.workspacePath) {
    await window.api.db.workspaces.upsert(result.workspacePath, '临时会话')
    await createThreadInWorkspace(result.workspacePath)
  }
}

const handleRightAreaCreateThread = async (): Promise<void> => {
  if (currentWorkspacePath.value) {
    await createThreadInWorkspace(currentWorkspacePath.value)
  } else {
    await createNewThread()
  }
}

// ── 在指定文件夹下新建线程 ─────────────────────────────────────────
const createThreadInWorkspace = async (workspacePath: string): Promise<void> => {
  const preferredModel = await resolveWorkspaceModel(workspacePath, null)
  const thread = await window.api.coreV2.localThreads.create(
    workspacePath,
    preferredModel,
    'newchat'
  )
  await window.api.db.workspaces.upsert(workspacePath)
  await window.api.db.workspaceSettings.set(workspacePath, { model: preferredModel })
  workspaces.value = await window.api.db.workspaces.list()
  threads.value = await loadLocalThreadRows()
  await switchThread(thread)
}

import { loadAppTheme, themeBroadcast } from './utils/theme'

// ── 初始化 ────────────────────────────────────────────────────────
let offAgentEvent: (() => void) | null = null
let offAgentDebugEvent: (() => void) | null = null
let offOpenThread: (() => void) | null = null
let offRuntimeInspectorThread: (() => void) | null = null
let offQuestionEvent: (() => void) | null = null
let offSandboxPermissionPrompt: (() => void) | null = null
let offQuestionnaireEvent: (() => void) | null = null
let offSecretEvent: (() => void) | null = null
let offThreadPlanEvent: (() => void) | null = null
let offSubagentPanelEvent: (() => void) | null = null
let offTransportAccountSetupEvent: (() => void) | null = null
let offWorkspacesChanged: (() => void) | null = null

const applyTransportAccountSetupEventToThreadRuns = (
  event: TransportPluginAccountSetupEvent
): boolean => {
  let changed = false
  for (const [threadId, runs] of agentRunsByThreadId.entries()) {
    if (!applyTransportAccountSetupEventToRuns(runs.values(), event)) continue
    changed = true
    if (activeThread.value?.id === threadId) {
      messages.value = messageCacheByThreadId.get(threadId) ?? messages.value
    }
    scheduleRuntimeDebugRefresh(threadId)
  }
  return changed
}

const omitRecordKey = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...record }
  delete next[key]
  return next
}

const pruneThreadLocalState = (threadId: string): void => {
  messageCacheByThreadId.delete(threadId)
  agentRunsByThreadId.delete(threadId)
  activeRunByThreadId.delete(threadId)
  runtimeLiveDebugEventsByThreadId.delete(threadId)
  runtimeContextDebugByThreadId.delete(threadId)
  pendingQuestionsByThreadId.delete(threadId)
  pendingQuestionnairesByThreadId.delete(threadId)
  pendingSecretsByThreadId.delete(threadId)
  threadPlanStateByThreadId.delete(threadId)
  subagentPanelStateByThreadId.delete(threadId)
  hiddenThreadPlanRevisionByThreadId.value = omitRecordKey(
    hiddenThreadPlanRevisionByThreadId.value,
    threadId
  )
  hiddenSubagentPanelRevisionByThreadId.value = omitRecordKey(
    hiddenSubagentPanelRevisionByThreadId.value,
    threadId
  )
  clearRuntimeDebugRefreshTimer(threadId)
  delete queueControllersByThreadId[threadId]
  threadInputCache.delete(threadId)
  clearRunFinishedIndicatorForThread(threadId)
  chatInputHistoryStore.value = removeChatInputHistoryThread(chatInputHistoryStore.value, threadId)

  thinkingLevelByThreadId.value = omitRecordKey(thinkingLevelByThreadId.value, threadId)
  thinkingLevelsByThreadId.value = omitRecordKey(thinkingLevelsByThreadId.value, threadId)
  thinkingSupportByThreadId.value = omitRecordKey(thinkingSupportByThreadId.value, threadId)
  runtimeDebugLoadingByThreadId.value = omitRecordKey(runtimeDebugLoadingByThreadId.value, threadId)
  runtimeContextLoadingByThreadId.value = omitRecordKey(
    runtimeContextLoadingByThreadId.value,
    threadId
  )
  runtimeContextCompactingByThreadId.value = omitRecordKey(
    runtimeContextCompactingByThreadId.value,
    threadId
  )
  runtimeDebugRunFilterByThreadId.value = omitRecordKey(
    runtimeDebugRunFilterByThreadId.value,
    threadId
  )
  hasMoreHistoryByThreadId.value = omitRecordKey(hasMoreHistoryByThreadId.value, threadId)
  historyLoadingByThreadId.value = omitRecordKey(historyLoadingByThreadId.value, threadId)
  oldestCursorByThreadId.value = omitRecordKey(oldestCursorByThreadId.value, threadId)
  threadWindowInitializedByThreadId.value = omitRecordKey(
    threadWindowInitializedByThreadId.value,
    threadId
  )
  streamingByThreadId.value = omitRecordKey(streamingByThreadId.value, threadId)
}

const reloadWorkspaceSnapshot = async (): Promise<void> => {
  const previousThreads = threads.value
  const previousActiveThreadId = activeThread.value?.id ?? null
  const previousWorkspacePath = currentWorkspacePath.value
  const [allThreads, allWorkspaces] = await Promise.all([
    loadLocalThreadRows(),
    window.api.db.workspaces.list()
  ])

  threads.value = allThreads
  workspaces.value = allWorkspaces

  const nextThreadIds = new Set(allThreads.map((thread) => thread.id))
  for (const thread of previousThreads) {
    if (!nextThreadIds.has(thread.id)) pruneThreadLocalState(thread.id)
  }

  const active = previousActiveThreadId
    ? (allThreads.find((thread) => thread.id === previousActiveThreadId) ?? null)
    : null
  if (active) {
    activeThread.value = active
    currentWorkspacePath.value = active.workspace_path
    void loadThreadPlanState(active.id)
    await syncRuntimeQueue(active.id)
    return
  }

  const fallbackWorkspacePath = allWorkspaces.some((ws) => ws.path === previousWorkspacePath)
    ? previousWorkspacePath
    : (allWorkspaces[0]?.path ?? '')
  const nextThread =
    (fallbackWorkspacePath
      ? allThreads.find((thread) => thread.workspace_path === fallbackWorkspacePath)
      : null) ??
    allThreads[0] ??
    null

  if (nextThread) {
    await switchThread(nextThread)
    return
  }

  resetActiveThreadState(fallbackWorkspacePath)
}

const handleGlobalSearchShortcut = (event: KeyboardEvent): void => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    openSearchPalette()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalSearchShortcut)
  try {
    await loadAppTheme()
    themeBroadcast.onmessage = async (e) => {
      if (e.data?.type === 'theme-changed') {
        await loadAppTheme()
      }
    }
    window.addEventListener('focus', loadAppTheme)
  } catch {
    // ignore
  }

  offRuntimeInspectorThread = window.api.onRuntimeInspectorThread((threadId) => {
    runtimeInspectorThreadId.value = threadId
    if (isRuntimeInspectorPage.value) {
      void refreshRuntimeDebugEvents(threadId, getRuntimeDebugSelectedRunId(threadId))
    }
  })

  if (!isSettingsPage.value && !isKnowledgeManagerPage.value && !isRuntimeInspectorPage.value) {
    offOpenThread = window.api.onOpenThread((threadId) => {
      void (async () => {
        const existing = threads.value.find((thread) => thread.id === threadId)
        if (existing) {
          await switchThread(existing)
          return
        }
        const nextThreads = await loadLocalThreadRows()
        threads.value = nextThreads
        const targetThread = nextThreads.find((thread) => thread.id === threadId)
        if (targetThread) await switchThread(targetThread)
      })()
    })
  }

  if (isSettingsPage.value || isKnowledgeManagerPage.value) return
  if (!isRuntimeInspectorPage.value) {
    offTransportAccountSetupEvent = window.api.plugins.onTransportAccountSetupEvent((event) => {
      applyTransportAccountSetupEventToThreadRuns(event)
    })
    await buildRuntimeModels()
    window.addEventListener('focus', refreshRuntimeModels)
  }

  // 监听主进程投影后的 agent 事件
  const runtimeEventBridge = createRuntimeEventBridge({
    activeThread,
    messages,
    runtimeBinding,
    messageCacheByThreadId,
    activeRunByThreadId,
    appendRuntimeLiveDebugEvent,
    createRuntimeLiveEventFromAppEvent,
    scheduleRuntimeDebugRefresh,
    emitRendererDebugEvent,
    ensureQueueController,
    ensureMessageBuffer,
    removeRuntimeQueueItemByText,
    removeQueueItem,
    getAgentRunMap,
    getActiveRun,
    setActiveRun,
    setThreadStreaming,
    upsertProjectedRun,
    syncAssistantTurnMessage,
    syncAssistantMessagesForRun,
    finalizeAssistantMessageForThread,
    applyInlineWidgetToAssistantMessage,
    onRunSettled,
    scrollToBottom
  })
  offAgentEvent = window.api.runtime.onEvent(async (event) => {
    await runtimeEventBridge(event)
    if (!shouldRefreshContextUsageForEvent(event)) return
    const threadId = getRuntimeEventThreadId(event)
    if (threadId) void refreshRuntimeContextDebug(threadId)
  })

  offAgentDebugEvent = window.api.runtime.onDebugEvent((event) => {
    const threadId =
      typeof event.__chatThreadId === 'string' ? event.__chatThreadId : event.thread_id
    if (!threadId) return
    appendRuntimeLiveDebugEvent(threadId, event)
    scheduleRuntimeDebugRefresh(threadId)
    if (isContextCompactionEvent(event)) {
      const targetMessages =
        messageCacheByThreadId.get(threadId) ??
        (activeThread.value?.id === threadId ? messages.value : ensureMessageBuffer(threadId))
      if (!messageCacheByThreadId.has(threadId))
        messageCacheByThreadId.set(threadId, targetMessages)
      if (applyContextCompactionEventToMessages(targetMessages, event)) {
        if (activeThread.value?.id === threadId) {
          messages.value = targetMessages
          void scrollToBottom()
        }
      }
    }
    if (event.event_type.startsWith('context.')) {
      void refreshRuntimeContextDebug(threadId)
    }
  })

  if (!isRuntimeInspectorPage.value) {
    offSandboxPermissionPrompt = window.api.coreV2.workspaceSandbox.onPermissionPrompt(
      async (prompt: WorkspaceSandboxPermissionPrompt) => {
        const approved = await globalDialog.confirm({
          title: '允许访问项目外路径？',
          message: prompt.targetPath,
          detail:
            prompt.access === 'write'
              ? '此操作将允许读取和修改该路径。'
              : '此操作将允许读取该路径。',
          confirmText: '允许',
          cancelText: '拒绝',
          danger: true
        })
        await window.api.coreV2.workspaceSandbox.respondPermissionPrompt(prompt.requestId, approved)
      }
    )

    offQuestionEvent = window.api.gateway.onQuestion((event: PendingQuestionEvent) => {
      if (event.type === 'set') {
        setPendingQuestionForThread(event.pending)
        return
      }
      clearPendingQuestionForThread(event.threadId, event.toolCallId)
    })

    offQuestionnaireEvent = window.api.gateway.onQuestionnaire(
      async (event: PendingQuestionnaireEvent) => {
        if (event.type === 'set') {
          await setPendingQuestionnaireForThread(event.pending)
          return
        }
        clearPendingQuestionnaireForThread(event.threadId, event.toolCallId)
      }
    )

    offSecretEvent = window.api.gateway.onSecret((event: PendingSecretPromptEvent) => {
      if (event.type === 'set') {
        setPendingSecretForThread(event.pending)
        return
      }
      clearPendingSecretForThread(event.threadId, event.requestId)
    })

    offThreadPlanEvent = window.api.gateway.onThreadPlan((event: ThreadPlanEvent) => {
      if (event.type === 'set') {
        setThreadPlanStateForThread(event.state)
        return
      }
      clearThreadPlanStateForThread(event.threadId)
    })

    offSubagentPanelEvent = window.api.gateway.onSubagentPanel((event: SubagentPanelEvent) => {
      if (event.type === 'set') {
        setSubagentPanelStateForThread(event.state)
        return
      }
      clearSubagentPanelStateForThread(event.threadId)
    })

    offWorkspacesChanged = window.api.db.workspaces.onChanged(() => {
      void reloadWorkspaceSnapshot()
    })

    await reloadWorkspaceSnapshot()
    return
  }

  const threadId = currentRuntimeDebugThreadId.value
  if (threadId) {
    void refreshRuntimeDebugEvents(threadId, getRuntimeDebugSelectedRunId(threadId))
    void refreshRuntimeContextDebug(threadId)
  }
})

const openSettings = (category?: string): void => window.api.openSettings(category)
const openContextSettings = (): void => window.api.openSettings('chat')

const openWorkspaceFolder = async (): Promise<void> => {
  const workspacePath = currentWorkspacePath.value
  if (!workspacePath) return
  try {
    await window.api.openPath(workspacePath)
  } catch (err) {
    console.error('Open workspace path failed', err)
  }
}

const selectThreadById = async (id: string): Promise<void> => {
  const thread = threads.value.find((s) => s.id === id)
  if (!thread) return
  clearRunFinishedIndicatorForThread(thread.id)
  await switchThread(thread)
}

const selectWorkspaceByPath = (path: string): void => {
  activeThread.value = null
  currentWorkspacePath.value = path
  messages.value = []
  inputText.value = ''
  composerAttachments.value = []
  editingMessage.value = null
  runtimeBinding.value = null
  runtimeStatus.value = { text: '', tone: 'idle' }
  rightAreaRef.value?.clearQuestion?.()
  rightAreaRef.value?.clearQuestionnaire?.()
}

const deleteWorkspaceByPath = async (workspacePath: string): Promise<void> => {
  if (!workspacePath) return
  try {
    await window.api.db.workspaces.delete(workspacePath)
    await reloadWorkspaceSnapshot()
  } catch (err) {
    console.error('Delete workspace failed', err)
    await globalDialog.alert({
      title: '删除失败',
      message: '删除项目时发生错误',
      detail: String(err)
    })
  }
}

const deleteThreadById = async (id: string): Promise<void> => {
  const deletingActive = activeThread.value?.id === id
  const activeWorkspacePath = deletingActive ? (activeThread.value?.workspace_path ?? null) : null
  await window.api.coreV2.localThreads.delete(id)
  try {
    await window.api.runtime.disposeThread(id)
  } catch {
    // ignore
  }
  pruneThreadLocalState(id)
  threads.value = await loadLocalThreadRows()
  if (!deletingActive) return
  const next =
    (activeWorkspacePath
      ? threads.value.find((s) => s.workspace_path === activeWorkspacePath)
      : null) ?? threads.value[0]
  if (next) await switchThread(next)
  else resetActiveThreadState(activeWorkspacePath ?? workspaces.value[0]?.path ?? '')
}

onUnmounted(() => {
  offAgentEvent?.()
  offAgentDebugEvent?.()
  offOpenThread?.()
  offRuntimeInspectorThread?.()
  offQuestionEvent?.()
  offSandboxPermissionPrompt?.()
  offQuestionnaireEvent?.()
  offSecretEvent?.()
  offThreadPlanEvent?.()
  offSubagentPanelEvent?.()
  offTransportAccountSetupEvent?.()
  offWorkspacesChanged?.()
  if (!isSettingsPage.value && !isKnowledgeManagerPage.value && !isRuntimeInspectorPage.value) {
    void window.api.runtime.setActiveThread(null)
  }
  if (scrollToBottomRafId != null) {
    window.cancelAnimationFrame(scrollToBottomRafId)
    scrollToBottomRafId = null
  }
  window.removeEventListener('focus', refreshRuntimeModels)
  window.removeEventListener('keydown', handleGlobalSearchShortcut)
  for (const threadId of runtimeDebugRefreshTimersByThreadId.keys()) {
    clearRuntimeDebugRefreshTimer(threadId)
  }
})

const loadLocalThreadRows = async (): Promise<ThreadRow[]> =>
  window.api.coreV2.conversations.listLocalThreadRows()

watch(
  () => Object.keys(runFinishedIndicatorByThreadId.value).length,
  (count) => syncRunFinishedBadgeCount(count),
  { immediate: true }
)

watch(
  () => [isSettingsPage.value, activeThread.value?.id ?? null] as const,
  ([isSettings, threadId]) => {
    if (isSettings || isKnowledgeManagerPage.value || isRuntimeInspectorPage.value) return
    void window.api.runtime.setActiveThread(threadId)
    window.api.setRuntimeInspectorThread(threadId)
  },
  { immediate: true }
)

watch(
  () => [isRuntimeDebugVisible.value, currentRuntimeDebugThreadId.value] as const,
  ([isOpen, threadId]) => {
    if (!isOpen || !threadId) return
    void refreshRuntimeDebugEvents(threadId, getRuntimeDebugSelectedRunId(threadId))
    void refreshRuntimeContextDebug(threadId)
  }
)
</script>

<style>
:root {
  --panel-shadow-right: 4px 0 14px rgba(15, 23, 42, 0.08);
}

.panel-shadow-right {
  box-shadow: var(--panel-shadow-right);
}

/* Drag regions */
.drag-region {
  -webkit-app-region: drag;
}
.no-drag {
  -webkit-app-region: no-drag;
}

/* Scrollbar */
/* We keep it visible for the main chat area */

/* Menu Animation */
.menu-enter-active,
.menu-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(10px);
}

/* Ensure traffic lights don't overlap app content when sidebar is hidden */
header {
  padding-left: 0;
}
</style>
