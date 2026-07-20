import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import type { AgentAppEvent, AgentThreadProjection } from '@shared/agent-runtime'
import type { ContextThreadDebugSnapshot } from '@shared/context-engine'
import type { ConversationEventRow } from '../../../preload/db-types'
import type { AgentRun } from '../components/chat/types'

const RUNTIME_DEBUG_EVENT_HISTORY_DISABLED = true
/** Timeline 数据接收总开关：true 时不再收集 live/debug 事件。 */
const RUNTIME_DEBUG_TIMELINE_DISABLED = true

type RuntimeDebugRunOption = {
  id: string
  status: AgentRun['status']
  label: string
}

type RuntimeDebugOptions<T extends { id: string }> = {
  activeThread: Ref<T | null>
  isRuntimeInspectorPage: Ref<boolean>
  runtimeInspectorThreadId: Ref<string | null>
  getAgentRunMap: (threadId: string) => Map<string, AgentRun>
  upsertProjectedRun: (
    threadId: string,
    projection: AgentThreadProjection['runs'][number]
  ) => AgentRun
}

type RuntimeDebugState = {
  runtimeLiveDebugEventsByThreadId: Map<string, ConversationEventRow[]>
  runtimeContextDebugByThreadId: Map<string, ContextThreadDebugSnapshot>
  runtimeDebugRefreshTimersByThreadId: Map<string, number>
  isRuntimeDebugOpen: Ref<boolean>
  runtimeDebugLoadingByThreadId: Ref<Record<string, boolean>>
  runtimeContextLoadingByThreadId: Ref<Record<string, boolean>>
  runtimeContextCompactingByThreadId: Ref<Record<string, boolean>>
  runtimeDebugRunFilterByThreadId: Ref<Record<string, string>>
  currentRuntimeDebugThreadId: ComputedRef<string | null>
  isRuntimeDebugVisible: ComputedRef<boolean>
  runtimeContextDebug: ComputedRef<ContextThreadDebugSnapshot | null>
  runtimeContextLoading: ComputedRef<boolean>
  runtimeContextCompacting: ComputedRef<boolean>
  runtimeDebugEvents: ComputedRef<ConversationEventRow[]>
  runtimeDebugLoading: ComputedRef<boolean>
  runtimeDebugSelectedRunId: ComputedRef<string | null>
  runtimeDebugRunOptions: ComputedRef<RuntimeDebugRunOption[]>
  getRuntimeDebugSelectedRunId: (threadId: string) => string | null
  setRuntimeDebugSelectedRunId: (threadId: string, runId: string | null) => void
  setRuntimeDebugLoading: (threadId: string, value: boolean) => void
  setRuntimeContextLoading: (threadId: string, value: boolean) => void
  setRuntimeContextCompacting: (threadId: string, value: boolean) => void
  refreshRuntimeRuns: (threadId: string) => Promise<void>
  refreshRuntimeDebugEvents: (threadId: string, runId?: string | null) => Promise<void>
  refreshRuntimeContextDebug: (threadId: string) => Promise<void>
  appendRuntimeLiveDebugEvent: (
    threadId: string,
    event: ConversationEventRow & { __chatThreadId?: string }
  ) => void
  createRuntimeLiveEventFromAppEvent: (
    threadId: string,
    event: AgentAppEvent
  ) => ConversationEventRow
  emitRendererDebugEvent: (
    threadId: string,
    eventType: string,
    payload: unknown,
    options?: { agentRunId?: string | null }
  ) => void
  clearRuntimeDebugRefreshTimer: (threadId: string) => void
  scheduleRuntimeDebugRefresh: (threadId: string) => void
  toggleRuntimeDebug: () => void
  closeRuntimeDebug: () => void
  refreshActiveRuntimeDebug: () => void
  selectRuntimeDebugRun: (runId: string | null) => void
  compactActiveRuntimeContext: () => Promise<void>
}

