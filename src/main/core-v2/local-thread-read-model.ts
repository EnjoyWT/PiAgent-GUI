import type {
  AgentRunProjection,
  AgentRunStatus as RuntimeAgentRunStatus,
  AgentThreadMessageProjection,
  AgentThreadProjection,
  AgentThreadWindowAroundTarget,
  AgentThreadWindowCursor,
  AgentThreadWindowPage,
  AgentToolCallProjection,
  AgentTurnProjection,
  AgentTurnTimelineItem,
  ChatFileChange,
  EventOrigin
} from '../../shared/agent-runtime.ts'
import type { ConversationEventRow } from '../../preload/db-types.ts'
import { getPlainTextFromBlocks, type ChatContentBlock } from '../../shared/chat-content.ts'
import type {
  AgentRun,
  ConversationMessage,
  ConversationMessagePage,
  ConversationMessagePageCursor,
  CoreQueryService,
  EventLogAggregateKey,
  EventLogEntry
} from './domain.ts'
import { buildLocalThreadRoutingKey } from './local-thread-binding.ts'
import {
  parseLocalThreadMessageMeta,
  type LocalThreadMessageMeta
} from './local-thread-message-payload.ts'
import { isSystemFollowupSyntheticPromptText } from './system-followup-synthetic-prompt.ts'
import { normalizeCoreTimestamp, parseCoreTimestampMs } from './time.ts'
import type { AgentRunProjectionPayload } from './agent-run-projections.ts'
import { getCoreV2Service } from './sqlite-db.ts'

const DEFAULT_THREAD_WINDOW_LIMIT = 20
const PROGRESS_MARKER_PREFIX = '<!--PI_PROGRESS:'
const PROGRESS_MARKER_SUFFIX = '-->'
const WIDGET_MARKER_PREFIX = '<!--PI_WIDGET:'
const AUTOMATION_PROMPT_PREFIX = '[SYSTEM: You are running as a scheduled automation task.'

type JsonRecord = Record<string, unknown>

type LocalThreadReadModelQuery = Pick<
  CoreQueryService,
  | 'getConversationByBindingRoutingKey'
  | 'getConversationMessages'
  | 'listConversationMessagesPage'
  | 'listConversationRuns'
  | 'listAgentRunsByIds'
  | 'listEventLogByAggregateKeys'
> & {
  listAgentRunProjectionPayloadsByIds(runIds: string[]): AgentRunProjectionPayload[]
}

type BuildLocalThreadWindowOptions = {
  limit?: number
  beforeCursor?: AgentThreadWindowCursor | null
  around?: AgentThreadWindowAroundTarget | null
  includeLiveRunSnapshot?: boolean
}

const asRecord = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const parseIsoTimeMs = (value?: string | null): number => {
  return parseCoreTimestampMs(value)
}

const parseEventOrigin = (value: unknown): EventOrigin => {
  if (value === 'runtime' || value === 'inferred' || value === 'reconciled') return value
  return 'runtime'
}

const normalizeWidgetProjection = (value: unknown) => {
  const record = asRecord(value)
  if (!record) return undefined
  const kind = asString(record.kind)
  const placement = asString(record.placement)
  if (kind !== 'html' || placement !== 'inline') return undefined
  const configRecord = asRecord(record.config)
  return {
    kind,
    placement,
    title: asString(record.title) || undefined,
    html: asString(record.html) || undefined,
    url: undefined,
    widgetId: undefined,
    config: configRecord
      ? {
          showHeader:
            typeof configRecord.showHeader === 'boolean' ? configRecord.showHeader : undefined,
          fullWidth:
            typeof configRecord.fullWidth === 'boolean' ? configRecord.fullWidth : undefined
        }
      : undefined
  } as const
}

const deserializeAssistantContent = (
  raw: string
): {
  content: string
  progress?: { toolSteps?: Array<unknown> }
  widget?: AgentThreadMessageProjection['widget']
} => {
  let text = raw ?? ''
  let progress: { toolSteps?: Array<unknown> } | undefined
  let widget: AgentThreadMessageProjection['widget'] | undefined

  let matched = true
  while (matched) {
    matched = false
    if (text.startsWith(WIDGET_MARKER_PREFIX)) {
      const end = text.indexOf(PROGRESS_MARKER_SUFFIX)
      if (end < 0) break
      const encoded = text.slice(WIDGET_MARKER_PREFIX.length, end)
      text = text.slice(end + PROGRESS_MARKER_SUFFIX.length).replace(/^\n/, '')
      matched = true
      try {
        widget = normalizeWidgetProjection(JSON.parse(decodeURIComponent(encoded)))
      } catch {
        // ignore malformed widget marker
      }
      continue
    }
    if (text.startsWith(PROGRESS_MARKER_PREFIX)) {
      const end = text.indexOf(PROGRESS_MARKER_SUFFIX)
      if (end < 0) break
      const encoded = text.slice(PROGRESS_MARKER_PREFIX.length, end)
      text = text.slice(end + PROGRESS_MARKER_SUFFIX.length).replace(/^\n/, '')
      matched = true
      try {
        const parsed = JSON.parse(decodeURIComponent(encoded)) as unknown
        const progressRecord = asRecord(parsed)
        if (progressRecord) {
          progress = {
            toolSteps: Array.isArray(progressRecord.toolSteps) ? progressRecord.toolSteps : []
          }
        }
      } catch {
        // ignore malformed progress marker
      }
    }
  }

  return { content: text, progress, widget }
}

const normalizeFileChanges = (value: unknown): ChatFileChange[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const changes: ChatFileChange[] = []
  for (const item of value) {
    const record = asRecord(item)
    const path = asString(record?.path).trim()
    if (!path) continue
    const addedLines = asNumber(record?.addedLines)
    const removedLines = asNumber(record?.removedLines)
    changes.push({
      path,
      diff: asString(record?.diff) || undefined,
      addedLines: addedLines ?? undefined,
      removedLines: removedLines ?? undefined
    })
  }
  return changes.length > 0 ? changes : undefined
}

const normalizeToolImages = (value: unknown): AgentToolCallProjection['toolImages'] => {
  if (!Array.isArray(value)) return undefined
  const images: NonNullable<AgentToolCallProjection['toolImages']> = []
  for (const item of value) {
    const record = asRecord(item)
    const title = asString(record?.title).trim()
    const mimeType = asString(record?.mimeType).trim()
    const imagePath = asString(record?.path).trim()
    const url = asString(record?.url).trim()
    if (!title || !mimeType || !imagePath || !url) continue
    images.push({
      title,
      mimeType,
      path: imagePath,
      url,
      width: asNumber(record?.width) ?? undefined,
      height: asNumber(record?.height) ?? undefined
    })
  }
  return images.length > 0 ? images : undefined
}

