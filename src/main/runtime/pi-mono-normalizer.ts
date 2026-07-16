import { generateId } from '@shared/id'
import type { EventOrigin, NormalizedAgentRuntimeEvent } from '@shared/agent-runtime'
import type {
  AgentQueueConsumedPayload,
  AgentMessageDeltaPayload,
  AgentMessageFinishedPayload,
  AgentMessageThinkingDeltaPayload,
  AgentMessageThinkingFinishedPayload,
  AgentMessageThinkingStartedPayload,
  AgentMessageStartedPayload,
  AgentRunEndedPayload,
  AgentRunStartedPayload,
  AgentRuntimeUnknownPayload,
  AgentThreadEventPayload,
  AgentToolCallFinishedPayload,
  AgentToolCallProgressPayload,
  AgentToolCallStartedPayload,
  AgentTurnFinishedPayload,
  AgentTurnStartedPayload
} from './runtime-types'

type JsonRecord = Record<string, unknown>

type ToolContext = {
  agentTurnId: string | null
  args?: unknown
  startEventId: string | null
}

const asRecord = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const getRole = (message: unknown): string => {
  const record = asRecord(message)
  return asString(record?.role) || 'assistant'
}

const getAssistantEventType = (value: unknown): string => {
  const record = asRecord(value)
  return asString(record?.type)
}

const getAssistantContentIndex = (value: unknown): number | null => {
  const record = asRecord(value)
  return asNumber(record?.contentIndex)
}

const makeAssistantContentKey = (agentMessageId: string, contentIndex: number | null): string =>
  `${agentMessageId}:${contentIndex ?? 'unknown'}`

const getThinkingContent = (message: unknown, contentIndex: number | null): string => {
  const record = asRecord(message)
  const content = Array.isArray(record?.content) ? record.content : []

  if (contentIndex != null) {
    const block = asRecord(content[contentIndex])
    if (block?.type === 'thinking') return asString(block.thinking)
  }

  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = asRecord(content[index])
    if (block?.type === 'thinking') return asString(block.thinking)
  }

  return ''
}

const getStopReason = (message: unknown): string => {
  const record = asRecord(message)
  return asString(record?.stopReason)
}

const getErrorMessage = (message: unknown): string => {
  const record = asRecord(message)
  return asString(record?.errorMessage)
}

const isRetryableAgentError = (message: unknown): boolean => {
  const stopReason = getStopReason(message)
  const errorMessage = getErrorMessage(message)
  if (stopReason !== 'error' || !errorMessage) return false

  // Keep context overflow failures terminal. pi-coding-agent retries the rest.
  if (
    /context|token limit|max.?tokens|context window|too long|prompt too large/i.test(errorMessage)
  ) {
    return false
  }

  return /overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error|connection.?error|connection.?refused|other side closed|fetch failed|upstream.?connect|reset before headers|terminated|retry delay/i.test(
    errorMessage
  )
}

export class PiMonoNormalizer {
  private activeRunId: string | null = null
  private runStartEventId: string | null = null
  private activeTurnId: string | null = null
  private activeTurnIndex = -1
  private activeTurnStartEventId: string | null = null
  private activeMessageId: string | null = null
  private activeMessageStartEventId: string | null = null
  private traceId: string | null = null
  private correlationId: string | null = null
  private sequence = 0
  private lastEventId: string | null = null
  private abortRequested = false
  private retryPending = false
  private retryContinuationPending = false
  private retryAttempt = 0
  private maxRetryAttempts = 0
  private sawTerminalMessageError = false
  private sawAbortedMessage = false
  private pendingAgentEnd: NormalizedAgentRuntimeEvent<AgentRunEndedPayload> | null = null
  private retryTerminalEvent: NormalizedAgentRuntimeEvent<AgentRunEndedPayload> | null = null
  private toolContexts = new Map<string, ToolContext>()
  private openThinkingContentKey: string | null = null
  private openThinkingContentIndex: number | null = null
  private closedThinkingContentKeys = new Set<string>()

