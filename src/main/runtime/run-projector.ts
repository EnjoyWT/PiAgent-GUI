import { generateId } from '@shared/id'
import path from 'node:path'
import type {
  AgentAppEvent,
  AgentAppEventBase,
  AgentQueueConsumedAppEvent,
  AgentMessageProjection,
  AgentToolCallInvocation,
  AgentToolCallKind,
  AgentRunProjection,
  AgentThreadLifecycleAppEvent,
  AgentToolCallProjection,
  ChatToolImageProjection,
  AgentTurnTimelineItem,
  AgentTurnProjection,
  ChatFileChange,
  EventOrigin,
  NormalizedAgentRuntimeEvent,
  TransportSetupQrProjection
} from '@shared/agent-runtime'
import { LOCAL_HTTP_BASE_URL } from '../../shared/local-http.ts'
import type {
  AgentQueueConsumedPayload,
  AgentMessageDeltaPayload,
  AgentMessageFinishedPayload,
  AgentMessageThinkingDeltaPayload,
  AgentMessageThinkingFinishedPayload,
  AgentMessageThinkingStartedPayload,
  AgentMessageStartedPayload,
  AgentRunEndedPayload,
  AgentToolCallFinishedPayload,
  AgentToolCallProgressPayload,
  AgentToolCallStartedPayload,
  AgentTurnFinishedPayload,
  AgentTurnStartedPayload
} from './runtime-types'

type JsonRecord = Record<string, unknown>

const asRecord = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const summarizeContentText = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        const record = asRecord(item)
        return record?.type === 'text' ? asString(record.text) : ''
      })
      .filter(Boolean)
      .join('\n')
    return text || fallback
  }
  const record = asRecord(value)
  if (!record) return fallback
  if (typeof record.text === 'string') return record.text
  if (Array.isArray(record.content)) return summarizeContentText(record.content, fallback)
  if (typeof record.message === 'string') return record.message
  const details = asRecord(record.details)
  if (details) {
    const stdout = asString(details.stdout)
    const stderr = asString(details.stderr)
    const combined = `${stdout}${stdout && stderr ? '\n' : ''}${stderr}`.trim()
    if (combined) return combined
  }
  return fallback
}

const summarizeToolResult = (value: unknown, fallback = ''): string => {
  const record = asRecord(value)
  if (!record) return fallback
  const explicitSummary = asString(record.summary).trim()
  if (explicitSummary) return explicitSummary
  return summarizeContentText(record.content, fallback)
}

const getToolResultDetails = (value: unknown): JsonRecord | null => {
  const details = asRecord(asRecord(value)?.details)
  return details && !Array.isArray(details) ? details : null
}

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const getToolPath = (args: unknown, result?: unknown): string => {
  const argRecord = asRecord(args)
  const argPath = asString(argRecord?.path ?? argRecord?.filePath).trim()
  if (argPath) return argPath
  const details = getToolResultDetails(result)
  return asString(details?.path ?? details?.filePath).trim()
}

const extractTransportSetupQr = (
  toolName: string,
  args: unknown,
  result: unknown
): TransportSetupQrProjection | undefined => {
  if (toolName.trim().toLowerCase() !== 'imtool') return undefined

  const argRecord = asRecord(args)
  const details = getToolResultDetails(result)
  const session = asRecord(details?.session)
  const events = Array.isArray(session?.events) ? session.events : []
  const qrEvent = events.map(asRecord).find((event) => event?.type === 'qr')
  if (!qrEvent) return undefined

  const imageUrl = asString(qrEvent.qrImageDataUrl || qrEvent.qrUrl).trim()
  if (!imageUrl) return undefined

  const transportId = asString(
    qrEvent.pluginId || session?.pluginId || argRecord?.transportId
  ).trim()
  const accountId = asString(
    qrEvent.accountId || session?.accountId || argRecord?.accountId || 'default'
  ).trim()
  const methodId = asString(
    qrEvent.methodId || session?.methodId || argRecord?.setupMethodId
  ).trim()
  const sessionId = asString(qrEvent.sessionId || session?.sessionId).trim()
  if (!transportId || !accountId || !methodId || !sessionId) return undefined

  return {
    transportId,
    accountId,
    methodId,
    sessionId,
    imageUrl,
    qrText: asString(qrEvent.qrText).trim() || undefined,
    startedAt: asString(qrEvent.startedAt || session?.startedAt).trim() || undefined,
    expiresAt: asString(qrEvent.expiresAt || session?.expiresAt).trim() || undefined,
    status: 'active'
  }
}

const COMPUTER_USE_ARTIFACT_NAME_PATTERN = /^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp|gif)$/i

const getComputerUseArtifactUrl = (filePath: string): string => {
  const fileName = path.basename(filePath)
  return `${LOCAL_HTTP_BASE_URL}/assets/computer-use/${encodeURIComponent(fileName)}`
}

const toComputerUseToolImage = (value: unknown, title: string): ChatToolImageProjection | null => {
  const record = asRecord(value)
  const filePath = asString(record?.path).trim()
  const mimeType = asString(record?.mimeType).trim() || 'image/png'
  if (!filePath || !mimeType.startsWith('image/')) return null

  const fileName = path.basename(filePath)
  if (!COMPUTER_USE_ARTIFACT_NAME_PATTERN.test(fileName)) return null

  return {
    title,
    mimeType,
    path: filePath,
    url: getComputerUseArtifactUrl(filePath),
    width: asFiniteNumber(record?.width),
    height: asFiniteNumber(record?.height)
  }
}

const extractComputerUseToolImages = (
  toolName: string,
  args: unknown,
  result: unknown
): ChatToolImageProjection[] => {
  if (toolName.trim().toLowerCase() !== 'computerusetool') return []
  const details = getToolResultDetails(result)
  if (!details) return []

  const argRecord = asRecord(args)
  const action = asString(details.action || argRecord?.action).trim()
  if (action !== 'screenshot' && action !== 'capture_window' && action !== 'snapshot_window') {
    return []
  }

  const observation = asRecord(details.observation)
  const candidates = [observation?.screenshot, details.screenshot]
  const images = candidates
    .map((candidate) => toComputerUseToolImage(candidate, 'Computer Use 截图'))
    .filter((image): image is ChatToolImageProjection => Boolean(image))

  return images.length > 0 ? [images[0]] : []
}