const normalizeStoredTransportSetupQr = (
  value: unknown,
  fallbackStartedAt?: number
): AgentToolCallProjection['accountSetupQr'] => {
  const record = asRecord(value)
  if (!record) return undefined
  const transportId = asString(record.transportId).trim()
  const accountId = asString(record.accountId).trim()
  const methodId = asString(record.methodId).trim()
  const sessionId = asString(record.sessionId).trim()
  const imageUrl = asString(record.imageUrl).trim()
  if (!transportId || !accountId || !methodId || !sessionId || !imageUrl) return undefined

  const rawStatus = asString(record.status).trim()
  const status =
    rawStatus === 'active' ||
    rawStatus === 'scanned' ||
    rawStatus === 'completed' ||
    rawStatus === 'expired' ||
    rawStatus === 'cancelled' ||
    rawStatus === 'failed'
      ? rawStatus
      : undefined

  return {
    transportId,
    accountId,
    methodId,
    sessionId,
    imageUrl,
    qrText: asString(record.qrText).trim() || undefined,
    startedAt:
      asString(record.startedAt).trim() ||
      (typeof fallbackStartedAt === 'number' && Number.isFinite(fallbackStartedAt)
        ? new Date(fallbackStartedAt).toISOString()
        : undefined),
    expiresAt: asString(record.expiresAt).trim() || undefined,
    status
  }
}

const normalizeStoredToolCall = (
  value: unknown,
  runId: string,
  turnId: string,
  fallbackStartedAt: number,
  index: number
): AgentToolCallProjection => {
  const record = asRecord(value)
  const toolCallId =
    asString(record?.toolCallId).trim() ||
    asString(record?.id).trim() ||
    `${runId}:turn:${turnId}:tool:${index}`
  const startedAt = asNumber(record?.startedAt) ?? fallbackStartedAt
  const statusValue = asString(record?.status)
  const status =
    statusValue === 'running' || statusValue === 'done' || statusValue === 'error'
      ? statusValue
      : 'done'
  return {
    toolCallId,
    agentTurnId: turnId,
    name: asString(record?.name) || asString(record?.toolName) || 'tool',
    kind: asString(record?.kind) === 'question' ? 'question' : 'tool',
    invocation: asString(record?.invocation) === 'skill' ? 'skill' : 'direct',
    skillName: asString(record?.skillName).trim() || undefined,
    status,
    args: record?.args,
    summary: asString(record?.summary) || undefined,
    accountSetupQr: normalizeStoredTransportSetupQr(record?.accountSetupQr, startedAt),
    fileChanges: normalizeFileChanges(record?.fileChanges),
    toolImages: normalizeToolImages(record?.toolImages),
    startedAt,
    endedAt: asNumber(record?.endedAt) ?? undefined,
    durationMs: asNumber(record?.durationMs) ?? undefined,
    origin: parseEventOrigin(record?.origin)
  }
}

const normalizeStoredTimelineItem = (
  value: unknown,
  turnId: string,
  fallbackStartedAt: number
): AgentTurnTimelineItem | null => {
  const record = asRecord(value)
  const kind = asString(record?.kind).trim()

  if (kind === 'text') {
    const text = asString(record?.text)
    if (!text.trim()) return null
    const agentMessageId = asString(record?.agentMessageId).trim() || undefined
    return {
      id:
        asString(record?.id).trim() || `text:${agentMessageId || `${turnId}:${fallbackStartedAt}`}`,
      kind: 'text',
      text,
      agentMessageId,
      startedAt: asNumber(record?.startedAt) ?? fallbackStartedAt,
      endedAt: asNumber(record?.endedAt) ?? undefined
    }
  }

  if (kind === 'thinking') {
    const thinking = asString(record?.thinking)
    const agentMessageId = asString(record?.agentMessageId).trim() || undefined
    return {
      id:
        asString(record?.id).trim() ||
        `thinking:${agentMessageId || `${turnId}:${fallbackStartedAt}`}`,
      kind: 'thinking',
      thinking,
      agentMessageId,
      startedAt: asNumber(record?.startedAt) ?? fallbackStartedAt,
      endedAt: asNumber(record?.endedAt) ?? undefined
    }
  }

  if (kind === 'tool') {
    const rawId = asString(record?.id).trim()
    const toolCallId =
      asString(record?.toolCallId).trim() || (rawId.startsWith('tool:') ? rawId.slice(5) : rawId)
    if (!toolCallId) return null
    return {
      id: rawId || `tool:${toolCallId}`,
      kind: 'tool',
      toolCallId
    }
  }

  if (kind === 'question_answer') {
    const toolCallId = asString(record?.toolCallId).trim()
    const text = asString(record?.text)
    if (!toolCallId || !text.trim()) return null
    return {
      id: asString(record?.id).trim() || `question-answer:${turnId}:${toolCallId}`,
      kind: 'question_answer',
      toolCallId,
      text,
      startedAt: asNumber(record?.startedAt) ?? fallbackStartedAt
    }
  }

  if (kind === 'questionnaire_question') {
    const toolCallId = asString(record?.toolCallId).trim()
    const text = asString(record?.text)
    const stepIndex = asNumber(record?.stepIndex)
    if (!toolCallId || !text.trim() || stepIndex == null) return null
    return {
      id:
        asString(record?.id).trim() ||
        `questionnaire-question:${turnId}:${toolCallId}:${stepIndex}`,
      kind: 'questionnaire_question',
      toolCallId,
      stepIndex,
      text,
      startedAt: asNumber(record?.startedAt) ?? fallbackStartedAt
    }
  }

  if (kind === 'questionnaire_answer') {
    const toolCallId = asString(record?.toolCallId).trim()
    const text = asString(record?.text)
    const stepIndex = asNumber(record?.stepIndex)
    if (!toolCallId || !text.trim() || stepIndex == null) return null
    return {
      id:
        asString(record?.id).trim() || `questionnaire-answer:${turnId}:${toolCallId}:${stepIndex}`,
      kind: 'questionnaire_answer',
      toolCallId,
      stepIndex,
      text,
      startedAt: asNumber(record?.startedAt) ?? fallbackStartedAt
    }
  }

  return null
}