  constructor(private readonly threadId: string) {}

  markAbortRequested(): NormalizedAgentRuntimeEvent<AgentRunEndedPayload>[] {
    this.abortRequested = true
    if (!this.pendingAgentEnd && !this.retryTerminalEvent && !this.retryPending) {
      const aborted = this.finalizeAbortedRun({ type: 'abort_request' })
      return aborted ? [aborted] : []
    }
    const aborted = this.finalizeAbortedRun({ type: 'abort_request' })
    return aborted ? [aborted] : []
  }

  normalize(rawEvent: unknown): NormalizedAgentRuntimeEvent | null {
    const [first] = this.normalizeMany(rawEvent)
    return first ?? null
  }

  normalizeMany(rawEvent: unknown): NormalizedAgentRuntimeEvent[] {
    const emitted: NormalizedAgentRuntimeEvent[] = []
    const raw = asRecord(rawEvent)
    const rawType = asString(raw?.type) || 'unknown'

    if (this.pendingAgentEnd) {
      if (rawType === 'auto_retry_start') {
        if (this.abortRequested) {
          const aborted = this.finalizeAbortedRun(rawEvent)
          if (aborted) emitted.push(aborted)
          return emitted
        }
        this.retryTerminalEvent = this.pendingAgentEnd
        this.pendingAgentEnd = null
        this.retryPending = true
        this.retryContinuationPending = true
        this.retryAttempt = asNumber(raw?.attempt) ?? this.retryAttempt
        this.maxRetryAttempts = asNumber(raw?.maxAttempts) ?? this.maxRetryAttempts
        this.sawTerminalMessageError = false
        return emitted
      }

      if (rawType === 'auto_retry_end') {
        this.retryPending = false
        this.retryContinuationPending = false
        if (raw?.success === false) {
          if (this.abortRequested) {
            const aborted = this.finalizeAbortedRun(rawEvent)
            if (aborted) emitted.push(aborted)
            return emitted
          }
          if (this.pendingAgentEnd) {
            this.pendingAgentEnd.payload.retryAttempt = asNumber(raw?.attempt) ?? this.retryAttempt
            this.pendingAgentEnd.payload.maxRetryAttempts =
              this.maxRetryAttempts || this.pendingAgentEnd.payload.retryAttempt
          }
          emitted.push(this.finalizePendingAgentEnd())
        } else {
          this.pendingAgentEnd = null
        }
        return emitted
      }

      emitted.push(this.finalizePendingAgentEnd())
    }

    switch (rawType) {
      case 'agent_start':
        if (this.retryContinuationPending && this.activeRunId) {
          this.retryContinuationPending = false
          return emitted
        }
        emitted.push(...this.normalizeAgentStart(rawEvent))
        return emitted
      case 'agent_end':
        emitted.push(...this.normalizeAgentEnd(rawEvent, raw))
        return emitted
      case 'queue_consumed':
        emitted.push(this.normalizeQueueConsumed(rawEvent, raw))
        return emitted
      case 'turn_start':
        emitted.push(this.normalizeTurnStart(rawEvent, raw))
        return emitted
      case 'turn_end':
        emitted.push(this.normalizeTurnEnd(rawEvent, raw))
        return emitted
      case 'message_start':
        emitted.push(this.normalizeMessageStart(rawEvent, raw))
        return emitted
      case 'message_update':
        return emitted.concat(this.normalizeMessageUpdate(rawEvent, raw) ?? [])
      case 'message_end':
        emitted.push(this.normalizeMessageEnd(rawEvent, raw))
        return emitted
      case 'tool_execution_start':
        emitted.push(this.normalizeToolStart(rawEvent, raw))
        return emitted
      case 'tool_execution_update':
        emitted.push(this.normalizeToolProgress(rawEvent, raw))
        return emitted
      case 'tool_execution_end':
        emitted.push(this.normalizeToolFinished(rawEvent, raw))
        return emitted
      case 'session_start':
      case 'session_switch':
      case 'session_fork':
      case 'session_compact':
      case 'session_shutdown':
        emitted.push(this.normalizeThreadEvent(rawEvent, rawType))
        return emitted
      case 'auto_retry_start':
        if (this.abortRequested) {
          const aborted = this.finalizeAbortedRun(rawEvent)
          if (aborted) emitted.push(aborted)
          return emitted
        }
        this.retryPending = true
        this.retryContinuationPending = true
        this.retryAttempt = asNumber(raw?.attempt) ?? this.retryAttempt
        this.maxRetryAttempts = asNumber(raw?.maxAttempts) ?? this.maxRetryAttempts
        this.sawTerminalMessageError = false
        return emitted
      case 'auto_retry_end':
        this.retryPending = false
        this.retryContinuationPending = false
        if (raw?.success === false) {
          if (this.abortRequested) {
            const aborted = this.finalizeAbortedRun(rawEvent)
            if (aborted) emitted.push(aborted)
            return emitted
          }
          if (this.retryTerminalEvent) {
            this.pendingAgentEnd = this.retryTerminalEvent
            this.retryTerminalEvent = null
            this.pendingAgentEnd.payload.retryAttempt = asNumber(raw?.attempt) ?? this.retryAttempt
            this.pendingAgentEnd.payload.maxRetryAttempts =
              this.maxRetryAttempts || this.pendingAgentEnd.payload.retryAttempt
            emitted.push(this.finalizePendingAgentEnd())
            return emitted
          }
          this.sawTerminalMessageError = true
        } else {
          this.retryTerminalEvent = null
        }
        return emitted
      default:
        emitted.push(
          this.createEvent<AgentRuntimeUnknownPayload>(
            'agentRuntimeUnknownEvent',
            {
              rawType,
              data: rawEvent
            },
            rawEvent,
            {
              agentRunId: this.activeRunId,
              agentTurnId: this.activeTurnId,
              agentMessageId: this.activeMessageId
            }
          )
        )
        return emitted
    }
  }

