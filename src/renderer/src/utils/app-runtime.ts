import { reactive } from 'vue'
import type {
  AgentRun,
  AgentTurn,
  AgentToolCall,
  AgentTurnTimelineItem,
  ChatMessage
} from '../components/chat/types'
import type {
  AgentMessageDeltaAppEvent,
  AgentRunProjection,
  AgentThreadProjection,
  AgentThreadWindowPage,
  AgentToolCallProjection,
  AgentTurnProjection
} from '@shared/agent-runtime'
import { getPlainTextFromBlocks } from '@shared/chat-content'
import type {
  TransportPluginAccountSetupEvent,
  TransportPluginAccountSetupEventState
} from '@shared/transport-plugins'

export const DEFAULT_RUNTIME_PROVIDER = 'google'
export const DEFAULT_MODEL_ID = 'gemini-2.5-flash'
export const DEFAULT_RUNTIME_MODEL_KEY = `${DEFAULT_RUNTIME_PROVIDER}::${DEFAULT_MODEL_ID}`

export type RuntimeModelOption = {
  id: string
  provider: string
  providerName: string
  label: string
  contextWindow?: string
  contextWindowTokens?: number
  supports?: {
    imageInput?: boolean
    tools?: boolean
    reasoning?: boolean
    thinkingLevels?: ThinkingLevel[]
  }
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type ThinkingConfigState = {
  currentLevel: ThinkingLevel
  availableLevels: ThinkingLevel[]
  supportsThinking: boolean
}

export type VerifiedModelCapability = {
  availableLevels: ThinkingLevel[]
  supportsThinking: boolean
}

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium'
export const DEFAULT_THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh']

export const parseRuntimeModelKey = (
  key: string
): { providerId: string; modelId: string } | null => {
  const idx = (key ?? '').indexOf('::')
  if (idx <= 0) return null
  const providerId = key.slice(0, idx).trim()
  const modelId = key.slice(idx + 2).trim()
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}

export const formatContextWindow = (n?: number | null) => {
  if (!n || Number.isNaN(n)) return undefined
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export const resolveRuntimeProvider = (runtimeKey: string): string => {
  const parsed = parseRuntimeModelKey(runtimeKey)
  return parsed?.providerId ?? DEFAULT_RUNTIME_PROVIDER
}

export const modelSupportsThinking = (
  options: RuntimeModelOption[],
  modelId: string | null | undefined
): boolean => Boolean(options.find((item) => item.id === modelId)?.supports?.reasoning)

export const normalizeThinkingLevels = (
  levels: ThinkingLevel[],
  currentLevel?: ThinkingLevel | null
): ThinkingLevel[] => {
  const next = Array.from(new Set(levels))
  if (currentLevel && !next.includes(currentLevel)) next.push(currentLevel)
  return next.length > 0 ? next : ['off']
}

export const resolveFallbackThinkingState = (
  options: RuntimeModelOption[],
  modelId: string,
  preferredLevel?: ThinkingLevel | null
): ThinkingConfigState => {
  const option = options.find((item) => item.id === modelId)
  if (!option?.supports?.reasoning) {
    return {
      currentLevel: 'off',
      availableLevels: ['off'],
      supportsThinking: false
    }
  }

  // 【优化】从数据库中读取已验证的推理级别列表
  const verifiedLevels = option.supports.thinkingLevels
  const baseLevels =
    verifiedLevels && verifiedLevels.length > 0 ? verifiedLevels : DEFAULT_THINKING_LEVELS

  const availableLevels = normalizeThinkingLevels(baseLevels, preferredLevel)
  const currentLevel =
    preferredLevel && availableLevels.includes(preferredLevel)
      ? preferredLevel
      : availableLevels.includes(DEFAULT_THINKING_LEVEL)
        ? DEFAULT_THINKING_LEVEL
        : availableLevels[0]

  return {
    currentLevel,
    availableLevels,
    supportsThinking: true
  }
}

export const projectToolCallToChatToolCall = (tool: AgentToolCallProjection): AgentToolCall => ({
  id: tool.toolCallId,
  agentTurnId: tool.agentTurnId,
  name: tool.name,
  kind: tool.kind,
  invocation: tool.invocation,
  skillName: tool.skillName,
  args: tool.args,
  status: tool.status,
  summary: tool.summary,
  accountSetupQr: tool.accountSetupQr ? { ...tool.accountSetupQr } : undefined,
  fileChanges: tool.fileChanges,
  toolImages: tool.toolImages?.map((image) => ({ ...image })),
  startedAt: tool.startedAt,
  endedAt: tool.endedAt,
  durationMs: tool.durationMs
})

export const projectTurnToChatTurn = (turn: AgentTurnProjection): AgentTurn => ({
  id: turn.agentTurnId,
  index: turn.index,
  status: turn.status,
  text: turn.text,
  terminationReason: turn.terminationReason,
  errorMessage: turn.errorMessage,
  timelineItems: turn.timelineItems.map((item) => ({ ...item })),
  startedAt: turn.startedAt,
  endedAt: turn.endedAt,
  toolCalls: turn.toolCalls.map((tool) => projectToolCallToChatToolCall(tool))
})

export const projectRunToChatRun = (run: AgentRunProjection): AgentRun => ({
  id: run.agentRunId,
  threadId: run.threadId,
  status: run.status,
  turns: run.turns.map((turn) => projectTurnToChatTurn(turn)),
  text: run.text,
  startedAt: run.startedAt,
  endedAt: run.endedAt,
  termination: run.termination ? { ...run.termination } : undefined,
  triggerKind: run.triggerKind
})

export const syncChatRunFromProjection = (target: AgentRun, run: AgentRunProjection): AgentRun => {
  target.id = run.agentRunId
  target.threadId = run.threadId
  target.status = run.status
  target.text = run.text
  target.startedAt = run.startedAt
  target.endedAt = run.endedAt
  target.termination = run.termination ? { ...run.termination } : undefined
  target.triggerKind = run.triggerKind
  target.turns.splice(
    0,
    target.turns.length,
    ...run.turns.map((turn) => projectTurnToChatTurn(turn))
  )
  return target
}

export const turnHasVisibleAssistantOutput = (turn: AgentTurn): boolean =>
  turn.toolCalls.length > 0 ||
  turn.timelineItems.some(
    (item) =>
      item.kind === 'tool' ||
      item.kind === 'question_answer' ||
      (item.kind === 'thinking' && item.thinking.trim().length > 0) ||
      (item.kind === 'text' && item.text.trim().length > 0)
  )

export const runHasVisibleAssistantOutput = (run: AgentRun | null | undefined): boolean =>
  Boolean(
    run &&
    (run.text.trim().length > 0 || run.turns.some((turn) => turnHasVisibleAssistantOutput(turn)))
  )

export const shouldCreateAssistantMessageForTurn = (turn: AgentTurn): boolean =>
  turn.status === 'running' || Boolean(turn.text.trim()) || turnHasVisibleAssistantOutput(turn)

export const getRunTurnById = (
  run: AgentRun | null | undefined,
  agentTurnId: string | null | undefined
): AgentTurn | null => {
  if (!run || !agentTurnId) return null
  return run.turns.find((turn) => turn.id === agentTurnId) ?? null
}

export const formatRunErrorMessage = (
  message?: string,
  retryAttempt?: number,
  maxRetryAttempts?: number,
  willRetry?: boolean
): string => {
  const errorMsg = message?.trim() || '未知错误'
  if (willRetry && retryAttempt && maxRetryAttempts) {
    return `请求失败，正在重试 (${retryAttempt}/${maxRetryAttempts})...：${errorMsg}`
  }
  if (retryAttempt && maxRetryAttempts) {
    return `请求失败（${retryAttempt}/${maxRetryAttempts}）：${errorMsg}`
  }
  return `请求失败：${errorMsg}`
}

export const getAssistantDisplayContentForRun = (run: AgentRun | null | undefined): string => {
  if (!run) return ''
  if (run.text.trim()) return run.text
  if (run.status === 'error' && run.termination?.message?.trim()) {
    return formatRunErrorMessage(
      run.termination.message.trim(),
      run.termination.retryAttempt,
      run.termination.maxRetryAttempts,
      run.termination.willRetry
    )
  }
  return ''
}

export const getAssistantDisplayContentForTurn = (
  run: AgentRun | null | undefined,
  turn: AgentTurn | null | undefined
): string => {
  if (!turn) return ''
  if (turn.text.trim()) return turn.text
  if (turn.status === 'error') {
    return turn.errorMessage?.trim() || getAssistantDisplayContentForRun(run)
  }
  return ''
}

export const buildRunFinishedNotificationPreview = (
  content: string,
  maxLength = 120
): string => {
  const normalized = String(content ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''
  if (maxLength <= 0 || normalized.length <= maxLength) return normalized
  if (maxLength <= 3) return normalized.slice(0, maxLength)
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`
}

export const getRunFinishedNotificationPreview = (
  run: AgentRun | null | undefined,
  maxLength = 120
): string => {
  if (!run) return ''
  for (let index = run.turns.length - 1; index >= 0; index -= 1) {
    const content = getAssistantDisplayContentForTurn(run, run.turns[index])
    if (content.trim()) return buildRunFinishedNotificationPreview(content, maxLength)
  }
  return buildRunFinishedNotificationPreview(getAssistantDisplayContentForRun(run), maxLength)
}

export const ensureChatTurnInRun = (run: AgentRun, turnId: string | null): AgentTurn => {
  const existing =
    (turnId ? run.turns.find((turn) => turn.id === turnId) : null) ?? run.turns.at(-1) ?? null
  if (existing) return existing
  const created: AgentTurn = {
    id: turnId ?? crypto.randomUUID(),
    index: run.turns.length,
    status: 'running',
    toolCalls: [],
    text: '',
    timelineItems: [],
    startedAt: Date.now()
  }
  run.turns.push(created)
  return created
}

const findChatTurnTextItem = (
  turn: AgentTurn,
  agentMessageId: string | null
): Extract<AgentTurnTimelineItem, { kind: 'text' }> | null => {
  if (agentMessageId) {
    return (
      turn.timelineItems.find(
        (item): item is Extract<AgentTurnTimelineItem, { kind: 'text' }> =>
          item.kind === 'text' && item.agentMessageId === agentMessageId
      ) ?? null
    )
  }
  const lastItem = turn.timelineItems.at(-1)
  return lastItem?.kind === 'text' && !lastItem.agentMessageId ? lastItem : null
}

const findChatTurnThinkingItem = (
  turn: AgentTurn,
  agentMessageId: string | null
): Extract<AgentTurnTimelineItem, { kind: 'thinking' }> | null => {
  for (let index = turn.timelineItems.length - 1; index >= 0; index -= 1) {
    const item = turn.timelineItems[index]
    if (item.kind !== 'thinking') continue
    if (item.endedAt != null) continue
    if (agentMessageId) {
      if (item.agentMessageId === agentMessageId) return item
    } else if (!item.agentMessageId) {
      return item
    }
  }
  return null
}

const recomputeChatTurnText = (turn: AgentTurn): string => {
  turn.text = turn.timelineItems
    .filter(
      (item): item is Extract<AgentTurnTimelineItem, { kind: 'text' }> => item.kind === 'text'
    )
    .map((item) => item.text)
    .join('')
  return turn.text
}

const appendChatTurnText = (
  turn: AgentTurn,
  agentMessageId: string | null,
  delta: string,
  timestamp: number
): string => {
  if (!delta) return findChatTurnTextItem(turn, agentMessageId)?.text ?? ''

  let item = findChatTurnTextItem(turn, agentMessageId)
  if (!item) {
    item = {
      id: `text:${agentMessageId || crypto.randomUUID()}`,
      kind: 'text',
      text: '',
      agentMessageId: agentMessageId ?? undefined,
      startedAt: timestamp
    }
    turn.timelineItems.push(item)
  }

  item.text += delta
  item.endedAt = timestamp
  recomputeChatTurnText(turn)
  return item.text
}

const ensureChatTurnThinkingItem = (
  turn: AgentTurn,
  agentMessageId: string | null,
  timestamp: number
): Extract<AgentTurnTimelineItem, { kind: 'thinking' }> => {
  let item = findChatTurnThinkingItem(turn, agentMessageId)
  if (!item) {
    item = {
      id: agentMessageId
        ? `thinking:${agentMessageId}:${crypto.randomUUID()}`
        : `thinking:${crypto.randomUUID()}`,
      kind: 'thinking',
      thinking: '',
      agentMessageId: agentMessageId ?? undefined,
      startedAt: timestamp
    }
    turn.timelineItems.push(item)
  }
  return item
}

const finishLastOpenChatTurnThinkingItem = (turn: AgentTurn, timestamp: number): void => {
  for (let index = turn.timelineItems.length - 1; index >= 0; index -= 1) {
    const item = turn.timelineItems[index]
    if (item.kind !== 'thinking') continue
    if (item.endedAt != null) continue
    item.endedAt = timestamp
    return
  }
}

const appendChatTurnThinking = (
  turn: AgentTurn,
  agentMessageId: string | null,
  delta: string,
  timestamp: number
): string => {
  const item = ensureChatTurnThinkingItem(turn, agentMessageId, timestamp)
  if (delta) item.thinking += delta
  item.endedAt = undefined
  return item.thinking
}

export const syncToolProjectionIntoRun = (run: AgentRun, tool: AgentToolCallProjection): void => {
  const turn = ensureChatTurnInRun(run, tool.agentTurnId)
  finishLastOpenChatTurnThinkingItem(turn, tool.startedAt)
  const ownerTurn =
    run.turns.find((entry) => entry.toolCalls.some((call) => call.id === tool.toolCallId)) ?? null
  let call =
    ownerTurn?.toolCalls.find((entry) => entry.id === tool.toolCallId) ??
    turn.toolCalls.find((entry) => entry.id === tool.toolCallId) ??
    null

  if (ownerTurn && ownerTurn !== turn) {
    ownerTurn.toolCalls = ownerTurn.toolCalls.filter((entry) => entry.id !== tool.toolCallId)
    ownerTurn.timelineItems = ownerTurn.timelineItems.filter(
      (item) => !(item.kind === 'tool' && item.toolCallId === tool.toolCallId)
    )
  }

  if (!call) {
    call = {
      id: tool.toolCallId,
      agentTurnId: tool.agentTurnId,
      name: tool.name,
      kind: tool.kind,
      invocation: tool.invocation,
      skillName: tool.skillName,
      args: tool.args,
      status: tool.status,
      summary: tool.summary,
      accountSetupQr: tool.accountSetupQr ? { ...tool.accountSetupQr } : undefined,
      fileChanges: tool.fileChanges,
      toolImages: tool.toolImages?.map((image) => ({ ...image })),
      startedAt: tool.startedAt,
      endedAt: tool.endedAt,
      durationMs: tool.durationMs
    }
    turn.toolCalls.push(call)
  } else {
    call.agentTurnId = tool.agentTurnId
    call.name = tool.name
    call.kind = tool.kind
    call.invocation = tool.invocation
    call.skillName = tool.skillName
    call.args = tool.args
    call.status = tool.status
    call.summary = tool.summary
    call.accountSetupQr = tool.accountSetupQr ? { ...tool.accountSetupQr } : undefined
    call.fileChanges = tool.fileChanges
    call.toolImages = tool.toolImages?.map((image) => ({ ...image }))
    call.startedAt = tool.startedAt
    call.endedAt = tool.endedAt
    call.durationMs = tool.durationMs
    if (!turn.toolCalls.some((entry) => entry.id === tool.toolCallId)) turn.toolCalls.push(call)
  }

  if (
    !turn.timelineItems.some((item) => item.kind === 'tool' && item.toolCallId === tool.toolCallId)
  ) {
    turn.timelineItems.push({
      id: `tool:${tool.toolCallId}`,
      kind: 'tool',
      toolCallId: tool.toolCallId
    })
  }
}

type TransportSetupQrStatus = NonNullable<NonNullable<AgentToolCall['accountSetupQr']>['status']>

const mapTransportSetupEventStatus = (
  event: TransportPluginAccountSetupEvent
): TransportSetupQrStatus => {
  if (event.type === 'qr') return 'active'
  if (event.type === 'completed') return 'completed'
  if (event.type === 'expired') return 'expired'
  if (event.type === 'failed') return 'failed'

  const statusByState: Record<TransportPluginAccountSetupEventState, TransportSetupQrStatus> = {
    waiting_scan: 'active',
    scanned: 'scanned',
    waiting_confirm: 'scanned',
    completed: 'completed',
    expired: 'expired',
    cancelled: 'cancelled',
    failed: 'failed'
  }
  return statusByState[event.state]
}

// const summarizeTransportSetupEventForDebug = (
//   event: TransportPluginAccountSetupEvent
// ): Record<string, unknown> => ({
//   type: event.type,
//   pluginId: event.pluginId ?? null,
//   accountId: event.accountId ?? null,
//   methodId: event.methodId ?? null,
//   sessionId: event.sessionId,
//   state: 'state' in event ? event.state : null,
//   expiresAt: 'expiresAt' in event ? event.expiresAt : null,
//   reason: 'reason' in event ? event.reason : null,
//   retryable: 'retryable' in event ? event.retryable : null,
//   error: 'error' in event ? event.error : null
// })

// const summarizeTransportSetupQrForDebug = (
//   qr: NonNullable<AgentToolCall['accountSetupQr']>
// ): Record<string, unknown> => ({
//   transportId: qr.transportId,
//   accountId: qr.accountId,
//   methodId: qr.methodId,
//   sessionId: qr.sessionId,
//   status: qr.status ?? 'active',
//   startedAt: qr.startedAt ?? null,
//   expiresAt: qr.expiresAt ?? null
// })

const transportSetupEventMatchesQr = (
  qr: NonNullable<AgentToolCall['accountSetupQr']>,
  event: TransportPluginAccountSetupEvent
): boolean => {
  if (qr.sessionId !== event.sessionId) return false
  if (event.pluginId && qr.transportId !== event.pluginId) return false
  if (event.accountId && qr.accountId !== event.accountId) return false
  if (event.methodId && qr.methodId !== event.methodId) return false
  return true
}

export const applyTransportAccountSetupEventToRuns = (
  runs: Iterable<AgentRun>,
  event: TransportPluginAccountSetupEvent
): boolean => {
  let changed = false
  for (const run of runs) {
    for (const turn of run.turns) {
      for (const tool of turn.toolCalls) {
        const qr = tool.accountSetupQr
        if (!qr || !transportSetupEventMatchesQr(qr, event)) continue

        // const before = summarizeTransportSetupQrForDebug(qr)
        qr.status = mapTransportSetupEventStatus(event)
        if (event.type === 'qr') {
          const imageUrl = event.qrImageDataUrl || event.qrUrl || ''
          if (imageUrl) qr.imageUrl = imageUrl
          if (event.qrText) qr.qrText = event.qrText
          if (event.expiresAt) qr.expiresAt = event.expiresAt
        }
        // console.info('[transport-setup:event:applied]', {
        //   event: summarizeTransportSetupEventForDebug(event),
        //   runId: run.id,
        //   threadId: run.threadId,
        //   turnId: turn.id ?? null,
        //   toolCallId: tool.id,
        //   before,
        //   after: summarizeTransportSetupQrForDebug(qr)
        // })
        changed = true
      }
    }
  }
  return changed
}

export const applyMessageDeltaToRun = (run: AgentRun, event: AgentMessageDeltaAppEvent): void => {
  const turn = ensureChatTurnInRun(run, event.agentTurnId)
  if (event.delta) {
    if (event.contentKind === 'thinking') {
      appendChatTurnThinking(turn, event.agentMessageId, event.delta, event.timestamp)
      return
    }
    finishLastOpenChatTurnThinkingItem(turn, event.timestamp)
    run.text = appendChatTurnText(turn, event.agentMessageId, event.delta, event.timestamp)
  }
}

export const getLatestAssistantMessageIn = (list: ChatMessage[]) => {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].role === 'assistant') return list[i]
  }
  return null
}

export const findAssistantTurnMessageIn = (
  list: ChatMessage[],
  run: AgentRun | null,
  turnId: string | null | undefined
): ChatMessage | null => {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    if (message.role !== 'assistant') continue
    if ((message.agentRunId ?? null) !== (run?.id ?? null)) continue
    if ((message.agentTurnId ?? null) !== (turnId ?? null)) continue
    return message
  }
  return null
}

export const ensureAssistantTurnMessageIn = (
  list: ChatMessage[],
  run: AgentRun | null,
  turn: AgentTurn | null,
  allowCreate = true
): ChatMessage | null => {
  const turnId = turn?.id ?? null
  const existing = findAssistantTurnMessageIn(list, run, turnId)
  if (existing) {
    if (run) {
      existing.agentRunId = run.id
      existing.run = run
    }
    if (turnId) existing.agentTurnId = turnId
    return existing
  }

  const last = list.at(-1) ?? null
  if (
    last &&
    last.role === 'assistant' &&
    last.isPending &&
    !last.id &&
    (last.agentRunId == null || (run && last.agentRunId === run.id)) &&
    !last.agentTurnId &&
    !last.run &&
    !last.widget &&
    !(last.blocks?.length ?? 0)
  ) {
    if (run) {
      last.agentRunId = run.id
      last.run = run
    }
    if (turnId) last.agentTurnId = turnId
    return last
  }
  if (!allowCreate) return null
  const next: ChatMessage = {
    role: 'assistant',
    content: '',
    isPending: true,
    agentRunId: run?.id,
    agentTurnId: turnId ?? undefined,
    run: run ?? undefined
  }
  list.push(next)
  return next
}

export const serializeAssistantMessageContent = (message: ChatMessage): string => {
  const chunks: string[] = []
  if (message.widget) {
    const persistedWidget = {
      ...message.widget,
      url: undefined,
      widgetId: undefined
    }
    chunks.push(`<!--PI_WIDGET:${encodeURIComponent(JSON.stringify(persistedWidget))}-->`)
  }
  return `${chunks.join('')}${message.content ?? getPlainTextFromBlocks(message.blocks) ?? ''}`
}

export const buildChatStateFromThreadProjection = (
  projection: Pick<AgentThreadProjection, 'runs' | 'messages' | 'activeRunId'>
): {
  runMap: Map<string, AgentRun>
  chatMessages: ChatMessage[]
  activeRun: AgentRun | null
} => {
  const runMap = new Map<string, AgentRun>()
  for (const runProjection of projection.runs) {
    const run = reactive(projectRunToChatRun(runProjection))
    runMap.set(run.id, run)
  }

  const chatMessages = reactive(
    projection.messages.map((message) => {
      const run =
        message.role === 'assistant' && message.agentRunId
          ? runMap.get(message.agentRunId)
          : undefined
      return {
        id: message.id,
        createdAt: message.createdAt,
        runtimeSequence: message.runtimeSequence ?? null,
        role: message.role,
        messageKind: message.messageKind,
        includeInAgentContext: message.includeInAgentContext ?? true,
        agentEntryId: message.agentEntryId ?? undefined,
        submissionId: message.submissionId ?? undefined,
        content: message.content,
        blocks: message.blocks,
        isPending: message.isPending,
        agentRunId: run?.id ?? message.agentRunId ?? undefined,
        agentTurnId: message.agentTurnId ?? undefined,
        run,
        widget: message.widget
      } satisfies ChatMessage
    })
  ) as ChatMessage[]

  const activeRun = projection.activeRunId ? (runMap.get(projection.activeRunId) ?? null) : null
  return { runMap, chatMessages, activeRun }
}

export const buildChatStateFromThreadWindowPage = (
  page: Pick<AgentThreadWindowPage, 'runs' | 'messages' | 'activeRunId'>
): {
  runMap: Map<string, AgentRun>
  chatMessages: ChatMessage[]
  activeRun: AgentRun | null
} => buildChatStateFromThreadProjection(page)