const synthesizeLegacyTimelineItems = (
  turnId: string,
  text: string,
  toolCalls: AgentToolCallProjection[],
  startedAt: number
): AgentTurnTimelineItem[] => {
  const items: AgentTurnTimelineItem[] = []
  if (text.trim()) {
    items.push({
      id: `text:legacy:${turnId}`,
      kind: 'text',
      text,
      startedAt,
      endedAt: undefined
    })
  }
  for (const tool of toolCalls) {
    items.push({
      id: `tool:${tool.toolCallId}`,
      kind: 'tool',
      toolCallId: tool.toolCallId
    })
  }
  return items
}

const normalizeStoredTurn = (
  value: unknown,
  runId: string,
  fallbackStartedAt: number,
  index: number
): AgentTurnProjection => {
  const record = asRecord(value)
  const agentTurnId =
    asString(record?.agentTurnId).trim() || asString(record?.id).trim() || `${runId}:turn:${index}`
  const startedAt = asNumber(record?.startedAt) ?? fallbackStartedAt
  const toolCallsRaw = Array.isArray(record?.toolCalls) ? record.toolCalls : []
  const toolCalls = toolCallsRaw.map((tool, toolIndex) =>
    normalizeStoredToolCall(tool, runId, agentTurnId, startedAt, toolIndex)
  )
  const storedText = asString(record?.text)
  const storedTimelineItems = Array.isArray(record?.timelineItems)
    ? record.timelineItems
        .map((item) => normalizeStoredTimelineItem(item, agentTurnId, startedAt))
        .filter((item): item is AgentTurnTimelineItem => Boolean(item))
    : synthesizeLegacyTimelineItems(agentTurnId, storedText, toolCalls, startedAt)
  const explicitStatus = asString(record?.status)
  const inferredStatus = toolCalls.some((tool) => tool.status === 'error')
    ? 'error'
    : toolCalls.some((tool) => tool.status === 'running')
      ? 'running'
      : 'done'
  return {
    agentTurnId,
    index: asNumber(record?.index) ?? index,
    status:
      explicitStatus === 'running' || explicitStatus === 'done' || explicitStatus === 'error'
        ? explicitStatus
        : inferredStatus,
    startedAt,
    endedAt: asNumber(record?.endedAt) ?? undefined,
    text:
      storedText ||
      storedTimelineItems
        .filter(
          (item): item is Extract<AgentTurnTimelineItem, { kind: 'text' }> => item.kind === 'text'
        )
        .map((item) => item.text)
        .join(''),
    terminationReason: asString(record?.terminationReason) || undefined,
    errorMessage: asString(record?.errorMessage) || undefined,
    timelineItems: storedTimelineItems,
    toolCallIds: toolCalls.map((tool) => tool.toolCallId),
    toolCalls
  }
}