  private normalizeAgentStart(
    rawEvent: unknown
  ): NormalizedAgentRuntimeEvent<AgentRunStartedPayload | AgentRunEndedPayload>[] {
    const shouldAbortImmediately = this.abortRequested

    this.activeRunId = generateId()
    this.traceId = generateId()
    this.correlationId = this.activeRunId
    this.runStartEventId = null
    this.activeTurnId = null
    this.activeTurnIndex = -1
    this.activeTurnStartEventId = null
    this.activeMessageId = null
    this.activeMessageStartEventId = null
    this.abortRequested = false
    this.retryPending = false
    this.retryContinuationPending = false
    this.retryAttempt = 0
    this.maxRetryAttempts = 0
    this.sawTerminalMessageError = false
    this.sawAbortedMessage = false
    this.pendingAgentEnd = null
    this.retryTerminalEvent = null
    this.toolContexts.clear()

    const event = this.createEvent<AgentRunStartedPayload>(
      'agentRunStarted',
      { rawType: 'agent_start' },
      rawEvent,
      { agentRunId: this.activeRunId },
      'runtime',
      null
    )
    this.runStartEventId = event.id

    if (!shouldAbortImmediately) return [event]

    this.abortRequested = true
    const aborted = this.finalizeAbortedRun({ type: 'abort_request' })
    return aborted ? [event, aborted] : [event]
  }

