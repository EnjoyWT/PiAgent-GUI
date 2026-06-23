import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import type { ThreadRow } from '../../../preload/db-types'
import type { ChatMessage } from '../components/chat/types'
import {
  DEFAULT_MODEL_ID,
  DEFAULT_RUNTIME_MODEL_KEY,
  DEFAULT_RUNTIME_PROVIDER,
  DEFAULT_THINKING_LEVEL,
  formatContextWindow,
  normalizeThinkingLevels,
  parseRuntimeModelKey,
  resolveFallbackThinkingState,
  resolveRuntimeProvider,
  type RuntimeModelOption,
  type ThinkingConfigState,
  type ThinkingLevel,
  type VerifiedModelCapability
} from './app-runtime'

type RuntimeStatus = {
  text: string
  tone: 'idle' | 'ok' | 'error'
}

type RuntimeBinding = {
  chatThreadId: string
  workspacePath: string
  provider: string
  model: string
  mcpSignature: string
}

type RuntimeModelOptions = {
  activeThread: Ref<ThreadRow | null>
  threads: Ref<ThreadRow[]>
  messages: Ref<ChatMessage[]>
  inputText: Ref<string>
}

type RuntimeModelState = {
  runtimeModelOptions: Ref<RuntimeModelOption[]>
  selectedRuntimeModel: Ref<string>
  selectedRuntimeProvider: Ref<string>
  thinkingLevelByThreadId: Ref<Record<string, ThinkingLevel>>
  thinkingLevelsByThreadId: Ref<Record<string, ThinkingLevel[]>>
  thinkingSupportByThreadId: Ref<Record<string, boolean>>
  runtimeStatus: Ref<RuntimeStatus>
  runtimeBinding: Ref<RuntimeBinding | null>
  currentModelSupportsImageInput: ComputedRef<boolean>
  runtimeModelLabel: ComputedRef<string>
  activeThinkingState: ComputedRef<ThinkingConfigState>
  activeThinkingLevel: ComputedRef<ThinkingLevel>
  activeThinkingLevels: ComputedRef<ThinkingLevel[]>
  activeThinkingSupported: ComputedRef<boolean>
  selectedContextWindowTokens: ComputedRef<number>
  estimatedContextUsedTokens: ComputedRef<number>
  applyFallbackThinkingConfig: (threadId: string, modelId: string) => void
  resolveThinkingStateForThread: (
    threadId: string | null | undefined,
    modelId: string
  ) => ThinkingConfigState
  buildRuntimeModels: () => Promise<void>
  applyThreadModelSelection: (model: string | null) => void
  resolveWorkspaceModel: (workspacePath: string, threadModel?: string | null) => Promise<string>
  reinitAgentRuntime: (
    chatThreadId: string,
    workspacePath: string,
    modelId: string,
    providerId: string
  ) => Promise<void>
  selectRuntimeModel: (runtimeKey: string) => Promise<void>
  selectThinkingLevel: (level: ThinkingLevel) => Promise<void>
  refreshRuntimeModels: () => void
}

