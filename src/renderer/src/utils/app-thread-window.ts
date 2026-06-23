import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import type {
  AgentThreadWindowAroundTarget,
  AgentThreadWindowCursor,
  AgentThreadWindowPage
} from '@shared/agent-runtime'
import type { ThreadRow } from '../../../preload/db-types'
import type { AgentRun, ChatMessage, QueueRuntimeState } from '../components/chat/types'
import { buildChatStateFromThreadWindowPage } from './app-runtime'
import { resolveInlineWidgetFromMessage } from './inline-widget'
import {
  dedupeChatMessages,
  reorderChatMessagesInPlace,
  summarizeDebugMessages
} from './app-chat-helpers'
import { getMessageIdentityKey } from './message-keys'
import {
  mergeLatestWindowAuthoritatively,
  preserveLatestInlineWidgetRuntimeState
} from './thread-window-merge'

const THREAD_WINDOW_PAGE_SIZE = 20

type ThreadQueueControllerLike = {
  activeRunId: string | null
  runtimeState: QueueRuntimeState
}

type HistoryAnchor = {
  scrollTop: number
  scrollHeight: number
}

type HistoryViewport = {
  captureHistoryAnchor?: () => HistoryAnchor | null
  restoreHistoryAnchor?: (anchor: HistoryAnchor | null) => Promise<void> | void
}

type ThreadWindowOptions<T extends HistoryViewport> = {
  activeThread: Ref<ThreadRow | null>
  messages: Ref<ChatMessage[]>
  streamingByThreadId: Ref<Record<string, boolean>>
  agentRunsByThreadId: Map<string, Map<string, AgentRun>>
  activeRunByThreadId: Map<string, AgentRun>
  rightAreaRef: Ref<T | null>
  ensureQueueController: (threadId: string) => ThreadQueueControllerLike
  setThreadStreaming: (threadId: string, value: boolean) => void
  emitRendererDebugEvent: (
    threadId: string,
    eventType: string,
    payload: unknown,
    options?: { agentRunId?: string | null }
  ) => void
}

type ThreadWindowState = {
  messageCacheByThreadId: Map<string, ChatMessage[]>
  hasMoreHistoryByThreadId: Ref<Record<string, boolean>>
  historyLoadingByThreadId: Ref<Record<string, boolean>>
  oldestCursorByThreadId: Ref<Record<string, AgentThreadWindowCursor | null>>
  threadWindowInitializedByThreadId: Ref<Record<string, boolean>>
  activeHasMoreHistory: ComputedRef<boolean>
  activeHistoryLoading: ComputedRef<boolean>
  setHistoryLoading: (threadId: string, value: boolean) => void
  setHasMoreHistory: (threadId: string, value: boolean) => void
  setOldestCursor: (threadId: string, cursor: AgentThreadWindowCursor | null) => void
  setThreadWindowInitialized: (threadId: string, value: boolean) => void
  ensureMessageBuffer: (threadId: string) => ChatMessage[]
  applyThreadWindowPage: (
    threadId: string,
    page: AgentThreadWindowPage,
    mode: 'replace' | 'prepend' | 'merge-latest'
  ) => void
  loadLatestThreadWindow: (threadId: string, mode?: 'replace' | 'merge-latest') => Promise<void>
  loadThreadWindowAround: (threadId: string, around: AgentThreadWindowAroundTarget) => Promise<void>
  loadOlderThreadWindow: (threadId: string) => Promise<void>
}