  private normalizeAgentEnd(
    rawEvent: unknown,
    raw: JsonRecord | null
  ): NormalizedAgentRuntimeEvent<AgentRunEndedPayload>[] {
    const agentRunId = this.ensureRunContext()
    const assistantMessage = [...(Array.isArray(raw?.messages) ? raw.messages : [])]
      .reverse()
      .find((message) => getRole(message) === 'assistant')

    if (assistantMessage) this.captureTerminalMessageState(assistantMessage)

    const requestedStatus =
      this.abortRequested || this.sawAbortedMessage
        ? 'aborted'
        : this.sawTerminalMessageError
          ? 'failed'
          : 'finished'

    const eventType =
      requestedStatus === 'aborted'
        ? 'agentRunAborted'
        : requestedStatus === 'failed'
          ? 'agentRunFailed'
          : 'agentRunFinished'

    const willRetry = requestedStatus === 'failed' && isRetryableAgentError(assistantMessage)

    const event = this.createEvent<AgentRunEndedPayload>(
      eventType,
      {
        rawType: 'agent_end',
        messages: Array.isArray(raw?.messages) ? raw.messages : [],
        requestedStatus,
        willRetry: willRetry || undefined,
        retryAttempt: this.retryAttempt || undefined,
        maxRetryAttempts: this.maxRetryAttempts || undefined
      },
      rawEvent,
      {
        agentRunId,
        agentTurnId: this.activeTurnId,
        agentMessageId: this.activeMessageId
      },
      'runtime',
      this.runStartEventId
    )

    if (willRetry) {
      this.pendingAgentEnd = event
      return []
    }

    this.resetRunState()
    return [event]
  }

  private finalizePendingAgentEnd(): NormalizedAgentRuntimeEvent<AgentRunEndedPayload> {
    const event = this.pendingAgentEnd
    if (!event) throw new Error('Invariant violation: missing pending agent end')
    this.pendingAgentEnd = null
    this.retryTerminalEvent = null
    this.resetRunState()
    return event
  }

  private finalizeAbortedRun(
    rawEvent: unknown
  ): NormalizedAgentRuntimeEvent<AgentRunEndedPayload> | null {
    const source = this.pendingAgentEnd ?? this.retryTerminalEvent
    const agentRunId = this.activeRunId ?? source?.agentRunId ?? null
    if (!agentRunId) return null

    const event = this.createEvent<AgentRunEndedPayload>(
      'agentRunAborted',
      {
        rawType: 'agent_end',
        messages: source?.payload.messages ?? [],
        requestedStatus: 'aborted',
        retryAttempt: this.retryAttempt || source?.payload.retryAttempt,
        maxRetryAttempts: this.maxRetryAttempts || source?.payload.maxRetryAttempts
      },
      rawEvent,
      {
        agentRunId,
        agentTurnId: this.activeTurnId ?? source?.agentTurnId ?? null,
        agentMessageId: this.activeMessageId ?? source?.agentMessageId ?? null
      },
      'runtime',
      this.runStartEventId
    )

    this.pendingAgentEnd = null
    this.retryTerminalEvent = null
    this.resetRunState()
    return event
  }

  private resetRunState(): void {
    this.activeRunId = null
    this.runStartEventId = null
    this.activeTurnId = null
    this.activeTurnIndex = -1
    this.activeTurnStartEventId = null
    this.activeMessageId = null
    this.activeMessageStartEventId = null
    this.traceId = null
    this.correlationId = null
    this.abortRequested = false
    this.retryPending = false
    this.retryContinuationPending = false
    this.retryAttempt = 0
    this.maxRetryAttempts = 0
    this.sawTerminalMessageError = false
    this.sawAbortedMessage = false
    this.retryTerminalEvent = null
    this.toolContexts.clear()
  }

  private normalizeTurnStart(
    rawEvent: unknown,
    raw: JsonRecord | null
  ): NormalizedAgentRuntimeEvent<AgentTurnStartedPayload> {
    const agentRunId = this.ensureRunContext()
    this.activeTurnId = generateId()
    this.activeTurnIndex += 1
    this.activeTurnStartEventId = null
    this.activeMessageId = null
    this.activeMessageStartEventId = null

    const turnIndex = asNumber(raw?.turnIndex) ?? this.activeTurnIndex
    this.activeTurnIndex = turnIndex

    const event = this.createEvent<AgentTurnStartedPayload>(
      'agentTurnStarted',
      {
        rawType: 'turn_start',
        turnIndex
      },
      rawEvent,
      {
        agentRunId,
        agentTurnId: this.activeTurnId
      },
      'runtime',
      this.runStartEventId
    )
    this.activeTurnStartEventId = event.id
    return event
  }