const formatRunErrorMessage = (
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

const mapCoreRunStatus = (status: AgentRun['status']): RuntimeAgentRunStatus => {
  if (status === 'finished') return 'done'
  if (status === 'failed') return 'error'
  if (status === 'aborted') return 'aborted'
  return 'running'
}

const buildRunProjectionFromCoreRun = (
  threadId: string,
  run: AgentRun,
  projectionPayload: AgentRunProjectionPayload | null
): AgentRunProjection => {
  const startedAt = parseIsoTimeMs(run.startedAt)
  const turnsRaw = projectionPayload?.projectionTurns ?? []
  const turns = turnsRaw.map((turn, index) => normalizeStoredTurn(turn, run.id, startedAt, index))
  const status = mapCoreRunStatus(run.status)
  const toolCalls = turns.flatMap((turn) => turn.toolCalls)
  return {
    threadId,
    agentRunId: run.id,
    status,
    triggerKind: run.triggerKind,
    startedAt,
    endedAt: run.endedAt ? parseIsoTimeMs(run.endedAt) : undefined,
    turns,
    messages: [],
    toolCalls,
    text: projectionPayload?.projectionText ?? '',
    termination:
      status === 'running' || !run.endedAt
        ? undefined
        : {
            kind: status === 'aborted' ? 'aborted' : status === 'error' ? 'error' : 'success',
            message:
              status === 'error' ? projectionPayload?.projectionText || undefined : undefined,
            at: parseIsoTimeMs(run.endedAt)
          }
  }
}

const buildLegacyRunFromProgress = (
  threadId: string,
  messageId: string,
  content: string,
  progress: { toolSteps?: Array<unknown> },
  createdAt?: string
): AgentRunProjection => {
  const startedAt = parseIsoTimeMs(createdAt)
  const runId = `legacy:${messageId || `${threadId}:${startedAt}`}`
  const turnId = `${runId}:turn:0`
  const toolCalls = (progress.toolSteps ?? []).map((tool, index) =>
    normalizeStoredToolCall(tool, runId, turnId, startedAt, index)
  )
  const runStatus: RuntimeAgentRunStatus = toolCalls.some((tool) => tool.status === 'error')
    ? 'error'
    : 'done'
  const endedAt =
    toolCalls.length > 0
      ? Math.max(...toolCalls.map((tool) => tool.endedAt ?? tool.startedAt ?? startedAt), startedAt)
      : startedAt

  return {
    threadId,
    agentRunId: runId,
    status: runStatus,
    startedAt,
    endedAt,
    turns: [
      {
        agentTurnId: turnId,
        index: 0,
        status: runStatus === 'error' ? 'error' : 'done',
        startedAt,
        endedAt,
        text: content,
        terminationReason: undefined,
        errorMessage: undefined,
        timelineItems: synthesizeLegacyTimelineItems(turnId, content, toolCalls, startedAt),
        toolCallIds: toolCalls.map((tool) => tool.toolCallId),
        toolCalls
      }
    ],
    messages: [],
    toolCalls,
    text: content,
    termination: {
      kind: runStatus === 'error' ? 'error' : 'success',
      at: endedAt
    }
  }
}

const buildMessageProjection = (
  message: ConversationMessage,
  meta: LocalThreadMessageMeta,
  resolvedContent: string,
  agentRunId?: string | null,
  isPending = false,
  widget?: AgentThreadMessageProjection['widget'],
  blocks?: ChatContentBlock[]
): AgentThreadMessageProjection => {
  const isAutomationPrompt =
    message.role === 'user' && resolvedContent.trim().startsWith(AUTOMATION_PROMPT_PREFIX)
  return {
    id: message.externalMessageId ?? message.id,
    createdAt: message.createdAt,
    runtimeSequence: meta.runtimeSequence ?? null,
    agentRunId: agentRunId ?? meta.agentRunId ?? null,
    agentTurnId: meta.agentTurnId ?? null,
    agentEntryId: meta.agentEntryId ?? null,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    messageKind: isAutomationPrompt ? 'automation' : meta.messageKind,
    includeInAgentContext: isAutomationPrompt ? false : meta.includeInAgentContext,
    content: resolvedContent,
    blocks,
    isPending,
    widget
  }
}

const compareProjectedMessages = (
  a: Pick<AgentThreadMessageProjection, 'createdAt' | 'runtimeSequence' | 'id'>,
  b: Pick<AgentThreadMessageProjection, 'createdAt' | 'runtimeSequence' | 'id'>
): number => {
  const createdAtDelta = parseIsoTimeMs(a.createdAt) - parseIsoTimeMs(b.createdAt)
  if (createdAtDelta !== 0) return createdAtDelta

  const aHasSequence = typeof a.runtimeSequence === 'number'
  const bHasSequence = typeof b.runtimeSequence === 'number'
  if (aHasSequence && bHasSequence) {
    const sequenceDelta = (a.runtimeSequence ?? 0) - (b.runtimeSequence ?? 0)
    if (sequenceDelta !== 0) return sequenceDelta
  } else if (aHasSequence !== bHasSequence) {
    return aHasSequence ? -1 : 1
  }

  return (a.id ?? '').localeCompare(b.id ?? '')
}

const insertToolRelatedTimelineItem = (
  turn: AgentTurnProjection,
  toolCallId: string,
  item:
    | Extract<AgentTurnTimelineItem, { kind: 'question_answer' }>
    | Extract<AgentTurnTimelineItem, { kind: 'questionnaire_question' }>
    | Extract<AgentTurnTimelineItem, { kind: 'questionnaire_answer' }>
): void => {
  const existingIndex = turn.timelineItems.findIndex((entry) => entry.id === item.id)
  if (existingIndex >= 0) {
    turn.timelineItems[existingIndex] = item
    return
  }

  const toolIndex = turn.timelineItems.findIndex(
    (entry) => entry.kind === 'tool' && entry.toolCallId === toolCallId
  )
  if (toolIndex < 0) {
    turn.timelineItems.push(item)
    return
  }

  let insertIndex = toolIndex + 1
  while (
    insertIndex < turn.timelineItems.length &&
    (() => {
      const candidate = turn.timelineItems[insertIndex]
      return (
        (candidate?.kind === 'question_answer' ||
          candidate?.kind === 'questionnaire_question' ||
          candidate?.kind === 'questionnaire_answer') &&
        candidate.toolCallId === toolCallId &&
        candidate.startedAt <= item.startedAt
      )
    })()
  ) {
    insertIndex += 1
  }

  turn.timelineItems.splice(insertIndex, 0, item)
}

const turnHasToolTimelineItem = (turn: AgentTurnProjection): boolean =>
  turn.timelineItems.some((entry) => entry.kind === 'tool')

const turnContainsTimestamp = (
  turn: AgentTurnProjection,
  timestamp: number,
  runEndedAt?: number
): boolean => {
  const startedAt = typeof turn.startedAt === 'number' ? turn.startedAt : Number.NEGATIVE_INFINITY
  const endedAt =
    typeof turn.endedAt === 'number'
      ? turn.endedAt
      : typeof runEndedAt === 'number'
        ? runEndedAt
        : Number.POSITIVE_INFINITY
  return timestamp >= startedAt && timestamp <= endedAt
}

const resolveToolRelatedTargetTurn = (
  run: AgentRunProjection,
  toolCallId: string,
  messageCreatedAt: number
): AgentTurnProjection | null => {
  const exactTurn = run.turns.find((turn) =>
    turn.toolCalls.some((tool) => tool.toolCallId === toolCallId)
  )
  if (exactTurn) return exactTurn

  const toolTurns = run.turns.filter(
    (turn) => turn.toolCalls.length > 0 || turnHasToolTimelineItem(turn)
  )
  const matchingWindowTurns = toolTurns.filter((turn) =>
    turnContainsTimestamp(turn, messageCreatedAt, run.endedAt)
  )
  if (matchingWindowTurns.length === 1) return matchingWindowTurns[0] ?? null

  const runEndedAt = typeof run.endedAt === 'number' ? run.endedAt : Number.POSITIVE_INFINITY
  if (
    toolTurns.length === 1 &&
    messageCreatedAt >= run.startedAt &&
    messageCreatedAt <= runEndedAt
  ) {
    return toolTurns[0] ?? null
  }

  return null
}

const runContainsTimestamp = (run: AgentRunProjection, timestamp: number): boolean => {
  const endedAt = typeof run.endedAt === 'number' ? run.endedAt : Number.POSITIVE_INFINITY
  return timestamp >= run.startedAt && timestamp <= endedAt
}

const resolveToolRelatedRun = (
  runs: AgentRunProjection[],
  toolCallId: string,
  messageCreatedAt: number
): AgentRunProjection | null => {
  const exactRun = runs.find((run) =>
    run.turns.some((turn) => turn.toolCalls.some((tool) => tool.toolCallId === toolCallId))
  )
  if (exactRun) return exactRun

  const candidateRuns = runs.filter(
    (run) =>
      runContainsTimestamp(run, messageCreatedAt) &&
      run.turns.some(
        (turn) => resolveToolRelatedTargetTurn(run, toolCallId, messageCreatedAt) === turn
      )
  )
  return candidateRuns.length === 1 ? (candidateRuns[0] ?? null) : null
}

const attachQuestionAnswerRowToRun = (
  run: AgentRunProjection,
  message: ConversationMessage,
  meta: LocalThreadMessageMeta,
  resolvedContent: string
): boolean => {
  const toolCallId = asString(meta.toolCallId).trim()
  if (!toolCallId) return false
  const messageCreatedAt = parseIsoTimeMs(message.createdAt)
  const targetTurn = resolveToolRelatedTargetTurn(run, toolCallId, messageCreatedAt)
  if (!targetTurn) return false
  const text = resolvedContent.trim()
  if (!text) return false
  insertToolRelatedTimelineItem(targetTurn, toolCallId, {
    id: `question-answer:${message.externalMessageId ?? message.id}`,
    kind: 'question_answer',
    toolCallId,
    text,
    startedAt: messageCreatedAt
  })
  return true
}

const attachQuestionnaireStepRowToRun = (
  run: AgentRunProjection,
  message: ConversationMessage,
  meta: LocalThreadMessageMeta,
  resolvedContent: string
): boolean => {
  const toolCallId = asString(meta.toolCallId).trim()
  if (!toolCallId) return false
  const messageCreatedAt = parseIsoTimeMs(message.createdAt)
  const targetTurn = resolveToolRelatedTargetTurn(run, toolCallId, messageCreatedAt)
  if (!targetTurn) return false
  const text = resolvedContent.trim()
  if (!text) return false

  const stepIndex = meta.stepIndex ?? 0
  if (meta.messageKind === 'questionnaire_question') {
    insertToolRelatedTimelineItem(targetTurn, toolCallId, {
      id: `questionnaire-question:${message.externalMessageId ?? message.id}`,
      kind: 'questionnaire_question',
      toolCallId,
      stepIndex,
      text,
      startedAt: messageCreatedAt
    })
    return true
  }

  if (meta.messageKind === 'questionnaire_answer') {
    insertToolRelatedTimelineItem(targetTurn, toolCallId, {
      id: `questionnaire-answer:${message.externalMessageId ?? message.id}`,
      kind: 'questionnaire_answer',
      toolCallId,
      stepIndex,
      text,
      startedAt: messageCreatedAt
    })
    return true
  }

  return false
}

const turnHasVisibleOutput = (turn: AgentTurnProjection): boolean =>
  turn.toolCalls.length > 0 ||
  turn.timelineItems.some(
    (item) =>
      item.kind === 'tool' ||
      item.kind === 'question_answer' ||
      item.kind === 'questionnaire_question' ||
      item.kind === 'questionnaire_answer' ||
      (item.kind === 'thinking' && item.thinking.trim().length > 0) ||
      (item.kind === 'text' && item.text.trim().length > 0)
  )

const buildAssistantMessageKey = (runId?: string | null, turnId?: string | null): string | null => {
  const normalizedRunId = asString(runId).trim()
  if (!normalizedRunId) return null
  const normalizedTurnId = asString(turnId).trim()
  return normalizedTurnId ? `turn:${normalizedRunId}:${normalizedTurnId}` : `run:${normalizedRunId}`
}

const shouldRecoverAssistantTurnMessage = (
  run: AgentRunProjection,
  turn: AgentTurnProjection
): boolean =>
  // A running turn has no persisted assistant row until its first delta arrives.
  // Recover its shell so switching back to the thread immediately restores the live run UI.
  (run.status === 'running' && turn.status === 'running') ||
  turnHasVisibleOutput(turn) ||
  (turn.status === 'error' && Boolean(turn.errorMessage?.trim()))

const buildRecoveredAssistantTurnMessage = (
  run: AgentRunProjection,
  turn: AgentTurnProjection
): AgentThreadMessageProjection => ({
  createdAt: normalizeCoreTimestamp(turn.endedAt ?? turn.startedAt ?? run.endedAt ?? run.startedAt),
  agentRunId: run.agentRunId,
  agentTurnId: turn.agentTurnId,
  role: 'assistant',
  content: turn.text || (turn.status === 'error' ? turn.errorMessage?.trim() || '' : ''),
  isPending: run.status === 'running' && run.turns.at(-1)?.agentTurnId === turn.agentTurnId
})

const shouldRecoverRunLevelAssistantMessage = (run: AgentRunProjection): boolean =>
  run.turns.length === 0 &&
  (run.text.trim().length > 0 ||
    (run.status === 'error' && Boolean(run.termination?.message?.trim())))

const buildRecoveredRunLevelAssistantMessage = (
  run: AgentRunProjection
): AgentThreadMessageProjection => ({
  createdAt: normalizeCoreTimestamp(run.endedAt ?? run.startedAt),
  agentRunId: run.agentRunId,
  agentTurnId: null,
  role: 'assistant',
  content:
    run.text ||
    (run.status === 'error'
      ? formatRunErrorMessage(
          run.termination?.message,
          run.termination?.retryAttempt,
          run.termination?.maxRetryAttempts,
          run.termination?.willRetry
        )
      : ''),
  isPending: run.status === 'running'
})

const computeUpdatedAt = (
  messages: AgentThreadMessageProjection[],
  runs: AgentRunProjection[]
): number => {
  let latest = 0
  for (const message of messages) {
    latest = Math.max(latest, parseIsoTimeMs(message.createdAt))
  }
  for (const run of runs) {
    latest = Math.max(latest, run.endedAt ?? run.startedAt)
  }
  return latest || Date.now()
}

const mapEventLogToConversationEventRow = (
  threadId: string,
  event: EventLogEntry
): ConversationEventRow | null => {
  const payload = parseJson<unknown>(event.payloadJson, null)
  const record = asRecord(payload)
  const localThread = asRecord(record?.localThread)
  const runtime = asRecord(record?.runtime)
  const source = localThread ?? runtime
  if (!source) return null
  const payloadValue = record && 'payload' in record ? record.payload : null
  const rawValue = source.raw ?? null
  const eventThreadId = asString(localThread?.threadId).trim() || threadId
  const agentRunId =
    asString(localThread?.agentRunId).trim() ||
    asString(runtime?.coreAgentRunId).trim() ||
    (event.aggregateType === 'agent_run' ? event.aggregateId : '') ||
    null
  const runtimeAgentRunId = asString(runtime?.runtimeAgentRunId).trim() || null

  return {
    id: event.id,
    thread_id: eventThreadId,
    agent_run_id: agentRunId,
    runtime_agent_run_id: runtimeAgentRunId,
    event_type: event.eventType,
    event_origin: asString(source.eventOrigin).trim() || 'runtime',
    correlation_id: event.correlationId,
    payload_json: JSON.stringify(payloadValue ?? null),
    raw_json: rawValue == null ? null : JSON.stringify(rawValue),
    created_at: parseIsoTimeMs(event.createdAt)
  }
}

const isToolRelatedUserMessage = (meta: LocalThreadMessageMeta): boolean =>
  Boolean(
    meta.toolCallId &&
    (meta.messageKind === 'question_answer' ||
      meta.messageKind === 'questionnaire_question' ||
      meta.messageKind === 'questionnaire_answer')
  )

const hasVisibleContentBlocks = (blocks: ChatContentBlock[] | undefined): boolean =>
  Boolean(blocks?.some((block) => (block.type === 'text' ? block.text.trim().length > 0 : true)))

const isPersistedVisibleMessage = (message: ConversationMessage): boolean => {
  if (message.role !== 'user' && message.role !== 'assistant') return false

  const meta = parseLocalThreadMessageMeta(message)
  if (message.role === 'user') return !isToolRelatedUserMessage(meta)

  const blocks = meta.content?.blocks
  if (hasVisibleContentBlocks(blocks)) return true

  const parsed = deserializeAssistantContent(message.text || '')
  return Boolean(
    parsed.content.trim() || parsed.widget || (parsed.progress?.toolSteps?.length ?? 0) > 0
  )
}

const countPersistedVisibleMessages = (messages: ConversationMessage[]): number => {
  let count = 0
  for (const message of messages) {
    if (isPersistedVisibleMessage(message)) count += 1
  }
  return count
}

const loadConversationMessageWindow = (
  source: LocalThreadReadModelQuery,
  conversationId: string,
  limit: number,
  beforeCursor?: AgentThreadWindowCursor | null
): ConversationMessagePage => {
  const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit || 0), 200))
  const chunkSize = Math.min(200, Math.max(normalizedLimit * 2, normalizedLimit + 10))
  const collected: ConversationMessage[] = []
  let currentBefore: ConversationMessagePageCursor | null =
    beforeCursor?.createdAt && beforeCursor?.id
      ? {
          createdAt: beforeCursor.createdAt,
          id: beforeCursor.id
        }
      : null
  let hasMoreBefore = false
  let nextBeforeCursor: ConversationMessagePageCursor | null = null

  while (true) {
    const page = source.listConversationMessagesPage(conversationId, {
      limit: chunkSize,
      before: currentBefore
    })
    if (page.rows.length === 0) {
      hasMoreBefore = false
      nextBeforeCursor = null
      break
    }

    collected.splice(0, 0, ...page.rows)
    hasMoreBefore = page.hasMoreBefore
    nextBeforeCursor = page.nextBeforeCursor

    if (countPersistedVisibleMessages(collected) >= normalizedLimit || !page.hasMoreBefore) {
      break
    }

    currentBefore = page.nextBeforeCursor
    if (!currentBefore) break
  }

  return {
    rows: collected,
    hasMoreBefore,
    nextBeforeCursor
  }
}

