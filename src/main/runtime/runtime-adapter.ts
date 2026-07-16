import { generateId } from '@shared/id'
import type {
  AgentAppEvent,
  AgentRunProjection,
  NormalizedAgentRuntimeEvent
} from '@shared/agent-runtime'
import type { ConversationEventRow, MessageRow } from '../../preload/db-types.ts'
import type { AgentRunEndedPayload } from './runtime-types'
import { PiMonoEventSource } from './pi-mono-event-source'
import { PiMonoNormalizer } from './pi-mono-normalizer'
import { RunProjector } from './run-projector'
import { RuntimeEventStore } from './runtime-event-store'

type RuntimeThreadLike = {
  subscribe: (callback: (event: unknown) => void) => () => void
}

type CanonicalRunIdResolver = (
  agentRunId: string,
  event: NormalizedAgentRuntimeEvent
) => string | null | undefined

type RuntimeAdapterOptions = {
  threadId: string
  onAppEvent: (event: AgentAppEvent) => void
  onRunFinalized?: (run: AgentRunProjection) => void | Promise<void>
  onConsumedUserMessage?: (message: MessageRow) => void | Promise<void>
  onEventsFlushed?: (rows: ConversationEventRow[]) => void | Promise<void>
  resolveCanonicalRunId?: CanonicalRunIdResolver
  ensureConsumedUserMessage?: (input: {
    threadId: string
    text: string
    agentRunId: string
    agentTurnId?: string | null
    consumedAt: number
    runtimeSequence: number
  }) => MessageRow | null | Promise<MessageRow | null>
}

export class RuntimeAdapter {
  private readonly normalizer: PiMonoNormalizer
  private readonly projector = new RunProjector()
  private readonly eventSource: PiMonoEventSource
  private readonly eventStore: RuntimeEventStore
  private unsubscribe: (() => void) | null = null
  private readonly options: RuntimeAdapterOptions

  constructor(runtimeThread: RuntimeThreadLike, options: RuntimeAdapterOptions) {
    this.options = options
    this.normalizer = new PiMonoNormalizer(options.threadId)
    this.eventSource = new PiMonoEventSource(runtimeThread)
    this.eventStore = new RuntimeEventStore({
      ensureConsumedUserMessage: options.ensureConsumedUserMessage,
      onConsumedUserMessage: options.onConsumedUserMessage,
      onEventsFlushed: options.onEventsFlushed
    })
  }

  connect(): () => void {
    this.unsubscribe = this.eventSource.subscribe((rawEvent) => {
      const normalizedEvents = this.normalizer.normalizeMany(rawEvent)
      if (normalizedEvents.length === 0) return
      for (const normalizedEvent of normalizedEvents) {
        this.applyNormalizedEvent(normalizedEvent)
      }
    })
    return () => this.dispose()
  }

  markAbortRequested(): void {
    for (const event of this.normalizer.markAbortRequested()) {
      this.applyNormalizedEvent(event)
    }
  }

  private canonicalizeRunIdentity<T>(
    event: NormalizedAgentRuntimeEvent<T>
  ): NormalizedAgentRuntimeEvent<T> {
    const runtimeRunId = event.agentRunId
    if (!runtimeRunId || !this.options.resolveCanonicalRunId) return event

    const canonicalRunId = this.options.resolveCanonicalRunId(runtimeRunId, event)
    if (!canonicalRunId || canonicalRunId === runtimeRunId) return event

    return {
      ...event,
      agentRunId: canonicalRunId,
      runtimeAgentRunId: event.runtimeAgentRunId ?? runtimeRunId
    }
  }

  forceAbortIfRunning(): boolean {
    const snapshot = this.projector.getSnapshot()
    if (!snapshot || snapshot.status !== 'running') return false

    const timestamp = Date.now()
    const syntheticEvent = {
      id: generateId(),
      source: 'pi-mono' as const,
      type: 'agentRunAborted' as const,
      timestamp,
      threadId: this.options.threadId,
      agentRunId: snapshot.agentRunId,
      agentTurnId: snapshot.turns.at(-1)?.agentTurnId ?? null,
      agentMessageId: snapshot.messages.at(-1)?.agentMessageId ?? null,
      toolCallId: snapshot.toolCalls.at(-1)?.toolCallId ?? null,
      traceId: generateId(),
      correlationId: snapshot.agentRunId,
      causationId: null,
      parentEventId: null,
      sequence: 0,
      origin: 'inferred' as const,
      payload: {
        rawType: 'agent_end' as const,
        messages: [],
        requestedStatus: 'aborted' as const
      },
      raw: {
        type: 'agent_end',
        messages: [],
        requestedStatus: 'aborted'
      }
    } satisfies NormalizedAgentRuntimeEvent<AgentRunEndedPayload>

    this.applyNormalizedEvent(syntheticEvent)
    return true
  }

  private applyNormalizedEvent(event: NormalizedAgentRuntimeEvent): void {
    const canonicalEvent = this.canonicalizeRunIdentity(event)
    this.eventStore.append(canonicalEvent)
    const appEvents = this.projector.apply(canonicalEvent)
    for (const appEvent of appEvents) {
      this.options.onAppEvent(appEvent)
      if (
        appEvent.type === 'agent.run.finished' ||
        appEvent.type === 'agent.run.failed' ||
        appEvent.type === 'agent.run.aborted'
      ) {
        Promise.resolve(this.options.onRunFinalized?.(appEvent.run)).catch((error) => {
          console.error('RuntimeAdapter.onRunFinalized failed', error)
        })
      }
    }
  }

  getSnapshot(): AgentRunProjection | null {
    return this.projector.getSnapshot()
  }

  dispose(): void {
    this.eventStore.flush()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.eventSource.dispose()
    this.projector.dispose()
  }
}