  private normalizeQueueConsumed(
    rawEvent: unknown,
    raw: JsonRecord | null
  ): NormalizedAgentRuntimeEvent<AgentQueueConsumedPayload> {
    return this.createEvent<AgentQueueConsumedPayload>(
      'agentQueueConsumed',
      {
        rawType: 'queue_consumed',
        delivery: asString(raw?.delivery) === 'steer' ? 'steer' : 'followUp',
        message: raw?.message
      },
      rawEvent,
      {
        agentRunId: this.activeRunId,
        agentTurnId: this.activeTurnId,
        agentMessageId: this.activeMessageId
      },
      'runtime',
      this.lastEventId
    )
  }

  private normalizeTurnEnd(
    rawEvent: unknown,
    raw: JsonRecord | null
  ): NormalizedAgentRuntimeEvent<AgentTurnFinishedPayload> {
    const agentRunId = this.ensureRunContext()
    const agentTurnId = this.ensureTurnContext()
    const turnIndex = asNumber(raw?.turnIndex) ?? Math.max(this.activeTurnIndex, 0)

    const event = this.createEvent<AgentTurnFinishedPayload>(
      'agentTurnFinished',
      {
        rawType: 'turn_end',
        turnIndex,
        message: raw?.message,
        toolResults: Array.isArray(raw?.toolResults) ? raw.toolResults : []
      },
      rawEvent,
      {
        agentRunId,
        agentTurnId,
        agentMessageId: this.activeMessageId
      },
      'runtime',
      this.activeTurnStartEventId ?? this.runStartEventId
    )

    this.activeTurnId = null
    this.activeTurnStartEventId = null
    this.activeMessageId = null
    this.activeMessageStartEventId = null

    return event
  }

  private normalizeMessageStart(
    rawEvent: unknown,
    raw: JsonRecord | null
  ): NormalizedAgentRuntimeEvent<AgentMessageStartedPayload> {
    const agentRunId = this.ensureRunContext()
    const agentTurnId = this.ensureTurnContext()
    const message = raw?.message
    const role = getRole(message)
    this.activeMessageId = generateId()
    this.activeMessageStartEventId = null
    this.openThinkingContentKey = null
    this.openThinkingContentIndex = null
    this.closedThinkingContentKeys.clear()

    const event = this.createEvent<AgentMessageStartedPayload>(
      'agentMessageStarted',
      {
        rawType: 'message_start',
        role,
        message,
        retrying: this.retryPending
      },
      rawEvent,
      {
        agentRunId,
        agentTurnId,
        agentMessageId: this.activeMessageId
      },
      'runtime',
      this.activeTurnStartEventId ?? this.runStartEventId
    )
    this.activeMessageStartEventId = event.id
    this.retryPending = false
    return event
  }