const collectReferencedRunIdsFromMessages = (
  messages: ConversationMessage[],
  activeRunId?: string | null
): Set<string> => {
  const runIds = new Set<string>()
  for (const message of messages) {
    const meta = parseLocalThreadMessageMeta(message)
    const runId = asString(meta.agentRunId).trim()
    if (runId) runIds.add(runId)
  }
  const normalizedActiveRunId = asString(activeRunId).trim()
  if (normalizedActiveRunId) runIds.add(normalizedActiveRunId)
  return runIds
}

const buildAggregateKeysForWindow = (
  conversationId: string,
  runIds: Iterable<string>
): EventLogAggregateKey[] => {
  const keys: EventLogAggregateKey[] = [
    {
      aggregateType: 'conversation',
      aggregateId: conversationId
    }
  ]
  for (const runId of runIds) {
    const normalizedRunId = String(runId ?? '').trim()
    if (!normalizedRunId) continue
    keys.push({
      aggregateType: 'agent_run',
      aggregateId: normalizedRunId
    })
  }
  return keys
}

const buildThreadProjectionFromSeed = (
  threadId: string,
  messages: ConversationMessage[],
  runs: AgentRun[],
  projectionPayloads: AgentRunProjectionPayload[],
  liveRunSnapshot?: AgentRunProjection | null
): AgentThreadProjection => {
  const projectionPayloadByRunId = new Map(
    projectionPayloads.map((payload) => [payload.runId, payload])
  )
  const systemFollowupRunIds = new Set(
    runs.filter((run) => run.triggerKind === 'system_followup').map((run) => run.id)
  )

  const runMap = new Map<string, AgentRunProjection>()
  for (const run of runs) {
    runMap.set(
      run.id,
      buildRunProjectionFromCoreRun(threadId, run, projectionPayloadByRunId.get(run.id) ?? null)
    )
  }

  const assistantMessageKeys = new Set<string>()
  const visibleMessages: AgentThreadMessageProjection[] = []
  const deferredQuestionAnswerRows: Array<{
    message: ConversationMessage
    meta: LocalThreadMessageMeta
    resolvedContent: string
    blocks?: ChatContentBlock[]
  }> = []

  const persistedRows = messages.filter(
    (message): message is ConversationMessage & { role: 'user' | 'assistant' } =>
      (message.role === 'user' || message.role === 'assistant') &&
      !isSystemFollowupSyntheticUserMessage(message, systemFollowupRunIds)
  )
  const runsWithTurnLevelAssistantRows = new Set(
    persistedRows
      .filter((message) => {
        if (message.role !== 'assistant') return false
        const meta = parseLocalThreadMessageMeta(message)
        return Boolean(asString(meta.agentRunId).trim() && asString(meta.agentTurnId).trim())
      })
      .map((message) => asString(parseLocalThreadMessageMeta(message).agentRunId).trim())
  )

  for (const message of persistedRows) {
    const meta = parseLocalThreadMessageMeta(message)
    const blocks = meta.content?.blocks
    const plainText = getPlainTextFromBlocks(blocks)
    const resolvedContent = plainText || message.text || ''

    if (message.role === 'user') {
      if (isToolRelatedUserMessage(meta)) {
        deferredQuestionAnswerRows.push({ message, meta, resolvedContent, blocks })
        continue
      }

      visibleMessages.push(
        buildMessageProjection(message, meta, resolvedContent, undefined, false, undefined, blocks)
      )
      continue
    }

    const parsed = deserializeAssistantContent(message.text || '')
    if (
      !resolvedContent.trim() &&
      !hasVisibleContentBlocks(blocks) &&
      !parsed.content.trim() &&
      !parsed.widget &&
      !(parsed.progress?.toolSteps?.length ?? 0)
    ) {
      continue
    }

    let resolvedRunId = meta.agentRunId
    if (!resolvedRunId && parsed.progress) {
      const legacyRun = buildLegacyRunFromProgress(
        threadId,
        message.externalMessageId ?? message.id,
        parsed.content,
        parsed.progress,
        message.createdAt
      )
      runMap.set(legacyRun.agentRunId, legacyRun)
      resolvedRunId = legacyRun.agentRunId
    }

    if (
      !asString(meta.agentTurnId).trim() &&
      resolvedRunId &&
      runsWithTurnLevelAssistantRows.has(resolvedRunId)
    ) {
      continue
    }

    const assistantMessageKey = buildAssistantMessageKey(resolvedRunId, meta.agentTurnId)
    if (assistantMessageKey) assistantMessageKeys.add(assistantMessageKey)
    visibleMessages.push(
      buildMessageProjection(
        message,
        meta,
        plainText || parsed.content,
        resolvedRunId,
        false,
        parsed.widget,
        blocks
      )
    )
  }

  if (liveRunSnapshot) {
    runMap.set(liveRunSnapshot.agentRunId, liveRunSnapshot)
  }

  for (const { message, meta, resolvedContent, blocks } of deferredQuestionAnswerRows) {
    const linkedRunId = asString(meta.agentRunId).trim()
    const messageCreatedAt = parseIsoTimeMs(message.createdAt)
    const runs = Array.from(runMap.values())
    const linkedRun =
      (linkedRunId ? runMap.get(linkedRunId) : undefined) ??
      resolveToolRelatedRun(runs, asString(meta.toolCallId).trim(), messageCreatedAt)

    if (
      linkedRun &&
      ((meta.messageKind === 'question_answer' &&
        attachQuestionAnswerRowToRun(linkedRun, message, meta, resolvedContent)) ||
        ((meta.messageKind === 'questionnaire_question' ||
          meta.messageKind === 'questionnaire_answer') &&
          attachQuestionnaireStepRowToRun(linkedRun, message, meta, resolvedContent)))
    ) {
      continue
    }

    visibleMessages.push(
      buildMessageProjection(message, meta, resolvedContent, undefined, false, undefined, blocks)
    )
  }

  const projectedRuns = Array.from(runMap.values()).sort(
    (left, right) => left.startedAt - right.startedAt
  )
  for (const run of projectedRuns) {
    const hasLegacyRunMessage = assistantMessageKeys.has(`run:${run.agentRunId}`)
    if (hasLegacyRunMessage) continue
    for (const turn of run.turns) {
      const key = buildAssistantMessageKey(run.agentRunId, turn.agentTurnId)
      if (!key || assistantMessageKeys.has(key) || !shouldRecoverAssistantTurnMessage(run, turn)) {
        continue
      }
      visibleMessages.push(buildRecoveredAssistantTurnMessage(run, turn))
      assistantMessageKeys.add(key)
    }
    if (
      !assistantMessageKeys.has(`run:${run.agentRunId}`) &&
      shouldRecoverRunLevelAssistantMessage(run)
    ) {
      visibleMessages.push(buildRecoveredRunLevelAssistantMessage(run))
      assistantMessageKeys.add(`run:${run.agentRunId}`)
    }
  }

  visibleMessages.sort(compareProjectedMessages)
  const activeRun =
    liveRunSnapshot?.status === 'running'
      ? liveRunSnapshot
      : (projectedRuns.find((run) => run.status === 'running') ?? null)

  return {
    threadId,
    activeRunId: activeRun?.agentRunId ?? null,
    isStreaming: Boolean(activeRun),
    updatedAt: computeUpdatedAt(visibleMessages, projectedRuns),
    runs: projectedRuns,
    messages: visibleMessages
  }
}