export const useThreadWindowState = <T extends HistoryViewport>({
  activeThread,
  messages,
  streamingByThreadId,
  agentRunsByThreadId,
  activeRunByThreadId,
  rightAreaRef,
  ensureQueueController,
  setThreadStreaming,
  emitRendererDebugEvent
}: ThreadWindowOptions<T>): ThreadWindowState => {
  const messageCacheByThreadId = new Map<string, ChatMessage[]>()
  const hasMoreHistoryByThreadId = ref<Record<string, boolean>>({})
  const historyLoadingByThreadId = ref<Record<string, boolean>>({})
  const oldestCursorByThreadId = ref<Record<string, AgentThreadWindowCursor | null>>({})
  const threadWindowInitializedByThreadId = ref<Record<string, boolean>>({})

  const setHistoryLoading = (threadId: string, value: boolean): void => {
    if (!threadId) return
    if (Boolean(historyLoadingByThreadId.value[threadId]) === value) return
    historyLoadingByThreadId.value = {
      ...historyLoadingByThreadId.value,
      [threadId]: value
    }
  }

  const setHasMoreHistory = (threadId: string, value: boolean): void => {
    if (!threadId) return
    if (Boolean(hasMoreHistoryByThreadId.value[threadId]) === value) return
    hasMoreHistoryByThreadId.value = {
      ...hasMoreHistoryByThreadId.value,
      [threadId]: value
    }
  }

  const setOldestCursor = (threadId: string, cursor: AgentThreadWindowCursor | null): void => {
    if (!threadId) return
    oldestCursorByThreadId.value = {
      ...oldestCursorByThreadId.value,
      [threadId]: cursor
    }
  }

  const cloneThreadWindowCursor = (
    cursor: AgentThreadWindowCursor | null | undefined
  ): AgentThreadWindowCursor | null => {
    if (!cursor?.createdAt || !cursor.id) return null
    return {
      createdAt: cursor.createdAt,
      runtimeSequence: cursor.runtimeSequence ?? null,
      id: cursor.id
    }
  }

  const setThreadWindowInitialized = (threadId: string, value: boolean): void => {
    if (!threadId) return
    if (Boolean(threadWindowInitializedByThreadId.value[threadId]) === value) return
    threadWindowInitializedByThreadId.value = {
      ...threadWindowInitializedByThreadId.value,
      [threadId]: value
    }
  }

  const ensureMessageBuffer = (threadId: string): ChatMessage[] => {
    const existing = messageCacheByThreadId.get(threadId)
    if (existing) return existing
    const created = reactive<ChatMessage[]>([])
    messageCacheByThreadId.set(threadId, created)
    return created
  }

  const activeHasMoreHistory = computed(() => {
    const threadId = activeThread.value?.id
    if (!threadId) return false
    return Boolean(hasMoreHistoryByThreadId.value[threadId])
  })

  const activeHistoryLoading = computed(() => {
    const threadId = activeThread.value?.id
    if (!threadId) return false
    return Boolean(historyLoadingByThreadId.value[threadId])
  })

  const resetInlineWidgetRuntimeState = (list: ChatMessage[]): void => {
    for (const message of list) {
      const widget = resolveInlineWidgetFromMessage(message)
      if (!widget || widget.placement !== 'inline' || widget.kind !== 'html' || !widget.html) {
        continue
      }
      message.widget = widget
      delete widget.url
      delete widget.widgetId
    }
  }

  const syncThreadRunState = (
    threadId: string,
    runMap: Map<string, AgentRun>,
    activeRun: AgentRun | null,
    page: Pick<AgentThreadWindowPage, 'activeRunId' | 'isStreaming'>
  ): void => {
    const controller = ensureQueueController(threadId)
    const existingRunMap = agentRunsByThreadId.get(threadId) ?? new Map<string, AgentRun>()
    for (const [runId, run] of runMap.entries()) {
      existingRunMap.set(runId, run)
    }
    agentRunsByThreadId.set(threadId, existingRunMap)
    if (activeRun) activeRunByThreadId.set(threadId, activeRun)
    else if (!page.activeRunId) activeRunByThreadId.delete(threadId)

    setThreadStreaming(
      threadId,
      controller.runtimeState === 'aborting' ? false : page.isStreaming
    )
    if (page.activeRunId) {
      controller.activeRunId = page.activeRunId
      if (controller.runtimeState !== 'aborting') {
        controller.runtimeState = 'running'
      }
    } else if (
      controller.runtimeState !== 'aborting' &&
      controller.runtimeState !== 'dispatching'
    ) {
      controller.activeRunId = null
      controller.runtimeState = 'idle'
    }
  }

  const applyThreadWindowPage = (
    threadId: string,
    page: AgentThreadWindowPage,
    mode: 'replace' | 'prepend' | 'merge-latest'
  ): void => {
    const hadExistingCache = messageCacheByThreadId.has(threadId)
    const { runMap, chatMessages, activeRun } = buildChatStateFromThreadWindowPage(page)
    const existingMessages = messageCacheByThreadId.get(threadId) ?? []
    const pageMessages = dedupeChatMessages(
      hadExistingCache && mode === 'merge-latest'
        ? preserveLatestInlineWidgetRuntimeState(existingMessages, chatMessages)
        : chatMessages
    )

    if (!hadExistingCache || mode !== 'merge-latest') {
      resetInlineWidgetRuntimeState(pageMessages)
    }

    const list =
      mode === 'replace'
        ? pageMessages
        : (messageCacheByThreadId.get(threadId) ?? ensureMessageBuffer(threadId))
    const debugBeforeCount = list.length
    const debugBeforeMessages = summarizeDebugMessages(list)
    const debugPageMessages = summarizeDebugMessages(pageMessages)

    if (mode === 'replace') {
      agentRunsByThreadId.set(threadId, runMap)
      syncThreadRunState(threadId, new Map(), activeRun, page)
      messageCacheByThreadId.set(threadId, pageMessages)
      setHasMoreHistory(threadId, page.pageInfo.hasMoreBefore)
      setOldestCursor(threadId, page.pageInfo.nextBeforeCursor)
    } else if (mode === 'prepend') {
      const existingKeys = new Set(list.map((message) => getMessageIdentityKey(message)))
      const prependMessages = pageMessages.filter(
        (message) => !existingKeys.has(getMessageIdentityKey(message))
      )
      list.splice(0, 0, ...prependMessages)
      const deduped = dedupeChatMessages(list)
      list.splice(0, list.length, ...deduped)
      reorderChatMessagesInPlace(list)
      syncThreadRunState(threadId, runMap, activeRunByThreadId.get(threadId) ?? null, {
        activeRunId: activeRunByThreadId.get(threadId)?.id ?? null,
        isStreaming: Boolean(streamingByThreadId.value[threadId])
      })
      setHasMoreHistory(threadId, page.pageInfo.hasMoreBefore)
      setOldestCursor(threadId, page.pageInfo.nextBeforeCursor)
    } else {
      const merged = mergeLatestWindowAuthoritatively(list, pageMessages)
      list.splice(0, list.length, ...merged)
      if (merged.length === pageMessages.length) {
        setHasMoreHistory(threadId, page.pageInfo.hasMoreBefore)
        setOldestCursor(threadId, page.pageInfo.nextBeforeCursor)
      }
      const deduped = dedupeChatMessages(list)
      list.splice(0, list.length, ...deduped)
      reorderChatMessagesInPlace(list)

      syncThreadRunState(threadId, runMap, activeRun, page)
    }

    if (mode === 'replace' && activeThread.value?.id !== threadId) {
      // No-op: keeps cache warm without forcing visible list assignment.
    }

    emitRendererDebugEvent(threadId, 'debugUiThreadWindowApply', {
      mode,
      hadExistingCache,
      pageCount: pageMessages.length,
      beforeCount: debugBeforeCount,
      afterCount: (messageCacheByThreadId.get(threadId) ?? list).length,
      page: debugPageMessages,
      before: debugBeforeMessages,
      after: summarizeDebugMessages(messageCacheByThreadId.get(threadId) ?? list),
      pageInfo: page.pageInfo,
      activeRunId: page.activeRunId,
      isStreaming: page.isStreaming
    })

    setThreadWindowInitialized(threadId, true)
    if (activeThread.value?.id === threadId) {
      messages.value = messageCacheByThreadId.get(threadId) ?? list
    }
  }

  const loadLatestThreadWindow = async (
    threadId: string,
    mode: 'replace' | 'merge-latest' = 'replace'
  ): Promise<void> => {
    const page = await window.api.runtime.getThreadWindow(threadId, {
      limit: THREAD_WINDOW_PAGE_SIZE
    })
    applyThreadWindowPage(threadId, page, mode)
  }

  const loadThreadWindowAround = async (
    threadId: string,
    around: AgentThreadWindowAroundTarget
  ): Promise<void> => {
    const page = await window.api.runtime.getThreadWindow(threadId, {
      limit: Math.max(1, (around.before ?? 30) + (around.after ?? 30) + 1),
      around
    })
    applyThreadWindowPage(threadId, page, 'replace')
  }

  const loadOlderThreadWindow = async (threadId: string): Promise<void> => {
    if (!threadId || historyLoadingByThreadId.value[threadId]) return
    const beforeCursor = cloneThreadWindowCursor(oldestCursorByThreadId.value[threadId])
    if (!beforeCursor || !hasMoreHistoryByThreadId.value[threadId]) return

    const anchor =
      activeThread.value?.id === threadId ? rightAreaRef.value?.captureHistoryAnchor?.() : null
    setHistoryLoading(threadId, true)
    try {
      const page = await window.api.runtime.getThreadWindow(threadId, {
        limit: THREAD_WINDOW_PAGE_SIZE,
        beforeCursor
      })
      applyThreadWindowPage(threadId, page, 'prepend')
      if (activeThread.value?.id === threadId) {
        await rightAreaRef.value?.restoreHistoryAnchor?.(anchor ?? null)
      }
    } finally {
      setHistoryLoading(threadId, false)
    }
  }

  return {
    messageCacheByThreadId,
    hasMoreHistoryByThreadId,
    historyLoadingByThreadId,
    oldestCursorByThreadId,
    threadWindowInitializedByThreadId,
    activeHasMoreHistory,
    activeHistoryLoading,
    setHistoryLoading,
    setHasMoreHistory,
    setOldestCursor,
    setThreadWindowInitialized,
    ensureMessageBuffer,
    applyThreadWindowPage,
    loadLatestThreadWindow,
    loadThreadWindowAround,
    loadOlderThreadWindow
  }
}