  private normalizeMessageUpdate(
    rawEvent: unknown,
    raw: JsonRecord | null
  ):
    | NormalizedAgentRuntimeEvent<AgentMessageThinkingStartedPayload>
    | NormalizedAgentRuntimeEvent<AgentMessageThinkingDeltaPayload>
    | NormalizedAgentRuntimeEvent<AgentMessageThinkingFinishedPayload>
    | NormalizedAgentRuntimeEvent<AgentMessageDeltaPayload>
    | NormalizedAgentRuntimeEvent<
        | AgentMessageThinkingStartedPayload
        | AgentMessageThinkingDeltaPayload
        | AgentMessageThinkingFinishedPayload
        | AgentMessageDeltaPayload
      >[]
    | null {
    const assistantMessageEvent = raw?.assistantMessageEvent
    const assistantEventType = getAssistantEventType(assistantMessageEvent)
    const contentIndex = getAssistantContentIndex(assistantMessageEvent)

    if (assistantEventType === 'error') {
      const reason = asString(asRecord(assistantMessageEvent)?.reason)
      if (reason === 'aborted') this.sawAbortedMessage = true
      else this.sawTerminalMessageError = true
      return null
    }

    const agentRunId = this.ensureRunContext()
    const agentTurnId = this.ensureTurnContext()
    const agentMessageId = this.ensureMessageContext()

    const parentEventId =
      this.activeMessageStartEventId ?? this.activeTurnStartEventId ?? this.runStartEventId
    const thinkingContentKey = makeAssistantContentKey(agentMessageId, contentIndex)

    if (assistantEventType === 'thinking_start') {
      this.openThinkingContentKey = thinkingContentKey
      this.openThinkingContentIndex = contentIndex
      this.closedThinkingContentKeys.delete(thinkingContentKey)
      return this.createEvent<AgentMessageThinkingStartedPayload>(
        'agentMessageThinkingStarted',
        {
          rawType: 'message_update',
          message: raw?.message,
          assistantMessageEvent
        },
        rawEvent,
        {
          agentRunId,
          agentTurnId,
          agentMessageId
        },
        'runtime',
        parentEventId
      )
    }

    if (assistantEventType === 'thinking_delta') {
      this.openThinkingContentKey = thinkingContentKey
      this.openThinkingContentIndex = contentIndex
      this.closedThinkingContentKeys.delete(thinkingContentKey)
      return this.createEvent<AgentMessageThinkingDeltaPayload>(
        'agentMessageThinkingDelta',
        {
          rawType: 'message_update',
          delta: asString(asRecord(assistantMessageEvent)?.delta),
          message: raw?.message,
          assistantMessageEvent
        },
        rawEvent,
        {
          agentRunId,
          agentTurnId,
          agentMessageId
        },
        'runtime',
        parentEventId
      )
    }

    if (assistantEventType === 'thinking_end') {
      if (this.closedThinkingContentKeys.has(thinkingContentKey)) return null
      if (this.openThinkingContentKey === thinkingContentKey) {
        this.openThinkingContentKey = null
        this.openThinkingContentIndex = null
        this.closedThinkingContentKeys.add(thinkingContentKey)
      }
      return this.createEvent<AgentMessageThinkingFinishedPayload>(
        'agentMessageThinkingFinished',
        {
          rawType: 'message_update',
          content: asString(asRecord(assistantMessageEvent)?.content),
          message: raw?.message,
          assistantMessageEvent
        },
        rawEvent,
        {
          agentRunId,
          agentTurnId,
          agentMessageId
        },
        'runtime',
        parentEventId
      )
    }

    if (assistantEventType !== 'text_delta') return null

    const events: NormalizedAgentRuntimeEvent<
      AgentMessageThinkingFinishedPayload | AgentMessageDeltaPayload
    >[] = []

    if (this.openThinkingContentKey) {
      const thinkingContent = getThinkingContent(raw?.message, this.openThinkingContentIndex)
      events.push(
        this.createEvent<AgentMessageThinkingFinishedPayload>(
          'agentMessageThinkingFinished',
          {
            rawType: 'message_update',
            content: thinkingContent,
            message: raw?.message,
            assistantMessageEvent: {
              type: 'thinking_end',
              contentIndex: this.openThinkingContentIndex,
              content: thinkingContent,
              partial: raw?.message
            }
          },
          rawEvent,
          {
            agentRunId,
            agentTurnId,
            agentMessageId
          },
          'inferred',
          parentEventId
        )
      )

      this.closedThinkingContentKeys.add(this.openThinkingContentKey)
      this.openThinkingContentKey = null
      this.openThinkingContentIndex = null
    }

    const textDeltaEvent = this.createEvent<AgentMessageDeltaPayload>(
      'agentMessageDelta',
      {
        rawType: 'message_update',
        delta: asString(asRecord(assistantMessageEvent)?.delta),
        message: raw?.message,
        assistantMessageEvent
      },
      rawEvent,
      {
        agentRunId,
        agentTurnId,
        agentMessageId
      },
      'runtime',
      parentEventId
    )
    events.push(textDeltaEvent)

    return events.length === 1 ? textDeltaEvent : events
  }