const buildLocalThreadProjectionInternal = (
  source: LocalThreadReadModelQuery,
  threadId: string,
  liveRunSnapshot?: AgentRunProjection | null
): AgentThreadProjection => {
  const match = source.getConversationByBindingRoutingKey(buildLocalThreadRoutingKey(threadId))
  if (!match) {
    return {
      threadId,
      activeRunId: liveRunSnapshot?.status === 'running' ? liveRunSnapshot.agentRunId : null,
      isStreaming: Boolean(liveRunSnapshot && liveRunSnapshot.status === 'running'),
      updatedAt: Date.now(),
      runs: liveRunSnapshot ? [liveRunSnapshot] : [],
      messages: []
    }
  }

  const conversationId = match.conversation.id
  const messages = source.getConversationMessages(conversationId)
  const runs = source.listConversationRuns(conversationId)
  const projectionPayloads = source.listAgentRunProjectionPayloadsByIds(runs.map((run) => run.id))

  return buildThreadProjectionFromSeed(
    threadId,
    messages,
    runs,
    projectionPayloads,
    liveRunSnapshot
  )
}

const paginateMessages = (
  messages: AgentThreadMessageProjection[],
  limit: number,
  beforeCursor?: AgentThreadWindowCursor | null
): {
  rows: AgentThreadMessageProjection[]
  hasMoreBefore: boolean
  nextBeforeCursor: AgentThreadWindowCursor | null
} => {
  const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit || 0), 200))
  const filtered =
    beforeCursor?.createdAt && beforeCursor?.id
      ? messages.filter((message) => {
          const sameCursorTimestamp =
            parseIsoTimeMs(message.createdAt) === parseIsoTimeMs(beforeCursor.createdAt)
          if (sameCursorTimestamp && !message.id && typeof message.runtimeSequence !== 'number') {
            return false
          }
          return (
            compareProjectedMessages(message, {
              createdAt: beforeCursor.createdAt,
              runtimeSequence: beforeCursor.runtimeSequence ?? null,
              id: beforeCursor.id
            }) < 0
          )
        })
      : messages

  const hasMoreBefore = filtered.length > normalizedLimit
  const rows = hasMoreBefore ? filtered.slice(filtered.length - normalizedLimit) : filtered
  const oldest = rows.find((message) => Boolean(message.id)) ?? null
  return {
    rows,
    hasMoreBefore,
    nextBeforeCursor: oldest
      ? {
          createdAt: oldest.createdAt ?? normalizeCoreTimestamp(),
          runtimeSequence: oldest.runtimeSequence ?? null,
          id: oldest.id ?? ''
        }
      : null
  }
}