const classifyToolCallKind = (toolName: string): AgentToolCallKind =>
  toolName.trim().toLowerCase() === 'questiontool' ? 'question' : 'tool'

const resolveToolCallInvocation = (
  args: unknown,
  result?: unknown
): { invocation: AgentToolCallInvocation; skillName?: string } => {
  const argRecord = asRecord(args)
  const details = getToolResultDetails(result)
  const skillName = asString(
    argRecord?.skillName ?? argRecord?.skill_name ?? details?.skillName ?? details?.skill_name
  ).trim()
  return skillName ? { invocation: 'skill', skillName } : { invocation: 'direct' }
}

const countDiffLines = (diff: string): { added: number; removed: number } => {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue
    if (line.startsWith('+')) added += 1
    if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

const extractFileChanges = (toolName: string, args: unknown, result: unknown): ChatFileChange[] => {
  const normalizedName = toolName.trim().toLowerCase()
  if (normalizedName !== 'edit' && normalizedName !== 'write') return []
  const path = getToolPath(args, result)
  if (!path) return []
  const details = getToolResultDetails(result)
  const diff = typeof details?.diff === 'string' ? details.diff : undefined
  const diffStats = diff ? countDiffLines(diff) : { added: 0, removed: 0 }
  return [
    {
      path,
      diff,
      addedLines: diffStats.added || undefined,
      removedLines: diffStats.removed || undefined
    }
  ]
}

const extractMessageTextFromAgentMessage = (message: unknown): string => {
  const record = asRecord(message)
  if (!record) return ''
  if (typeof record.content === 'string') return record.content
  return summarizeContentText(record.content, '')
}

const extractAssistantErrorMessageFromAgentMessage = (message: unknown): string => {
  const record = asRecord(message)
  if (!record) return ''
  return asString(record.errorMessage).trim()
}

const extractAssistantStopReasonFromAgentMessage = (message: unknown): string => {
  const record = asRecord(message)
  if (!record) return ''
  return asString(record.stopReason).trim()
}

const getPayloadSubmissionId = (event: NormalizedAgentRuntimeEvent): string | null => {
  const payload = asRecord((event as { payload?: unknown }).payload)
  const submissionId = asString(payload?.submissionId).trim()
  return submissionId || null
}

const cloneFileChange = (change: ChatFileChange): ChatFileChange => ({ ...change })

const cloneTool = (tool: AgentToolCallProjection): AgentToolCallProjection => ({
  ...tool,
  accountSetupQr: tool.accountSetupQr ? { ...tool.accountSetupQr } : undefined,
  fileChanges: tool.fileChanges?.map(cloneFileChange),
  toolImages: tool.toolImages?.map((image) => ({ ...image }))
})

const cloneTimelineItem = (item: AgentTurnTimelineItem): AgentTurnTimelineItem => ({ ...item })

const isTextTimelineItem = (
  item: AgentTurnTimelineItem
): item is Extract<AgentTurnTimelineItem, { kind: 'text' }> => item.kind === 'text'

const isThinkingTimelineItem = (
  item: AgentTurnTimelineItem
): item is Extract<AgentTurnTimelineItem, { kind: 'thinking' }> => item.kind === 'thinking'

const cloneTurn = (turn: AgentTurnProjection): AgentTurnProjection => ({
  ...turn,
  terminationReason: turn.terminationReason,
  errorMessage: turn.errorMessage,
  timelineItems: turn.timelineItems.map(cloneTimelineItem),
  toolCallIds: [...turn.toolCallIds],
  toolCalls: turn.toolCalls.map(cloneTool)
})

const cloneMessage = (message: AgentMessageProjection): AgentMessageProjection => ({ ...message })

const cloneRun = (run: AgentRunProjection): AgentRunProjection => ({
  ...run,
  turns: run.turns.map(cloneTurn),
  messages: run.messages.map(cloneMessage),
  toolCalls: run.toolCalls.map(cloneTool),
  termination: run.termination ? { ...run.termination } : undefined
})

const normalizeToolResultStatus = (
  toolName: string,
  summary: string,
  isError: boolean
): 'done' | 'error' => {
  const isBash = toolName.trim().toLowerCase() === 'bash'
  const bashFailed = isBash && /(exited with code|timed out|command aborted|error)/i.test(summary)
  return isError || bashFailed ? 'error' : 'done'
}

export class RunProjector {
  private currentRun: AgentRunProjection | null = null
  private turnsById = new Map<string, AgentTurnProjection>()
  private messagesById = new Map<string, AgentMessageProjection>()
  private toolsById = new Map<string, AgentToolCallProjection>()
  private terminatedRunIds = new Set<string>()

  apply(event: NormalizedAgentRuntimeEvent): AgentAppEvent[] {
    switch (event.type) {
      case 'agentRunStarted':
        return this.onRunStarted(event as NormalizedAgentRuntimeEvent<unknown>)
      case 'agentQueueConsumed':
        return [
          this.buildQueueConsumedAppEvent(
            event as NormalizedAgentRuntimeEvent<AgentQueueConsumedPayload>
          )
        ]
      case 'agentTurnStarted':
        return this.onTurnStarted(event as NormalizedAgentRuntimeEvent<AgentTurnStartedPayload>)
      case 'agentMessageStarted':
        return this.onMessageStarted(
          event as NormalizedAgentRuntimeEvent<AgentMessageStartedPayload>
        )
      case 'agentMessageThinkingStarted':
        return this.onMessageThinkingStarted(
          event as NormalizedAgentRuntimeEvent<AgentMessageThinkingStartedPayload>
        )
      case 'agentMessageThinkingDelta':
        return this.onMessageThinkingDelta(
          event as NormalizedAgentRuntimeEvent<AgentMessageThinkingDeltaPayload>
        )
      case 'agentMessageThinkingFinished':
        return this.onMessageThinkingFinished(
          event as NormalizedAgentRuntimeEvent<AgentMessageThinkingFinishedPayload>
        )
      case 'agentMessageDelta':
        return this.onMessageDelta(event as NormalizedAgentRuntimeEvent<AgentMessageDeltaPayload>)
      case 'agentMessageFinished':
        return this.onMessageFinished(
          event as NormalizedAgentRuntimeEvent<AgentMessageFinishedPayload>
        )
      case 'agentToolCallStarted':
        return this.onToolStarted(event as NormalizedAgentRuntimeEvent<AgentToolCallStartedPayload>)
      case 'agentToolCallProgress':
        return this.onToolProgress(
          event as NormalizedAgentRuntimeEvent<AgentToolCallProgressPayload>
        )
      case 'agentToolCallFinished':
        return this.onToolFinished(
          event as NormalizedAgentRuntimeEvent<AgentToolCallFinishedPayload>
        )
      case 'agentTurnFinished':
        return this.onTurnFinished(event as NormalizedAgentRuntimeEvent<AgentTurnFinishedPayload>)
      case 'agentRunFinished':
      case 'agentRunFailed':
      case 'agentRunAborted':
        return this.onRunEnded(event as NormalizedAgentRuntimeEvent<AgentRunEndedPayload>)
      case 'agentThreadStarted':
      case 'agentThreadSwitched':
      case 'agentThreadForked':
      case 'agentThreadCompacted':
      case 'agentThreadShutdown':
        return [this.buildThreadAppEvent(event)]
      default:
        return []
    }
  }

  getSnapshot(): AgentRunProjection | null {
    return this.currentRun ? cloneRun(this.currentRun) : null
  }

  dispose(): void {
    this.resetState()
  }

  private makeTextTimelineItemId(agentMessageId: string | null): string {
    return `text:${agentMessageId || generateId()}`
  }

  private makeToolTimelineItemId(toolCallId: string): string {
    return `tool:${toolCallId}`
  }

  private makeThinkingTimelineItemId(agentMessageId: string | null): string {
    return agentMessageId
      ? `thinking:${agentMessageId}:${generateId()}`
      : `thinking:${generateId()}`
  }

  private findTurnTextItem(
    turn: AgentTurnProjection,
    agentMessageId: string | null
  ): Extract<AgentTurnTimelineItem, { kind: 'text' }> | null {
    if (agentMessageId) {
      return (
        turn.timelineItems.find(
          (item): item is Extract<AgentTurnTimelineItem, { kind: 'text' }> =>
            isTextTimelineItem(item) && item.agentMessageId === agentMessageId
        ) ?? null
      )
    }
    const lastItem = turn.timelineItems.at(-1)
    return lastItem && isTextTimelineItem(lastItem) && !lastItem.agentMessageId ? lastItem : null
  }

  private findTurnThinkingItem(
    turn: AgentTurnProjection,
    agentMessageId: string | null
  ): Extract<AgentTurnTimelineItem, { kind: 'thinking' }> | null {
    for (let index = turn.timelineItems.length - 1; index >= 0; index -= 1) {
      const item = turn.timelineItems[index]
      if (!isThinkingTimelineItem(item)) continue
      if (item.endedAt != null) continue
      if (agentMessageId) {
        if (item.agentMessageId === agentMessageId) return item
      } else if (!item.agentMessageId) {
        return item
      }
    }
    return null
  }

  private recomputeTurnText(turn: AgentTurnProjection): string {
    turn.text = turn.timelineItems
      .filter(isTextTimelineItem)
      .map((item) => item.text)
      .join('')
    return turn.text
  }

  private clearTurnText(turn: AgentTurnProjection): void {
    turn.timelineItems = turn.timelineItems.filter((item) => item.kind !== 'text')
    turn.text = ''
  }

  private clearTurnThinking(turn: AgentTurnProjection): void {
    turn.timelineItems = turn.timelineItems.filter((item) => item.kind !== 'thinking')
  }

  private turnHasText(turn: AgentTurnProjection): boolean {
    return turn.timelineItems.some((item) => isTextTimelineItem(item) && Boolean(item.text.trim()))
  }

  private appendTurnText(
    turn: AgentTurnProjection,
    agentMessageId: string | null,
    delta: string,
    timestamp: number
  ): string {
    if (!delta) return this.findTurnTextItem(turn, agentMessageId)?.text ?? ''

    let item = this.findTurnTextItem(turn, agentMessageId)
    if (!item) {
      item = {
        id: this.makeTextTimelineItemId(agentMessageId),
        kind: 'text',
        text: '',
        agentMessageId: agentMessageId ?? undefined,
        startedAt: timestamp
      }
      turn.timelineItems.push(item)
    }

    item.text += delta
    item.endedAt = timestamp
    this.recomputeTurnText(turn)
    return item.text
  }

  private ensureTurnThinkingItem(
    turn: AgentTurnProjection,
    agentMessageId: string | null,
    timestamp: number
  ): Extract<AgentTurnTimelineItem, { kind: 'thinking' }> {
    let item = this.findTurnThinkingItem(turn, agentMessageId)
    if (!item) {
      item = {
        id: this.makeThinkingTimelineItemId(agentMessageId),
        kind: 'thinking',
        thinking: '',
        agentMessageId: agentMessageId ?? undefined,
        startedAt: timestamp
      }
      turn.timelineItems.push(item)
    }
    return item
  }

  private appendTurnThinking(
    turn: AgentTurnProjection,
    agentMessageId: string | null,
    delta: string,
    timestamp: number
  ): string {
    const item = this.ensureTurnThinkingItem(turn, agentMessageId, timestamp)
    if (delta) item.thinking += delta
    item.endedAt = undefined
    return item.thinking
  }

  private ensureTurnThinking(
    turn: AgentTurnProjection,
    agentMessageId: string | null,
    content: string,
    timestamp: number
  ): string {
    const item = this.ensureTurnThinkingItem(turn, agentMessageId, timestamp)
    if (!item.thinking.trim() && content) item.thinking = content
    item.startedAt = item.startedAt || timestamp
    item.endedAt = timestamp
    return item.thinking
  }

  private finishTurnThinkingItem(
    turn: AgentTurnProjection,
    agentMessageId: string | null,
    timestamp: number
  ): void {
    const item = this.findTurnThinkingItem(turn, agentMessageId)
    if (item) item.endedAt = timestamp
  }

  private finishLastOpenThinkingItem(turn: AgentTurnProjection, timestamp: number): void {
    for (let index = turn.timelineItems.length - 1; index >= 0; index -= 1) {
      const item = turn.timelineItems[index]
      if (!isThinkingTimelineItem(item)) continue
      if (item.endedAt != null) continue
      item.endedAt = timestamp
      return
    }
  }

  private ensureTurnText(
    turn: AgentTurnProjection,
    agentMessageId: string | null,
    text: string,
    timestamp: number
  ): string {
    if (!text.trim()) return this.findTurnTextItem(turn, agentMessageId)?.text ?? ''

    let item = this.findTurnTextItem(turn, agentMessageId)
    if (!item) {
      item = {
        id: this.makeTextTimelineItemId(agentMessageId),
        kind: 'text',
        text,
        agentMessageId: agentMessageId ?? undefined,
        startedAt: timestamp,
        endedAt: timestamp
      }
      turn.timelineItems.push(item)
    } else if (!item.text.trim()) {
      item.text = text
      item.startedAt = item.startedAt || timestamp
      item.endedAt = timestamp
    }

    this.recomputeTurnText(turn)
    return item.text
  }

  private finishTurnTextItem(
    turn: AgentTurnProjection,
    agentMessageId: string | null,
    timestamp: number
  ): void {
    const item = this.findTurnTextItem(turn, agentMessageId)
    if (item) item.endedAt = timestamp
  }

  private ensureToolTimelineItem(turn: AgentTurnProjection, toolCallId: string): void {
    if (!toolCallId) return
    if (turn.timelineItems.some((item) => item.kind === 'tool' && item.toolCallId === toolCallId)) {
      return
    }
    turn.timelineItems.push({
      id: this.makeToolTimelineItemId(toolCallId),
      kind: 'tool',
      toolCallId
    })
  }

  private findLastAssistantMessage(run: AgentRunProjection): AgentMessageProjection | null {
    for (let idx = run.messages.length - 1; idx >= 0; idx -= 1) {
      const message = run.messages[idx]
      if (message.role === 'assistant') return message
    }
    return null
  }

  private onRunStarted(event: NormalizedAgentRuntimeEvent): AgentAppEvent[] {
    if (event.agentRunId) this.terminatedRunIds.delete(event.agentRunId)
    const run = this.ensureRun(event, event.origin)
    run.status = 'running'
    run.startedAt = event.timestamp
    run.endedAt = undefined
    run.text = ''
    run.termination = undefined
    return [this.buildRunAppEvent('agent.run.started', event, run)]
  }

  private onTurnStarted(
    event: NormalizedAgentRuntimeEvent<AgentTurnStartedPayload>
  ): AgentAppEvent[] {
    const run = this.ensureRun(event)
    const turn = this.ensureTurn(
      run,
      event.agentTurnId,
      event.payload.turnIndex,
      event.origin,
      event.timestamp
    )
    turn.status = 'running'
    turn.startedAt = event.timestamp
    turn.endedAt = undefined
    const turnEvent = this.buildTurnAppEvent('agent.turn.started', event, run, turn)
    const runEvent = this.buildRunAppEvent('agent.run.updated', event, run)
    return [turnEvent, runEvent]
  }

  private onMessageStarted(
    event: NormalizedAgentRuntimeEvent<AgentMessageStartedPayload>
  ): AgentAppEvent[] {
    const run = this.ensureRun(event)
    const turn = event.agentTurnId
      ? this.ensureTurn(run, event.agentTurnId, run.turns.length, 'inferred', event.timestamp)
      : null
    const message = this.ensureMessage(
      event.agentMessageId,
      event.payload.role,
      event.origin,
      event.timestamp,
      turn?.agentTurnId ?? event.agentTurnId
    )

    if (event.payload.retrying && run.messages.length > 0) {
      const previous = run.messages[run.messages.length - 1]
      previous.status = 'error'
      previous.endedAt = previous.endedAt ?? event.timestamp
      previous.text = ''
      if (turn) {
        this.clearTurnText(turn)
        this.clearTurnThinking(turn)
      }
      run.text = ''
    }

    message.status = 'running'
    message.startedAt = event.timestamp
    message.endedAt = undefined
    if (event.payload.submissionId) message.submissionId = event.payload.submissionId
    const messageText = extractMessageTextFromAgentMessage(event.payload.message)
    if (messageText && !message.text.trim()) message.text = messageText
    const appEvent = this.buildMessageAppEvent('agent.message.started', event, run, message)
    const runEvent = this.buildRunAppEvent('agent.run.updated', event, run)
    return [appEvent, runEvent]
  }

  private onMessageThinkingStarted(
    event: NormalizedAgentRuntimeEvent<AgentMessageThinkingStartedPayload>
  ): AgentAppEvent[] {
    const run = this.ensureRun(event)
    const turn = event.agentTurnId
      ? this.ensureTurn(run, event.agentTurnId, run.turns.length, 'inferred', event.timestamp)
      : null
    this.ensureMessage(
      event.agentMessageId,
      'assistant',
      event.origin,
      event.timestamp,
      turn?.agentTurnId ?? event.agentTurnId
    )
    if (turn) this.ensureTurnThinkingItem(turn, event.agentMessageId, event.timestamp)
    return [this.buildRunAppEvent('agent.run.updated', event, run)]
  }

  private onMessageThinkingDelta(
    event: NormalizedAgentRuntimeEvent<AgentMessageThinkingDeltaPayload>
  ): AgentAppEvent[] {
    const run = this.ensureRun(event)
    const turn = event.agentTurnId
      ? this.ensureTurn(run, event.agentTurnId, run.turns.length, 'inferred', event.timestamp)
      : null
    const message = this.ensureMessage(
      event.agentMessageId,
      'assistant',
      event.origin,
      event.timestamp,
      turn?.agentTurnId ?? event.agentTurnId
    )
    const delta = event.payload.delta || ''
    if (turn) this.appendTurnThinking(turn, message.agentMessageId, delta, event.timestamp)
    return [this.buildMessageDeltaAppEvent(event, run, message, delta, 'thinking')]
  }

  private onMessageThinkingFinished(
    event: NormalizedAgentRuntimeEvent<AgentMessageThinkingFinishedPayload>
  ): AgentAppEvent[] {
    const run = this.ensureRun(event)
    const turn = event.agentTurnId
      ? this.ensureTurn(run, event.agentTurnId, run.turns.length, 'inferred', event.timestamp)
      : null
    this.ensureMessage(
      event.agentMessageId,
      'assistant',
      event.origin,
      event.timestamp,
      turn?.agentTurnId ?? event.agentTurnId
    )
    if (turn) {
      this.ensureTurnThinking(
        turn,
        event.agentMessageId,
        event.payload.content || '',
        event.timestamp
      )
      this.finishTurnThinkingItem(turn, event.agentMessageId, event.timestamp)
    }
    return [this.buildRunAppEvent('agent.run.updated', event, run)]
  }

  private onMessageDelta(
    event: NormalizedAgentRuntimeEvent<AgentMessageDeltaPayload>
  ): AgentAppEvent[] {
    const run = this.ensureRun(event)
    const turn = event.agentTurnId
      ? this.ensureTurn(run, event.agentTurnId, run.turns.length, 'inferred', event.timestamp)
      : null
    const message = this.ensureMessage(
      event.agentMessageId,
      'assistant',
      event.origin,
      event.timestamp,
      turn?.agentTurnId ?? event.agentTurnId
    )
    const delta = event.payload.delta || ''
    if (delta) {
      if (turn) this.finishLastOpenThinkingItem(turn, event.timestamp)
      message.text += delta
      if (turn) run.text = this.appendTurnText(turn, message.agentMessageId, delta, event.timestamp)
      else run.text = message.text
    }
    return [this.buildMessageDeltaAppEvent(event, run, message, delta, 'text')]
  }

  private onMessageFinished(
    event: NormalizedAgentRuntimeEvent<AgentMessageFinishedPayload>
  ): AgentAppEvent[] {
    const run = this.ensureRun(event)
    const message = this.ensureMessage(
      event.agentMessageId,
      event.payload.role,
      event.origin,
      event.timestamp,
      event.agentTurnId
    )
    message.status = message.status === 'error' ? 'error' : 'done'
    message.endedAt = event.timestamp
    if (event.payload.submissionId) message.submissionId = event.payload.submissionId

    if (message.role === 'assistant') {
      const turn = message.agentTurnId
        ? this.ensureTurn(run, message.agentTurnId, run.turns.length, 'inferred', event.timestamp)
        : null
      const assistantText = extractMessageTextFromAgentMessage(event.payload.message)
      const assistantStopReason = extractAssistantStopReasonFromAgentMessage(event.payload.message)
      const assistantErrorMessage = extractAssistantErrorMessageFromAgentMessage(
        event.payload.message
      )
      if (assistantStopReason === 'error') message.status = 'error'
      if (assistantText && !message.text.trim()) {
        message.text = assistantText
        if (turn) this.ensureTurnText(turn, message.agentMessageId, assistantText, event.timestamp)
        run.text = assistantText
      }
      if (turn) {
        turn.terminationReason = assistantStopReason || turn.terminationReason
        if (assistantStopReason === 'error' && assistantErrorMessage) {
          turn.errorMessage = assistantErrorMessage
        }
      }
      if (turn) this.finishTurnThinkingItem(turn, message.agentMessageId, event.timestamp)
      if (turn) this.finishTurnTextItem(turn, message.agentMessageId, event.timestamp)
    }

    return [
      this.buildMessageAppEvent('agent.message.finished', event, run, message),
      this.buildRunAppEvent('agent.run.updated', event, run)
    ]
  }

  private onToolStarted(
    event: NormalizedAgentRuntimeEvent<AgentToolCallStartedPayload>
  ): AgentAppEvent[] {
    const run = this.ensureRun(event)
    const turn = event.agentTurnId
      ? this.ensureTurn(run, event.agentTurnId, run.turns.length, 'inferred', event.timestamp)
      : null
    const tool = this.ensureTool(
      run,
      event.toolCallId,
      event.payload.toolName,
      event.origin,
      event.timestamp,
      turn?.agentTurnId ?? event.agentTurnId
    )
    if (turn) this.finishLastOpenThinkingItem(turn, event.timestamp)
    tool.name = event.payload.toolName
    tool.kind = classifyToolCallKind(event.payload.toolName)
    {
      const startInvocation = resolveToolCallInvocation(event.payload.args)
      tool.invocation = startInvocation.invocation
      tool.skillName = startInvocation.skillName
    }
    tool.args = event.payload.args ?? tool.args
    tool.status = 'running'
    tool.startedAt = event.timestamp
    tool.endedAt = undefined
    tool.durationMs = undefined
    return [
      this.buildToolAppEvent('agent.tool.started', event, run, tool),
      this.buildRunAppEvent('agent.run.updated', event, run)
    ]
  }

  private onToolProgress(
    event: NormalizedAgentRuntimeEvent<AgentToolCallProgressPayload>
  ): AgentAppEvent[] {
    const run = this.ensureRun(event)
    const tool = this.ensureTool(
      run,
      event.toolCallId,
      event.payload.toolName,
      event.origin,
      event.timestamp,
      event.agentTurnId
    )
    tool.args = event.payload.args ?? tool.args
    const summary = summarizeToolResult(event.payload.partialResult, '')
    if (summary) tool.summary = summary
    return [this.buildToolAppEvent('agent.tool.progress', event, run, tool)]
  }

  private onToolFinished(
    event: NormalizedAgentRuntimeEvent<AgentToolCallFinishedPayload>
  ): AgentAppEvent[] {
    const run = this.ensureRun(event)
    const tool = this.ensureTool(
      run,
      event.toolCallId,
      event.payload.toolName,
      this.toolsById.has(event.toolCallId ?? '') ? event.origin : 'inferred',
      event.timestamp,
      event.agentTurnId
    )
    const summary = summarizeToolResult(
      event.payload.result,
      event.payload.isError ? '执行失败' : '执行完成'
    )
    tool.name = event.payload.toolName
    tool.args = event.payload.args ?? tool.args
    tool.kind = classifyToolCallKind(event.payload.toolName)
    {
      const finishInvocation = resolveToolCallInvocation(tool.args, event.payload.result)
      tool.invocation = finishInvocation.invocation
      tool.skillName = finishInvocation.skillName
    }
    tool.summary = summary || tool.summary
    tool.accountSetupQr = extractTransportSetupQr(tool.name, tool.args, event.payload.result)
    tool.toolImages = extractComputerUseToolImages(tool.name, tool.args, event.payload.result)
    tool.status = normalizeToolResultStatus(tool.name, tool.summary ?? '', event.payload.isError)
    tool.endedAt = event.timestamp
    tool.durationMs = Math.max(0, event.timestamp - tool.startedAt)
    tool.fileChanges = extractFileChanges(tool.name, tool.args, event.payload.result)
    return [
      this.buildToolAppEvent('agent.tool.finished', event, run, tool),
      this.buildRunAppEvent('agent.run.updated', event, run)
    ]
  }

  private onTurnFinished(
    event: NormalizedAgentRuntimeEvent<AgentTurnFinishedPayload>
  ): AgentAppEvent[] {
    const run = this.ensureRun(event)
    const turn = this.ensureTurn(
      run,
      event.agentTurnId,
      event.payload.turnIndex,
      event.origin,
      event.timestamp
    )
    this.reconcileToolResults(run, turn, event.payload.toolResults, event.timestamp)

    const assistantText = extractMessageTextFromAgentMessage(event.payload.message)
    const assistantStopReason = extractAssistantStopReasonFromAgentMessage(event.payload.message)
    const assistantErrorMessage = extractAssistantErrorMessageFromAgentMessage(
      event.payload.message
    )
    if (assistantText && !this.turnHasText(turn)) {
      const message = this.findLastAssistantMessage(run)
      if (message && message.agentTurnId === turn.agentTurnId && !message.text.trim()) {
        message.text = assistantText
      }
      this.ensureTurnText(
        turn,
        message?.agentTurnId === turn.agentTurnId ? message.agentMessageId : event.agentMessageId,
        assistantText,
        event.timestamp
      )
      run.text = assistantText
    }

    turn.terminationReason = assistantStopReason || turn.terminationReason
    if (assistantStopReason === 'error' && assistantErrorMessage) {
      turn.errorMessage = assistantErrorMessage
    }
    turn.status =
      assistantStopReason === 'error' || turn.toolCalls.some((tool) => tool.status === 'error')
        ? 'error'
        : 'done'
    turn.endedAt = event.timestamp
    return [
      this.buildTurnAppEvent('agent.turn.finished', event, run, turn),
      this.buildRunAppEvent('agent.run.updated', event, run)
    ]
  }

  private onRunEnded(event: NormalizedAgentRuntimeEvent<AgentRunEndedPayload>): AgentAppEvent[] {
    if (
      event.agentRunId &&
      this.terminatedRunIds.has(event.agentRunId) &&
      this.currentRun?.agentRunId !== event.agentRunId
    ) {
      return []
    }

    const run = this.ensureRun(event)

    const toolResults = event.payload.messages.filter((message) => {
      const record = asRecord(message)
      return record?.role === 'toolResult'
    })
    const activeTurn =
      run.turns.at(-1) ??
      this.ensureTurn(run, event.agentTurnId, run.turns.length, 'inferred', event.timestamp)
    this.reconcileToolResults(run, activeTurn, toolResults, event.timestamp)

    const assistantMessage = [...event.payload.messages].reverse().find((message) => {
      const record = asRecord(message)
      return record?.role === 'assistant'
    })
    const assistantText = extractMessageTextFromAgentMessage(assistantMessage)
    if (assistantText && !run.text.trim()) {
      run.text = assistantText
      const message = this.findLastAssistantMessage(run)
      if (message) {
        if (!message.text.trim()) message.text = assistantText
        if (message.agentTurnId) {
          const turn = this.turnsById.get(message.agentTurnId)
          if (turn && !this.turnHasText(turn)) {
            this.ensureTurnText(turn, message.agentMessageId, assistantText, event.timestamp)
          }
        }
      } else if (activeTurn && !this.turnHasText(activeTurn)) {
        this.ensureTurnText(activeTurn, event.agentMessageId, assistantText, event.timestamp)
      }
    }

    this.forceCloseOpenEntities(run, event.timestamp, event.payload.requestedStatus)

    run.endedAt = event.timestamp
    run.status =
      event.payload.requestedStatus === 'aborted'
        ? 'aborted'
        : event.payload.requestedStatus === 'failed'
          ? 'error'
          : 'done'

    run.termination = {
      kind: run.status === 'aborted' ? 'aborted' : run.status === 'error' ? 'error' : 'success',
      message:
        run.status === 'error'
          ? extractAssistantErrorMessageFromAgentMessage(assistantMessage) || undefined
          : undefined,
      willRetry: event.payload.willRetry,
      retryAttempt: event.payload.retryAttempt,
      maxRetryAttempts: event.payload.maxRetryAttempts,
      at: event.timestamp
    }

    const eventType =
      run.status === 'aborted'
        ? 'agent.run.aborted'
        : run.status === 'error'
          ? 'agent.run.failed'
          : 'agent.run.finished'

    const appEvent = this.buildRunAppEvent(eventType, event, run)
    if (run.agentRunId) this.terminatedRunIds.add(run.agentRunId)
    this.resetState()
    return [appEvent]
  }

  private ensureRun(
    event: Pick<NormalizedAgentRuntimeEvent, 'threadId' | 'agentRunId' | 'timestamp'>,
    origin: EventOrigin = 'inferred'
  ): AgentRunProjection {
    const agentRunId = event.agentRunId ?? generateId()
    if (this.currentRun && this.currentRun.agentRunId === agentRunId) return this.currentRun

    if (!this.currentRun || this.currentRun.agentRunId !== agentRunId) {
      this.currentRun = {
        threadId: event.threadId,
        agentRunId,
        status: 'running',
        startedAt: event.timestamp,
        turns: [],
        messages: [],
        toolCalls: [],
        text: '',
        termination: undefined
      }
      this.turnsById.clear()
      this.messagesById.clear()
      this.toolsById.clear()
    }

    if (origin !== 'inferred') this.currentRun.startedAt = event.timestamp
    return this.currentRun
  }

  private ensureTurn(
    run: AgentRunProjection,
    agentTurnId: string | null,
    index: number,
    origin: EventOrigin,
    timestamp: number
  ): AgentTurnProjection {
    const turnId = agentTurnId ?? generateId()
    const existing = this.turnsById.get(turnId)
    if (existing) return existing

    const created: AgentTurnProjection = {
      agentTurnId: turnId,
      index,
      status: 'running',
      startedAt: timestamp,
      endedAt: undefined,
      text: '',
      terminationReason: undefined,
      errorMessage: undefined,
      timelineItems: [],
      toolCallIds: [],
      toolCalls: []
    }
    this.turnsById.set(turnId, created)
    run.turns.push(created)
    if (origin === 'inferred' && run.turns.length === 1) created.index = 0
    return created
  }

  private ensureMessage(
    agentMessageId: string | null,
    role: string,
    origin: EventOrigin,
    timestamp: number,
    agentTurnId: string | null
  ): AgentMessageProjection {
    const messageId = agentMessageId ?? generateId()
    const existing = this.messagesById.get(messageId)
    if (existing) return existing

    const run = this.currentRun
    if (!run) {
      throw new Error('Attempted to create message projection without an active run')
    }

    const created: AgentMessageProjection = {
      agentMessageId: messageId,
      agentTurnId,
      role,
      status: 'running',
      text: '',
      submissionId: null,
      startedAt: timestamp,
      endedAt: undefined,
      origin
    }
    this.messagesById.set(messageId, created)
    run.messages.push(created)
    return created
  }

  private ensureTool(
    run: AgentRunProjection,
    toolCallId: string | null,
    toolName: string,
    origin: EventOrigin,
    timestamp: number,
    agentTurnId: string | null
  ): AgentToolCallProjection {
    const resolvedToolCallId = toolCallId ?? generateId()
    const existing = this.toolsById.get(resolvedToolCallId)
    if (existing) return existing

    const turn = agentTurnId
      ? this.ensureTurn(run, agentTurnId, run.turns.length, 'inferred', timestamp)
      : (run.turns.at(-1) ??
        this.ensureTurn(run, generateId(), run.turns.length, 'inferred', timestamp))

    const created: AgentToolCallProjection = {
      toolCallId: resolvedToolCallId,
      agentTurnId: turn.agentTurnId,
      name: toolName || 'tool',
      kind: classifyToolCallKind(toolName),
      invocation: 'direct',
      status: 'running',
      startedAt: timestamp,
      endedAt: undefined,
      durationMs: undefined,
      origin
    }
    this.toolsById.set(resolvedToolCallId, created)
    run.toolCalls.push(created)
    if (!turn.toolCallIds.includes(resolvedToolCallId)) turn.toolCallIds.push(resolvedToolCallId)
    if (!turn.toolCalls.some((tool) => tool.toolCallId === resolvedToolCallId))
      turn.toolCalls.push(created)
    this.ensureToolTimelineItem(turn, resolvedToolCallId)
    return created
  }

  private reconcileToolResults(
    run: AgentRunProjection,
    turn: AgentTurnProjection,
    toolResults: unknown[],
    timestamp: number
  ): void {
    if (!Array.isArray(toolResults) || toolResults.length === 0) return

    const knownFilePaths = new Set<string>()
    for (const tool of run.toolCalls) {
      for (const change of tool.fileChanges ?? []) {
        if (change.path) knownFilePaths.add(change.path)
      }
      const argPath = getToolPath(tool.args, { details: { path: tool.fileChanges?.[0]?.path } })
      if (argPath) knownFilePaths.add(argPath)
    }

    for (const item of toolResults) {
      const record = asRecord(item)
      if (!record) continue

      const toolName = asString(record.toolName) || 'tool'
      const summary = summarizeContentText(record.content, '').trim()
      const details = getToolResultDetails(record)
      const normalizedToolName = toolName.trim().toLowerCase()

      const args =
        record.args ??
        (normalizedToolName === 'bash' && asString(record.command || details?.command)
          ? { command: asString(record.command || details?.command) }
          : undefined)
      const candidatePath = getToolPath(args, record)
      if ((normalizedToolName === 'write' || normalizedToolName === 'edit') && candidatePath) {
        if (knownFilePaths.has(candidatePath) && !asString(record.toolCallId)) continue
      }

      const toolCallId =
        asString(record.toolCallId) ||
        this.findReconciledToolCallId(run, toolName, candidatePath, summary)
      const startedAt = typeof record.timestamp === 'number' ? record.timestamp : timestamp
      const tool = this.ensureTool(
        run,
        toolCallId,
        toolName,
        asString(record.toolCallId) ? 'reconciled' : 'reconciled',
        startedAt,
        turn.agentTurnId
      )
      tool.kind = classifyToolCallKind(toolName)
      {
        const invocation = resolveToolCallInvocation(args, record)
        tool.invocation = invocation.invocation
        tool.skillName = invocation.skillName
      }
      if (!tool.args && args !== undefined) tool.args = args
      if (summary) tool.summary = summary
      tool.accountSetupQr = extractTransportSetupQr(tool.name, tool.args, record)
      tool.toolImages = extractComputerUseToolImages(tool.name, tool.args, record)
      tool.status = normalizeToolResultStatus(
        tool.name,
        tool.summary ?? '',
        Boolean(record.isError)
      )
      tool.endedAt = tool.endedAt ?? timestamp
      tool.durationMs = tool.durationMs ?? Math.max(0, (tool.endedAt ?? timestamp) - tool.startedAt)
      const fileChanges = extractFileChanges(tool.name, tool.args, record)
      if (fileChanges.length > 0) {
        tool.fileChanges = fileChanges
        for (const change of fileChanges) knownFilePaths.add(change.path)
      }
    }
  }

  private findReconciledToolCallId(
    run: AgentRunProjection,
    toolName: string,
    candidatePath: string,
    summary: string
  ): string {
    const match = run.toolCalls.find((tool) => {
      if (tool.name !== toolName) return false
      if (candidatePath) {
        const existingPath = getToolPath(tool.args, {
          details: { path: tool.fileChanges?.[0]?.path }
        })
        return existingPath === candidatePath
      }
      return Boolean(summary) && tool.summary === summary
    })
    return match?.toolCallId ?? `reconciled:${toolName}:${candidatePath || summary || generateId()}`
  }

  private forceCloseOpenEntities(
    run: AgentRunProjection,
    timestamp: number,
    requestedStatus: AgentRunEndedPayload['requestedStatus']
  ): void {
    for (const tool of run.toolCalls) {
      if (tool.status !== 'running') continue
      tool.status = requestedStatus === 'finished' ? 'done' : 'error'
      tool.endedAt = timestamp
      tool.durationMs = Math.max(0, timestamp - tool.startedAt)
    }

    for (const turn of run.turns) {
      if (turn.status === 'done' || turn.status === 'error') continue
      turn.status = requestedStatus === 'finished' ? 'done' : 'error'
      turn.endedAt = timestamp
      for (const item of turn.timelineItems) {
        if (item.kind === 'thinking' && item.endedAt == null) item.endedAt = timestamp
      }
    }

    for (const message of run.messages) {
      if (message.status === 'done' || message.status === 'error') continue
      message.status = requestedStatus === 'finished' ? 'done' : 'error'
      message.endedAt = timestamp
    }
  }

  private buildRunAppEvent(
    type: AgentAppEvent['type'],
    event: NormalizedAgentRuntimeEvent,
    run: AgentRunProjection
  ): AgentAppEvent {
    return {
      ...this.buildBaseAppEvent(type, event),
      agentRunId: run.agentRunId,
      run: cloneRun(run)
    } as AgentAppEvent
  }

  private buildQueueConsumedAppEvent(
    event: NormalizedAgentRuntimeEvent<AgentQueueConsumedPayload>
  ): AgentQueueConsumedAppEvent {
    return {
      ...this.buildBaseAppEvent('agent.queue.consumed', event),
      type: 'agent.queue.consumed',
      queueItemId: event.payload.queueItemId,
      delivery: event.payload.delivery,
      text: extractMessageTextFromAgentMessage(event.payload.message),
      submissionId: event.payload.submissionId ?? null
    }
  }

  private buildTurnAppEvent(
    type: 'agent.turn.started' | 'agent.turn.finished',
    event: NormalizedAgentRuntimeEvent,
    run: AgentRunProjection,
    turn: AgentTurnProjection
  ): AgentAppEvent {
    return {
      ...this.buildBaseAppEvent(type, event),
      agentRunId: run.agentRunId,
      agentTurnId: turn.agentTurnId,
      turn: cloneTurn(turn)
    } as AgentAppEvent
  }

  private buildMessageAppEvent(
    type: 'agent.message.started' | 'agent.message.finished',
    event: NormalizedAgentRuntimeEvent,
    run: AgentRunProjection,
    message: AgentMessageProjection
  ): AgentAppEvent {
    return {
      ...this.buildBaseAppEvent(type, event),
      agentRunId: run.agentRunId,
      agentMessageId: message.agentMessageId,
      agentTurnId: message.agentTurnId,
      submissionId: getPayloadSubmissionId(event) ?? message.submissionId ?? null,
      message: cloneMessage(message)
    } as AgentAppEvent
  }

  private buildMessageDeltaAppEvent(
    event: NormalizedAgentRuntimeEvent,
    run: AgentRunProjection,
    message: AgentMessageProjection,
    delta: string,
    contentKind: 'text' | 'thinking'
  ): AgentAppEvent {
    return {
      ...this.buildBaseAppEvent('agent.message.delta', event),
      agentRunId: run.agentRunId,
      agentMessageId: message.agentMessageId,
      agentTurnId: message.agentTurnId,
      contentKind,
      delta
    } as AgentAppEvent
  }

  private buildToolAppEvent(
    type: 'agent.tool.started' | 'agent.tool.progress' | 'agent.tool.finished',
    event: NormalizedAgentRuntimeEvent,
    run: AgentRunProjection,
    tool: AgentToolCallProjection
  ): AgentAppEvent {
    return {
      ...this.buildBaseAppEvent(type, event),
      agentRunId: run.agentRunId,
      toolCallId: tool.toolCallId,
      tool: cloneTool(tool)
    } as AgentAppEvent
  }

  private buildThreadAppEvent(event: NormalizedAgentRuntimeEvent): AgentThreadLifecycleAppEvent {
    const type: AgentThreadLifecycleAppEvent['type'] =
      event.type === 'agentThreadStarted'
        ? 'agent.thread.started'
        : event.type === 'agentThreadSwitched'
          ? 'agent.thread.switched'
          : event.type === 'agentThreadForked'
            ? 'agent.thread.forked'
            : event.type === 'agentThreadCompacted'
              ? 'agent.thread.compacted'
              : 'agent.thread.shutdown'

    return this.buildBaseAppEvent(type, event) as AgentThreadLifecycleAppEvent
  }

  private buildBaseAppEvent(
    type: AgentAppEventBase['type'],
    event: NormalizedAgentRuntimeEvent
  ): AgentAppEventBase {
    return {
      id: event.id,
      type,
      timestamp: event.timestamp,
      threadId: event.threadId,
      agentRunId: event.agentRunId,
      agentTurnId: event.agentTurnId,
      traceId: event.traceId,
      correlationId: event.correlationId,
      causationId: event.causationId,
      parentEventId: event.parentEventId,
      sequence: event.sequence
    }
  }

  private resetState(): void {
    this.currentRun = null
    this.turnsById.clear()
    this.messagesById.clear()
    this.toolsById.clear()
  }
}