  private normalizeMessageEnd(
    rawEvent: unknown,
    raw: JsonRecord | null
  ): NormalizedAgentRuntimeEvent<AgentMessageFinishedPayload> {
    const agentRunId = this.ensureRunContext()
    const agentTurnId = this.activeTurnId
    const agentMessageId = this.ensureMessageContext()
    const message = raw?.message
    const role = getRole(message)

    const event = this.createEvent<AgentMessageFinishedPayload>(
      'agentMessageFinished',
      {
        rawType: 'message_end',
        role,
        message
      },
      rawEvent,
      {
        agentRunId,
        agentTurnId,
        agentMessageId
      },
      'runtime',
      this.activeMessageStartEventId ?? this.activeTurnStartEventId ?? this.runStartEventId
    )

    if (role === 'assistant') this.captureTerminalMessageState(message)

    this.activeMessageId = null
    this.activeMessageStartEventId = null
    this.openThinkingContentKey = null
    this.openThinkingContentIndex = null
    this.closedThinkingContentKeys.clear()
    return event
  }

  private captureTerminalMessageState(message: unknown): void {
    const stopReason = getStopReason(message)
    if (stopReason === 'aborted') {
      this.sawAbortedMessage = true
      return
    }
    if (stopReason === 'error') {
      this.sawTerminalMessageError = true
    }
  }

  private normalizeToolStart(
    rawEvent: unknown,
    raw: JsonRecord | null
  ): NormalizedAgentRuntimeEvent<AgentToolCallStartedPayload> {
    const agentRunId = this.ensureRunContext()
    const agentTurnId = this.ensureTurnContext()
    const toolCallId = asString(raw?.toolCallId) || generateId()
    this.toolContexts.set(toolCallId, {
      agentTurnId,
      args: raw?.args,
      startEventId: null
    })

    const event = this.createEvent<AgentToolCallStartedPayload>(
      'agentToolCallStarted',
      {
        rawType: 'tool_execution_start',
        toolName: asString(raw?.toolName) || 'tool',
        args: raw?.args
      },
      rawEvent,
      {
        agentRunId,
        agentTurnId,
        agentMessageId: this.activeMessageId,
        toolCallId
      },
      'runtime',
      this.activeTurnStartEventId ?? this.runStartEventId
    )

    const context = this.toolContexts.get(toolCallId)
    if (context) context.startEventId = event.id
    return event
  }

  private normalizeToolProgress(
    rawEvent: unknown,
    raw: JsonRecord | null
  ): NormalizedAgentRuntimeEvent<AgentToolCallProgressPayload> {
    const agentRunId = this.ensureRunContext()
    const toolCallId = asString(raw?.toolCallId) || generateId()
    const context = this.toolContexts.get(toolCallId)
    const agentTurnId = context?.agentTurnId ?? this.ensureTurnContext()
    if (!context) {
      this.toolContexts.set(toolCallId, {
        agentTurnId,
        args: raw?.args,
        startEventId: null
      })
    } else if (raw?.args !== undefined) {
      context.args = raw.args
    }

    return this.createEvent<AgentToolCallProgressPayload>(
      'agentToolCallProgress',
      {
        rawType: 'tool_execution_update',
        toolName: asString(raw?.toolName) || 'tool',
        args: raw?.args ?? context?.args,
        partialResult: raw?.partialResult
      },
      rawEvent,
      {
        agentRunId,
        agentTurnId,
        agentMessageId: this.activeMessageId,
        toolCallId
      },
      'runtime',
      context?.startEventId ?? this.activeTurnStartEventId ?? this.runStartEventId
    )
  }