const collectWindowRunIds = (
  messages: AgentThreadMessageProjection[],
  activeRunId?: string | null
): Set<string> => {
  const runIds = new Set<string>()
  for (const message of messages) {
    const runId = asString(message.agentRunId).trim()
    if (runId) runIds.add(runId)
  }
  const normalizedActiveRunId = asString(activeRunId).trim()
  if (normalizedActiveRunId) runIds.add(normalizedActiveRunId)
  return runIds
}

const isSystemFollowupSyntheticUserMessage = (
  message: ConversationMessage,
  systemFollowupRunIds: ReadonlySet<string>
): boolean => {
  if (message.role !== 'user') return false
  if (!isSystemFollowupSyntheticPromptText(message.text)) return false
  const runId = asString(parseLocalThreadMessageMeta(message).agentRunId).trim()
  return Boolean(runId && systemFollowupRunIds.has(runId))
}

export const buildLocalThreadProjectionFromService = (
  source: LocalThreadReadModelQuery,
  threadId: string,
  liveRunSnapshot?: AgentRunProjection | null
): AgentThreadProjection => buildLocalThreadProjectionInternal(source, threadId, liveRunSnapshot)

export const buildLocalThreadWindowFromService = (
  source: LocalThreadReadModelQuery,
  threadId: string,
  liveRunSnapshot?: AgentRunProjection | null,
  options?: BuildLocalThreadWindowOptions
): AgentThreadWindowPage => {
  const match = source.getConversationByBindingRoutingKey(buildLocalThreadRoutingKey(threadId))
  if (!match) {
    return {
      threadId,
      activeRunId: liveRunSnapshot?.status === 'running' ? liveRunSnapshot.agentRunId : null,
      isStreaming: Boolean(liveRunSnapshot && liveRunSnapshot.status === 'running'),
      updatedAt: Date.now(),
      runs: liveRunSnapshot ? [liveRunSnapshot] : [],
      messages: [],
      pageInfo: {
        hasMoreBefore: false,
        nextBeforeCursor: null
      }
    }
  }

  const limit = options?.limit ?? DEFAULT_THREAD_WINDOW_LIMIT
  const beforeCursor = options?.beforeCursor ?? null
  const around = options?.around ?? null
  const includeLiveRunSnapshot =
    options?.includeLiveRunSnapshot ?? (beforeCursor == null || !beforeCursor.createdAt)
  const aroundMessageId = around?.messageId ?? null
  const aroundBefore = Math.max(0, Math.trunc(around?.before ?? 30))
  const aroundAfter = Math.max(0, Math.trunc(around?.after ?? 30))
  const allMessages = aroundMessageId ? source.getConversationMessages(match.conversation.id) : null
  const aroundIndex = allMessages?.findIndex(
    (message) => message.id === aroundMessageId || message.externalMessageId === aroundMessageId
  ) ?? -1
  const aroundRows = allMessages && aroundIndex >= 0
    ? allMessages.slice(
        Math.max(0, aroundIndex - aroundBefore),
        Math.min(allMessages.length, aroundIndex + aroundAfter + 1)
      )
    : null
  const windowPage = aroundRows
    ? {
        rows: aroundRows,
        hasMoreBefore: aroundIndex > aroundBefore,
        nextBeforeCursor: aroundRows[0]
          ? {
              createdAt: aroundRows[0].createdAt,
              id: aroundRows[0].externalMessageId ?? aroundRows[0].id
            }
          : null
      }
    : loadConversationMessageWindow(
        source,
        match.conversation.id,
        limit,
        beforeCursor
      )
  const runIds = collectReferencedRunIdsFromMessages(
    windowPage.rows,
    includeLiveRunSnapshot ? liveRunSnapshot?.agentRunId : null
  )
  const runs = source.listAgentRunsByIds([...runIds])
  const projectionPayloads = source.listAgentRunProjectionPayloadsByIds([...runIds])
  const projection = buildThreadProjectionFromSeed(
    threadId,
    windowPage.rows,
    runs,
    projectionPayloads,
    includeLiveRunSnapshot ? liveRunSnapshot : null
  )
  const finalPage = paginateMessages(projection.messages, limit, beforeCursor)
  const windowRunIds = collectWindowRunIds(finalPage.rows, projection.activeRunId)
  return {
    ...projection,
    runs: projection.runs.filter((run) => windowRunIds.has(run.agentRunId)),
    messages: finalPage.rows,
    pageInfo: {
      hasMoreBefore: windowPage.hasMoreBefore || finalPage.hasMoreBefore,
      nextBeforeCursor: finalPage.hasMoreBefore
        ? finalPage.nextBeforeCursor
        : windowPage.nextBeforeCursor
          ? {
              createdAt: windowPage.nextBeforeCursor.createdAt,
              runtimeSequence: null,
              id: windowPage.nextBeforeCursor.id
            }
          : null
    }
  }
}