export const useRuntimeModelState = ({
  activeThread,
  threads,
  messages,
  inputText
}: RuntimeModelOptions): RuntimeModelState => {
  const runtimeModelOptions = ref<RuntimeModelOption[]>([])
  const selectedRuntimeModel = ref(DEFAULT_RUNTIME_MODEL_KEY)
  const selectedRuntimeProvider = ref(DEFAULT_RUNTIME_PROVIDER)
  const thinkingLevelByThreadId = ref<Record<string, ThinkingLevel>>({})
  const thinkingLevelsByThreadId = ref<Record<string, ThinkingLevel[]>>({})
  const thinkingSupportByThreadId = ref<Record<string, boolean>>({})
  const runtimeStatus = ref<RuntimeStatus>({
    text: '',
    tone: 'idle'
  })
  const runtimeBinding = ref<RuntimeBinding | null>(null)
  const verifiedModelCapabilities = reactive<Record<string, VerifiedModelCapability>>({})

  const currentModelSupportsImageInput = computed(() => {
    const option = runtimeModelOptions.value.find((item) => item.id === selectedRuntimeModel.value)
    return option ? Boolean(option.supports?.imageInput) : true
  })

  const runtimeModelLabel = computed(() => {
    const found = runtimeModelOptions.value.find((x) => x.id === selectedRuntimeModel.value)
    return found ? found.label : selectedRuntimeModel.value
  })

  const applyThinkingConfig = (
    threadId: string,
    currentLevel: ThinkingLevel,
    availableLevels: ThinkingLevel[],
    supportsThinking: boolean
  ): void => {
    const normalizedLevels =
      supportsThinking && availableLevels.length > 0
        ? normalizeThinkingLevels(availableLevels, currentLevel)
        : (['off'] satisfies ThinkingLevel[])
    const normalizedCurrent =
      supportsThinking && normalizedLevels.includes(currentLevel)
        ? currentLevel
        : normalizedLevels.includes(DEFAULT_THINKING_LEVEL)
          ? DEFAULT_THINKING_LEVEL
          : normalizedLevels[0]

    thinkingLevelByThreadId.value = {
      ...thinkingLevelByThreadId.value,
      [threadId]: supportsThinking ? normalizedCurrent : 'off'
    }
    thinkingLevelsByThreadId.value = {
      ...thinkingLevelsByThreadId.value,
      [threadId]: supportsThinking ? normalizedLevels : ['off']
    }
    thinkingSupportByThreadId.value = {
      ...thinkingSupportByThreadId.value,
      [threadId]: supportsThinking
    }
  }

  const applyFallbackThinkingConfig = (threadId: string, modelId: string): void => {
    const verified = verifiedModelCapabilities[modelId]
    if (verified) {
      const preferredLevel = thinkingLevelByThreadId.value[threadId] ?? null
      const availableLevels = normalizeThinkingLevels(verified.availableLevels, preferredLevel)
      const currentLevel =
        preferredLevel && availableLevels.includes(preferredLevel)
          ? preferredLevel
          : availableLevels.includes(DEFAULT_THINKING_LEVEL)
            ? DEFAULT_THINKING_LEVEL
            : availableLevels[0]
      applyThinkingConfig(threadId, currentLevel, availableLevels, verified.supportsThinking)
      return
    }

    const fallback = resolveFallbackThinkingState(
      runtimeModelOptions.value,
      modelId,
      thinkingLevelByThreadId.value[threadId] ?? null
    )
    applyThinkingConfig(
      threadId,
      fallback.currentLevel,
      fallback.availableLevels,
      fallback.supportsThinking
    )
  }

  const resolveThinkingStateForThread = (
    threadId: string | null | undefined,
    modelId: string
  ): ThinkingConfigState => {
    const key = String(threadId ?? '').trim()
    if (!key) return resolveFallbackThinkingState(runtimeModelOptions.value, modelId, null)

    const currentLevel = thinkingLevelByThreadId.value[key]
    const availableLevels = thinkingLevelsByThreadId.value[key]
    const supportsThinking = thinkingSupportByThreadId.value[key]
    if (currentLevel && availableLevels?.length) {
      return {
        currentLevel,
        availableLevels,
        supportsThinking: supportsThinking ?? availableLevels.some((level) => level !== 'off')
      }
    }

    return resolveFallbackThinkingState(runtimeModelOptions.value, modelId, currentLevel ?? null)
  }

  const activeThinkingState = computed(() =>
    resolveThinkingStateForThread(activeThread.value?.id, selectedRuntimeModel.value)
  )
  const activeThinkingLevel = computed(() => activeThinkingState.value.currentLevel)
  const activeThinkingLevels = computed(() => activeThinkingState.value.availableLevels)
  const activeThinkingSupported = computed(() => activeThinkingState.value.supportsThinking)

  const selectedContextWindowTokens = computed(() => {
    const found = runtimeModelOptions.value.find((m) => m.id === selectedRuntimeModel.value)
    return found?.contextWindowTokens ?? 0
  })

  const estimateTokens = (text: string): number => {
    if (!text) return 0
    return Math.ceil(text.length / 2)
  }

  const estimatedContextUsedTokens = computed(() => {
    const msgTokens = messages.value.reduce((sum, msg) => {
      if (msg.isPending) return sum
      return sum + estimateTokens(msg.content || '')
    }, 0)
    return msgTokens + estimateTokens(inputText.value)
  })

  const applyThreadModelSelection = (model: string | null): void => {
    const nextKey = model || runtimeModelOptions.value[0]?.id || DEFAULT_RUNTIME_MODEL_KEY
    selectedRuntimeModel.value = nextKey
    selectedRuntimeProvider.value = resolveRuntimeProvider(nextKey)
    const parsed = parseRuntimeModelKey(nextKey)
    runtimeStatus.value = {
      text: parsed
        ? `当前模型: ${parsed.providerId}/${parsed.modelId}`
        : `当前模型: ${selectedRuntimeProvider.value}/${nextKey}`,
      tone: 'idle'
    }
  }

  const buildRuntimeModels = async (): Promise<void> => {
    const list = await window.api.db.providers.list()
    const options: RuntimeModelOption[] = []
    for (const p of list.filter((x) => x.enabled)) {
      const providerId = p.runtimeProvider || p.id
      const rows = await window.api.db.providers.models.list(p.id)
      for (const m of rows.filter((x) => x.enabled)) {
        const supports = (() => {
          if (!m.capabilitiesJson) return undefined
          try {
            const parsed = JSON.parse(m.capabilitiesJson) as unknown
            if (!parsed || typeof parsed !== 'object') return undefined
            const capabilities = parsed as {
              imageInput?: unknown
              tools?: unknown
              reasoning?: unknown
              thinkingLevels?: unknown
            }
            return {
              imageInput: Boolean(capabilities.imageInput),
              tools: Boolean(capabilities.tools),
              reasoning: Boolean(capabilities.reasoning),
              thinkingLevels: Array.isArray(capabilities.thinkingLevels)
                ? capabilities.thinkingLevels
                : undefined
            }
          } catch {
            return undefined
          }
        })()

        const modelOption: RuntimeModelOption = {
          id: `${providerId}::${m.modelId}`,
          provider: providerId,
          providerName: p.displayName,
          label: m.label || m.modelId,
          contextWindow: formatContextWindow(m.contextWindowTokens),
          contextWindowTokens: m.contextWindowTokens ?? undefined,
          supports
        }

        if (supports?.reasoning && supports.thinkingLevels) {
          verifiedModelCapabilities[modelOption.id] = {
            availableLevels: supports.thinkingLevels,
            supportsThinking: true
          }
        }

        options.push(modelOption)
      }
    }

    if (options.length === 0) {
      options.push({
        id: DEFAULT_RUNTIME_MODEL_KEY,
        provider: DEFAULT_RUNTIME_PROVIDER,
        providerName: 'Google Gemini',
        label: DEFAULT_MODEL_ID,
        contextWindow: '1M',
        contextWindowTokens: 1_048_576,
        supports: { imageInput: true, tools: true, reasoning: true }
      })
    }

    const dedup = new Map<string, RuntimeModelOption>()
    for (const item of options) {
      if (!dedup.has(item.id)) dedup.set(item.id, item)
    }
    runtimeModelOptions.value = Array.from(dedup.values())
    if (
      runtimeModelOptions.value.length > 0 &&
      !runtimeModelOptions.value.some((m) => m.id === selectedRuntimeModel.value)
    ) {
      applyThreadModelSelection(runtimeModelOptions.value[0].id)
    }
  }

  const resolveWorkspaceModel = async (
    workspacePath: string,
    threadModel?: string | null
  ): Promise<string> => {
    const preferredFromThread = threadModel ?? null
    if (
      preferredFromThread &&
      runtimeModelOptions.value.some((m) => m.id === preferredFromThread)
    ) {
      return preferredFromThread
    }
    const ws = await window.api.db.workspaceSettings.get(workspacePath)
    if (ws?.model && runtimeModelOptions.value.some((m) => m.id === ws.model)) return ws.model
    return runtimeModelOptions.value[0]?.id || DEFAULT_RUNTIME_MODEL_KEY
  }

  const getWorkspaceMcpSignature = async (workspacePath: string): Promise<string> => {
    const rows = await window.api.db.workspaceMcpServers.list(workspacePath)
    const enabledIds = rows
      .filter((row) => row.enabled === 1)
      .map((row) => row.server_id)
      .sort()
    return JSON.stringify(enabledIds)
  }

  const assertAgentOk = (res: unknown, action: 'init' | 'prompt'): void => {
    const ok = typeof res === 'object' && res !== null && 'success' in res && res.success === true
    if (!ok) {
      throw new Error(`Agent ${action} 返回格式异常: ${JSON.stringify(res)}`)
    }
  }

  const refreshThinkingConfig = async (
    chatThreadId: string,
    runtimeKey: string
  ): Promise<boolean> => {
    const result = await window.api.runtime.getThinkingConfig(chatThreadId)
    if (!result.success) return false

    verifiedModelCapabilities[runtimeKey] = {
      availableLevels: result.availableLevels,
      supportsThinking: result.supportsThinking
    }

    applyThinkingConfig(
      chatThreadId,
      result.currentLevel,
      result.availableLevels,
      result.supportsThinking
    )
    return true
  }

  const reinitAgentRuntime = async (
    chatThreadId: string,
    workspacePath: string,
    modelId: string,
    providerId: string
  ): Promise<void> => {
    const mcpSignature = await getWorkspaceMcpSignature(workspacePath)
    const runtimeKey = `${providerId}::${modelId}`
    runtimeStatus.value = { text: `正在切换到 ${modelId}...`, tone: 'idle' }
    const initRes = await window.api.runtime.prepareThread(chatThreadId)
    assertAgentOk(initRes, 'init')
    runtimeBinding.value = {
      chatThreadId,
      workspacePath,
      provider: providerId,
      model: modelId,
      mcpSignature
    }
    await refreshThinkingConfig(chatThreadId, runtimeKey)
    runtimeStatus.value = { text: `已连接 ${providerId}/${modelId}`, tone: 'ok' }
  }

  const selectRuntimeModel = async (runtimeKey: string): Promise<void> => {
    selectedRuntimeModel.value = runtimeKey
    selectedRuntimeProvider.value = resolveRuntimeProvider(runtimeKey)
    if (!activeThread.value) return

    applyFallbackThinkingConfig(activeThread.value.id, runtimeKey)

    await window.api.coreV2.localThreads.update(activeThread.value.id, { model: runtimeKey })
    await window.api.db.workspaceSettings.set(activeThread.value.workspace_path, {
      model: runtimeKey
    })

    activeThread.value = { ...activeThread.value, model: runtimeKey }
    threads.value = threads.value.map((s) =>
      s.id === activeThread.value?.id ? { ...s, model: runtimeKey } : s
    )

    try {
      const parsed = parseRuntimeModelKey(selectedRuntimeModel.value) ?? {
        providerId: DEFAULT_RUNTIME_PROVIDER,
        modelId: DEFAULT_MODEL_ID
      }
      await reinitAgentRuntime(
        activeThread.value.id,
        activeThread.value.workspace_path,
        parsed.modelId,
        parsed.providerId
      )
    } catch (err) {
      console.warn('Silent model sync failed:', err)
      if (activeThread.value.started_at) {
        runtimeBinding.value = null
        runtimeStatus.value = {
          text: err instanceof Error ? err.message.slice(0, 160) : '模型切换失败',
          tone: 'error'
        }
      }
    }
  }

  const selectThinkingLevel = async (level: ThinkingLevel): Promise<void> => {
    const thread = activeThread.value
    if (!thread) return

    const state = resolveThinkingStateForThread(thread.id, selectedRuntimeModel.value)
    const nextLevel = state.availableLevels.includes(level)
      ? level
      : (state.availableLevels.at(0) ?? 'off')

    applyThinkingConfig(thread.id, nextLevel, state.availableLevels, state.supportsThinking)

    const result = await window.api.runtime.setThinkingLevel(thread.id, nextLevel)
    if (!result.success) {
      runtimeStatus.value = {
        text: result.error.slice(0, 120),
        tone: 'error'
      }
      return
    }

    verifiedModelCapabilities[selectedRuntimeModel.value] = {
      availableLevels: result.availableLevels,
      supportsThinking: result.supportsThinking
    }

    applyThinkingConfig(
      thread.id,
      result.currentLevel,
      result.availableLevels,
      result.supportsThinking
    )
  }

  const refreshRuntimeModels = (): void => {
    void buildRuntimeModels()
  }

  return {
    runtimeModelOptions,
    selectedRuntimeModel,
    selectedRuntimeProvider,
    thinkingLevelByThreadId,
    thinkingLevelsByThreadId,
    thinkingSupportByThreadId,
    runtimeStatus,
    runtimeBinding,
    currentModelSupportsImageInput,
    runtimeModelLabel,
    activeThinkingState,
    activeThinkingLevel,
    activeThinkingLevels,
    activeThinkingSupported,
    selectedContextWindowTokens,
    estimatedContextUsedTokens,
    applyFallbackThinkingConfig,
    resolveThinkingStateForThread,
    buildRuntimeModels,
    applyThreadModelSelection,
    resolveWorkspaceModel,
    reinitAgentRuntime,
    selectRuntimeModel,
    selectThinkingLevel,
    refreshRuntimeModels
  }
}