  private normalizeToolFinished(
    rawEvent: unknown,
    raw: JsonRecord | null
  ): NormalizedAgentRuntimeEvent<AgentToolCallFinishedPayload> {
    const agentRunId = this.ensureRunContext()
    const toolCallId = asString(raw?.toolCallId) || generateId()
    const context = this.toolContexts.get(toolCallId)
    const agentTurnId = context?.agentTurnId ?? this.ensureTurnContext()

    const event = this.createEvent<AgentToolCallFinishedPayload>(
      'agentToolCallFinished',
      {
        rawType: 'tool_execution_end',
        toolName: asString(raw?.toolName) || 'tool',
        args: raw?.args ?? context?.args,
        result: raw?.result,
        isError: Boolean(raw?.isError)
      },
      rawEvent,
      {
        agentRunId,
        agentTurnId,
        agentMessageId: this.activeMessageId,
        toolCallId
      },
      'runtime',
      context?.startEventId ?? this.activeTurnStartEventId ?? this.runStartEventId
    )

    this.toolContexts.delete(toolCallId)
    return event
  }

  private normalizeThreadEvent(
    rawEvent: unknown,
    rawType: AgentThreadEventPayload['rawType']
  ): NormalizedAgentRuntimeEvent<AgentThreadEventPayload> {
    const type =
      rawType === 'session_start'
        ? 'agentThreadStarted'
        : rawType === 'session_switch'
          ? 'agentThreadSwitched'
          : rawType === 'session_fork'
            ? 'agentThreadForked'
            : rawType === 'session_compact'
              ? 'agentThreadCompacted'
              : 'agentThreadShutdown'

    return this.createEvent<AgentThreadEventPayload>(
      type,
      {
        rawType,
        data: rawEvent
      },
      rawEvent,
      {
        agentRunId: this.activeRunId,
        agentTurnId: this.activeTurnId,
        agentMessageId: this.activeMessageId
      }
    )
  }

  private ensureRunContext(): string {
    if (this.activeRunId) return this.activeRunId
    const nextRunId = generateId()
    this.activeRunId = nextRunId
    this.traceId = this.traceId ?? generateId()
    this.correlationId = this.activeRunId
    return nextRunId
  }

  private ensureTurnContext(): string {
    if (this.activeTurnId) return this.activeTurnId
    const nextTurnId = generateId()
    this.activeTurnId = nextTurnId
    this.activeTurnIndex = Math.max(this.activeTurnIndex + 1, 0)
    return nextTurnId
  }

  private ensureMessageContext(): string {
    if (this.activeMessageId) return this.activeMessageId
    const nextMessageId = generateId()
    this.activeMessageId = nextMessageId
    return nextMessageId
  }

  private createEvent<T>(
    type: NormalizedAgentRuntimeEvent<T>['type'],
    payload: T,
    raw: unknown,
    ids: Partial<
      Pick<
        NormalizedAgentRuntimeEvent<T>,
        'agentRunId' | 'agentTurnId' | 'agentMessageId' | 'toolCallId'
      >
    >,
    origin: EventOrigin = 'runtime',
    parentEventId?: string | null
  ): NormalizedAgentRuntimeEvent<T> {
    const id = generateId()
    this.sequence += 1
    const event: NormalizedAgentRuntimeEvent<T> = {
      id,
      source: 'pi-mono',
      type,
      timestamp: Date.now(),
      threadId: this.threadId,
      agentRunId: ids.agentRunId ?? null,
      agentTurnId: ids.agentTurnId ?? null,
      agentMessageId: ids.agentMessageId ?? null,
      toolCallId: ids.toolCallId ?? null,
      correlationId: this.correlationId ?? this.ensureRunContext(),
      traceId: this.traceId ?? generateId(),
      causationId: this.lastEventId,
      parentEventId: parentEventId ?? null,
      sequence: this.sequence,
      origin,
      payload,
      raw
    }
    this.lastEventId = id
    this.traceId = event.traceId
    this.correlationId = event.correlationId
    return event
  }
}
