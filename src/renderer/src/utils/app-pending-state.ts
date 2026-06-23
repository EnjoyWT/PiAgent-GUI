import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import type { PendingQuestion } from '@shared/question-tool'
import type { PendingQuestionnaire } from '@shared/questionnaire-tool'
import type { PendingSecretPrompt } from '@shared/secret-input'
import type { ThreadPlanState } from '@shared/thread-plan'
import type { SubagentPanelState } from '@shared/subagent-panel'

type PendingInteractionState = {
  pendingQuestionsByThreadId: Map<string, PendingQuestion>
  pendingQuestionnairesByThreadId: Map<string, PendingQuestionnaire>
  pendingSecretsByThreadId: Map<string, PendingSecretPrompt>
  threadPlanStateByThreadId: Map<string, ThreadPlanState>
  subagentPanelStateByThreadId: Map<string, SubagentPanelState>
  hiddenThreadPlanRevisionByThreadId: Ref<Record<string, number>>
  hiddenSubagentPanelRevisionByThreadId: Ref<Record<string, number>>
  getPendingQuestion: (threadId?: string | null) => PendingQuestion | null
  getPendingQuestionnaire: (threadId?: string | null) => PendingQuestionnaire | null
  getPendingSecret: (threadId?: string | null) => PendingSecretPrompt | null
  activeThreadPlanState: ComputedRef<ThreadPlanState | null>
  activeThreadHiddenPlanRevision: ComputedRef<number | null>
  activeSubagentPanelState: ComputedRef<SubagentPanelState | null>
  activeThreadHiddenSubagentPanelRevision: ComputedRef<number | null>
  setPendingQuestionForThread: (pending: PendingQuestion) => void
  clearPendingQuestionForThread: (threadId: string, toolCallId?: string) => void
  setPendingQuestionnaireForThread: (pending: PendingQuestionnaire) => Promise<void>
  clearPendingQuestionnaireForThread: (threadId: string, toolCallId?: string) => void
  setPendingSecretForThread: (pending: PendingSecretPrompt) => void
  clearPendingSecretForThread: (threadId: string, requestId?: string) => void
  setThreadPlanStateForThread: (state: ThreadPlanState) => void
  clearThreadPlanStateForThread: (threadId: string) => void
  hideActiveThreadPlanPanel: () => void
  setSubagentPanelStateForThread: (state: SubagentPanelState) => void
  clearSubagentPanelStateForThread: (threadId: string) => void
  hideActiveSubagentPanel: () => void
}

export const usePendingInteractionState = <T extends { id: string }>(
  activeThread: Ref<T | null>
): PendingInteractionState => {
  const pendingQuestionsByThreadId = reactive(new Map<string, PendingQuestion>())
  const pendingQuestionnairesByThreadId = reactive(new Map<string, PendingQuestionnaire>())
  const pendingSecretsByThreadId = reactive(new Map<string, PendingSecretPrompt>())
  const threadPlanStateByThreadId = reactive(new Map<string, ThreadPlanState>())
  const subagentPanelStateByThreadId = reactive(new Map<string, SubagentPanelState>())
  const hiddenThreadPlanRevisionByThreadId = ref<Record<string, number>>({})
  const hiddenSubagentPanelRevisionByThreadId = ref<Record<string, number>>({})

  const getPendingQuestion = (threadId?: string | null): PendingQuestion | null => {
    const key = String(threadId ?? '').trim()
    if (!key) return null
    return pendingQuestionsByThreadId.get(key) ?? null
  }

  const getPendingQuestionnaire = (threadId?: string | null): PendingQuestionnaire | null => {
    const key = String(threadId ?? '').trim()
    if (!key) return null
    return pendingQuestionnairesByThreadId.get(key) ?? null
  }

  const getPendingSecret = (threadId?: string | null): PendingSecretPrompt | null => {
    const key = String(threadId ?? '').trim()
    if (!key) return null
    return pendingSecretsByThreadId.get(key) ?? null
  }

  const activeThreadPlanState = computed(() =>
    activeThread.value ? (threadPlanStateByThreadId.get(activeThread.value.id) ?? null) : null
  )

  const activeThreadHiddenPlanRevision = computed(() => {
    const threadId = activeThread.value?.id
    if (!threadId) return null
    return hiddenThreadPlanRevisionByThreadId.value[threadId] ?? null
  })

  const activeSubagentPanelState = computed(() =>
    activeThread.value ? (subagentPanelStateByThreadId.get(activeThread.value.id) ?? null) : null
  )

  const activeThreadHiddenSubagentPanelRevision = computed(() => {
    const threadId = activeThread.value?.id
    if (!threadId) return null
    return hiddenSubagentPanelRevisionByThreadId.value[threadId] ?? null
  })

  const setPendingQuestionForThread = (pending: PendingQuestion): void => {
    pendingQuestionsByThreadId.set(pending.threadId, pending)
  }

  const clearPendingQuestionForThread = (threadId: string, toolCallId?: string): void => {
    const existing = pendingQuestionsByThreadId.get(threadId)
    if (!existing) return
    if (toolCallId && existing.toolCallId !== toolCallId) return
    pendingQuestionsByThreadId.delete(threadId)
  }

  const setPendingQuestionnaireForThread = async (pending: PendingQuestionnaire): Promise<void> => {
    pendingQuestionnairesByThreadId.set(pending.threadId, pending)
  }

  const clearPendingQuestionnaireForThread = (threadId: string, toolCallId?: string): void => {
    const existing = pendingQuestionnairesByThreadId.get(threadId)
    if (!existing) return
    if (toolCallId && existing.toolCallId !== toolCallId) return
    pendingQuestionnairesByThreadId.delete(threadId)
  }

  const setPendingSecretForThread = (pending: PendingSecretPrompt): void => {
    pendingSecretsByThreadId.set(pending.threadId, pending)
  }

  const clearPendingSecretForThread = (threadId: string, requestId?: string): void => {
    const existing = pendingSecretsByThreadId.get(threadId)
    if (!existing) return
    if (requestId && existing.requestId !== requestId) return
    pendingSecretsByThreadId.delete(threadId)
  }

  const setThreadPlanStateForThread = (state: ThreadPlanState): void => {
    threadPlanStateByThreadId.set(state.threadId, state)
  }

  const clearThreadPlanStateForThread = (threadId: string): void => {
    threadPlanStateByThreadId.delete(threadId)
  }

  const hideActiveThreadPlanPanel = (): void => {
    const threadId = activeThread.value?.id
    const state = threadId ? (threadPlanStateByThreadId.get(threadId) ?? null) : null
    if (!threadId || !state) return
    hiddenThreadPlanRevisionByThreadId.value = {
      ...hiddenThreadPlanRevisionByThreadId.value,
      [threadId]: state.revision
    }
  }

  const setSubagentPanelStateForThread = (state: SubagentPanelState): void => {
    subagentPanelStateByThreadId.set(state.threadId, state)
  }

  const clearSubagentPanelStateForThread = (threadId: string): void => {
    subagentPanelStateByThreadId.delete(threadId)
  }

  const hideActiveSubagentPanel = (): void => {
    const threadId = activeThread.value?.id
    const state = threadId ? (subagentPanelStateByThreadId.get(threadId) ?? null) : null
    if (!threadId || !state) return
    hiddenSubagentPanelRevisionByThreadId.value = {
      ...hiddenSubagentPanelRevisionByThreadId.value,
      [threadId]: state.revision
    }
  }

  return {
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
  }
}