const runtimeInspectorEventTypeByAppEvent: Record<AgentAppEvent['type'], string> = {
  'agent.queue.consumed': 'agentQueueConsumed',
  'agent.run.started': 'agentRunStarted',
  'agent.run.updated': 'agentRunUpdated',
  'agent.run.finished': 'agentRunFinished',
  'agent.run.failed': 'agentRunFailed',
  'agent.run.aborted': 'agentRunAborted',
  'agent.turn.started': 'agentTurnStarted',
  'agent.turn.finished': 'agentTurnFinished',
  'agent.message.started': 'agentMessageStarted',
  'agent.message.delta': 'agentMessageDelta',
  'agent.message.finished': 'agentMessageFinished',
  'agent.tool.started': 'agentToolCallStarted',
  'agent.tool.progress': 'agentToolCallProgress',
  'agent.tool.finished': 'agentToolCallFinished',
  'agent.thread.started': 'agentThreadStarted',
  'agent.thread.switched': 'agentThreadSwitched',
  'agent.thread.forked': 'agentThreadForked',
  'agent.thread.compacted': 'agentThreadCompacted',
  'agent.thread.shutdown': 'agentThreadShutdown'
}

export const useRuntimeDebugState = <T extends { id: string }>({
  activeThread,
  isRuntimeInspectorPage,
  runtimeInspectorThreadId,
  getAgentRunMap,
  upsertProjectedRun
}: RuntimeDebugOptions<T>): RuntimeDebugState => {
  const runtimeLiveDebugEventsByThreadId = reactive(new Map<string, ConversationEventRow[]>())
  const runtimeContextDebugByThreadId = reactive(new Map<string, ContextThreadDebugSnapshot>())
  const runtimeDebugRefreshTimersByThreadId = new Map<string, number>()
  const isRuntimeDebugOpen = ref(false)
  const runtimeDebugLoadingByThreadId = ref<Record<string, boolean>>({})
  const runtimeContextLoadingByThreadId = ref<Record<string, boolean>>({})
  const runtimeContextCompactingByThreadId = ref<Record<string, boolean>>({})
  const runtimeDebugRunFilterByThreadId = ref<Record<string, string>>({})

  const currentRuntimeDebugThreadId = computed(() =>
    isRuntimeInspectorPage.value ? runtimeInspectorThreadId.value : (activeThread.value?.id ?? null)
  )
  const isRuntimeDebugVisible = computed(() =>
    isRuntimeInspectorPage.value ? true : isRuntimeDebugOpen.value
  )

  const getRuntimeDebugSelectedRunId = (threadId: string): string | null => {
    const selected = runtimeDebugRunFilterByThreadId.value[threadId]
    return selected ? selected : null
  }

  const setRuntimeDebugSelectedRunId = (threadId: string, runId: string | null): void => {
    if (!threadId) return
    const next = { ...runtimeDebugRunFilterByThreadId.value }
    if (runId) next[threadId] = runId
    else delete next[threadId]
    runtimeDebugRunFilterByThreadId.value = next
  }

  const setRuntimeDebugLoading = (threadId: string, value: boolean): void => {
    if (!threadId) return
    if (Boolean(runtimeDebugLoadingByThreadId.value[threadId]) === value) return
    runtimeDebugLoadingByThreadId.value = {
      ...runtimeDebugLoadingByThreadId.value,
      [threadId]: value
    }
  }

  const setRuntimeContextLoading = (threadId: string, value: boolean): void => {
    if (!threadId) return
    if (Boolean(runtimeContextLoadingByThreadId.value[threadId]) === value) return
    runtimeContextLoadingByThreadId.value = {
      ...runtimeContextLoadingByThreadId.value,
      [threadId]: value
    }
  }

  const setRuntimeContextCompacting = (threadId: string, value: boolean): void => {
    if (!threadId) return
    if (Boolean(runtimeContextCompactingByThreadId.value[threadId]) === value) return
    runtimeContextCompactingByThreadId.value = {
      ...runtimeContextCompactingByThreadId.value,
      [threadId]: value
    }
  }

  const refreshRuntimeRuns = async (threadId: string): Promise<void> => {
    if (!threadId) return
    try {
      const projection = await window.api.runtime.getThreadProjection(threadId)
      for (const run of projection.runs) {
        upsertProjectedRun(threadId, run)
      }
    } catch (err) {
      console.error('Load runtime runs failed', err)
    }
  }

  const refreshRuntimeDebugEvents = async (
    threadId: string,
    runId?: string | null
  ): Promise<void> => {
    if (!threadId) return
    void runId
    if (RUNTIME_DEBUG_EVENT_HISTORY_DISABLED) {
      setRuntimeDebugLoading(threadId, false)
      await refreshRuntimeRuns(threadId)
    }
  }

  const refreshRuntimeContextDebug = async (threadId: string): Promise<void> => {
    if (!threadId) return
    setRuntimeContextLoading(threadId, true)
    try {
      const snapshot = await window.api.context.getThreadDebug(threadId)
      runtimeContextDebugByThreadId.set(threadId, snapshot)
    } catch (err) {
      console.error('Load context debug snapshot failed', err)
    } finally {
      setRuntimeContextLoading(threadId, false)
    }
  }

  const appendRuntimeLiveDebugEvent = (
    threadId: string,
    event: ConversationEventRow & { __chatThreadId?: string }
  ): void => {
    if (RUNTIME_DEBUG_TIMELINE_DISABLED) return
    const list = runtimeLiveDebugEventsByThreadId.get(threadId) ?? []
    list.push({
      id: event.id,
      thread_id: threadId,
      agent_run_id: event.agent_run_id ?? null,
      event_type: event.event_type,
      event_origin: event.event_origin,
      correlation_id: event.correlation_id,
      payload_json: event.payload_json,
      raw_json: event.raw_json ?? null,
      created_at: event.created_at
    })
    if (list.length > 100) {
      list.splice(0, list.length - 100)
    }
    runtimeLiveDebugEventsByThreadId.set(threadId, list)
  }

  const createRuntimeLiveEventFromAppEvent = (
    threadId: string,
    event: AgentAppEvent
  ): ConversationEventRow => ({
    id: event.id,
    thread_id: threadId,
    agent_run_id: event.agentRunId ?? null,
    event_type: runtimeInspectorEventTypeByAppEvent[event.type],
    event_origin: 'runtime',
    correlation_id: event.correlationId,
    payload_json: JSON.stringify(event),
    raw_json: null,
    created_at: event.timestamp
  })

  const createRendererDebugEvent = (
    threadId: string,
    eventType: string,
    payload: unknown,
    options?: { agentRunId?: string | null }
  ): ConversationEventRow => ({
    id: crypto.randomUUID(),
    thread_id: threadId,
    agent_run_id: options?.agentRunId ?? null,
    event_type: eventType,
    event_origin: 'renderer_debug',
    correlation_id: crypto.randomUUID(),
    payload_json: JSON.stringify(payload ?? null),
    raw_json: null,
    created_at: Date.now()
  })

  const emitRendererDebugEvent = (
    threadId: string,
    eventType: string,
    payload: unknown,
    options?: { agentRunId?: string | null }
  ): void => {
    if (RUNTIME_DEBUG_TIMELINE_DISABLED) return
    const event = createRendererDebugEvent(threadId, eventType, payload, options)
    appendRuntimeLiveDebugEvent(threadId, event)
    if (RUNTIME_DEBUG_EVENT_HISTORY_DISABLED) return
  }

  const clearRuntimeDebugRefreshTimer = (threadId: string): void => {
    const timer = runtimeDebugRefreshTimersByThreadId.get(threadId)
    if (timer != null) {
      window.clearTimeout(timer)
      runtimeDebugRefreshTimersByThreadId.delete(threadId)
    }
  }

  const scheduleRuntimeDebugRefresh = (threadId: string): void => {
    if (!isRuntimeDebugVisible.value) return
    if (currentRuntimeDebugThreadId.value !== threadId) return
    clearRuntimeDebugRefreshTimer(threadId)
    const timer = window.setTimeout(() => {
      runtimeDebugRefreshTimersByThreadId.delete(threadId)
      if (isRuntimeInspectorPage.value) {
        void refreshRuntimeContextDebug(threadId)
      }
    }, 120)
    runtimeDebugRefreshTimersByThreadId.set(threadId, timer)
  }

  const toggleRuntimeDebug = (): void => {
    const threadId = activeThread.value?.id ?? currentRuntimeDebugThreadId.value
    window.api.openRuntimeInspector(threadId)
  }

  const closeRuntimeDebug = (): void => {
    isRuntimeDebugOpen.value = false
  }

  const refreshActiveRuntimeDebug = (): void => {
    const threadId = currentRuntimeDebugThreadId.value
    if (!threadId) return
    void refreshRuntimeDebugEvents(threadId, getRuntimeDebugSelectedRunId(threadId))
    void refreshRuntimeContextDebug(threadId)
  }

  const selectRuntimeDebugRun = (runId: string | null): void => {
    const threadId = currentRuntimeDebugThreadId.value
    if (!threadId) return
    setRuntimeDebugSelectedRunId(threadId, runId)
  }

  const runtimeContextDebug = computed(() => {
    const threadId = currentRuntimeDebugThreadId.value
    if (!threadId) return null
    return runtimeContextDebugByThreadId.get(threadId) ?? null
  })

  const runtimeContextLoading = computed(() => {
    const threadId = currentRuntimeDebugThreadId.value
    if (!threadId) return false
    return Boolean(runtimeContextLoadingByThreadId.value[threadId])
  })

  const runtimeContextCompacting = computed(() => {
    const threadId = currentRuntimeDebugThreadId.value
    if (!threadId) return false
    return Boolean(runtimeContextCompactingByThreadId.value[threadId])
  })

  const compactActiveRuntimeContext = async (): Promise<void> => {
    const threadId = currentRuntimeDebugThreadId.value
    if (!threadId) return
    setRuntimeContextCompacting(threadId, true)
    try {
      const result = await window.api.runtime.compactContext(threadId)
      if (!result.success) {
        throw new Error(result.error)
      }
      emitRendererDebugEvent(threadId, 'debugUiContextCompactAction', {
        changed: result.changed,
        revision: result.revision,
        summaryEntryId: result.summaryEntryId ?? null
      })
      await Promise.all([
        refreshRuntimeDebugEvents(threadId, getRuntimeDebugSelectedRunId(threadId)),
        refreshRuntimeContextDebug(threadId)
      ])
    } catch (err) {
      console.error('Manual context compaction failed', err)
      emitRendererDebugEvent(threadId, 'debugUiContextCompactFailed', {
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setRuntimeContextCompacting(threadId, false)
    }
  }

  const runtimeDebugEvents = computed(() => {
    if (RUNTIME_DEBUG_TIMELINE_DISABLED) return []
    const threadId = currentRuntimeDebugThreadId.value
    if (!threadId) return []
    const live = runtimeLiveDebugEventsByThreadId.get(threadId) ?? []
    const selectedRunId = getRuntimeDebugSelectedRunId(threadId)
    const filteredLive = selectedRunId
      ? live.filter((event) => !event.agent_run_id || event.agent_run_id === selectedRunId)
      : live
    const deduped = new Map<string, ConversationEventRow>()
    for (const event of filteredLive) {
      const key = [
        event.event_type,
        event.agent_run_id ?? '',
        event.correlation_id ?? '',
        String(event.created_at)
      ].join('|')
      if (!deduped.has(key)) deduped.set(key, event)
    }
    return Array.from(deduped.values()).sort((a, b) => a.created_at - b.created_at)
  })

  const runtimeDebugLoading = computed(() => {
    const threadId = currentRuntimeDebugThreadId.value
    if (!threadId) return false
    return Boolean(runtimeDebugLoadingByThreadId.value[threadId])
  })

  const runtimeDebugSelectedRunId = computed(() => {
    const threadId = currentRuntimeDebugThreadId.value
    if (!threadId) return null
    return getRuntimeDebugSelectedRunId(threadId)
  })

  const runtimeDebugRunOptions = computed(() => {
    const threadId = currentRuntimeDebugThreadId.value
    if (!threadId) return []
    return Array.from(getAgentRunMap(threadId).values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((run) => ({
        id: run.id,
        status: run.status,
        label: `${run.status === 'running' ? '进行中' : run.status === 'error' ? '失败' : run.status === 'aborted' ? '已停止' : '完成'} · ${new Date(
          run.startedAt
        ).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })} · ${run.id.slice(0, 8)}`
      }))
  })

  return {
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
    setRuntimeDebugSelectedRunId,
    setRuntimeDebugLoading,
    setRuntimeContextLoading,
    setRuntimeContextCompacting,
    refreshRuntimeRuns,
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
  }
}