export const listLocalRuntimeEventsFromService = (
  source: LocalThreadReadModelQuery,
  threadId: string,
  agentRunId?: string | null
): ConversationEventRow[] => {
  const match = source.getConversationByBindingRoutingKey(buildLocalThreadRoutingKey(threadId))
  if (!match) return []

  const conversationId = match.conversation.id
  const runIds = source.listConversationRuns(conversationId).map((run) => run.id)
  return source
    .listEventLogByAggregateKeys(buildAggregateKeysForWindow(conversationId, runIds))
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => mapEventLogToConversationEventRow(threadId, event))
    .filter((row): row is ConversationEventRow => row != null)
    .filter((row) => !agentRunId || row.agent_run_id === agentRunId)
}

const getLocalThreadReadModelSource = async (
  _threadId: string
): Promise<LocalThreadReadModelQuery> => {
  return getCoreV2Service()
}

export const buildLocalThreadProjectionFromCoreV2 = (
  threadId: string,
  liveRunSnapshot?: AgentRunProjection | null
): Promise<AgentThreadProjection> =>
  getLocalThreadReadModelSource(threadId).then((service) =>
    buildLocalThreadProjectionFromService(service, threadId, liveRunSnapshot)
  )

export const buildLocalThreadWindowFromCoreV2 = (
  threadId: string,
  liveRunSnapshot?: AgentRunProjection | null,
  options?: BuildLocalThreadWindowOptions
): Promise<AgentThreadWindowPage> =>
  getLocalThreadReadModelSource(threadId).then((service) =>
    buildLocalThreadWindowFromService(service, threadId, liveRunSnapshot, options)
  )

export const listLocalRuntimeEventsFromCoreV2 = (
  threadId: string,
  agentRunId?: string | null
): Promise<ConversationEventRow[]> =>
  getLocalThreadReadModelSource(threadId).then((service) =>
    listLocalRuntimeEventsFromService(service, threadId, agentRunId)
  )
