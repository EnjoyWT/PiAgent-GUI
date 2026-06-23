import type { NormalizedAgentRuntimeEvent } from '@shared/agent-runtime'
import type { ConversationEventRow, MessageRow } from '../../preload/db-types.ts'
import type { AgentMessageStartedPayload } from './runtime-types'

type RuntimeEventStoreOptions = {
  onConsumedUserMessage?: (message: MessageRow) => void | Promise<void>
  onEventsFlushed?: (rows: ConversationEventRow[]) => void | Promise<void>
  ensureConsumedUserMessage?: (input: {
    threadId: string
    text: string
    agentRunId: string
    agentTurnId?: string | null
    consumedAt: number
    runtimeSequence: number
    submissionId?: string | null
  }) => MessageRow | null | Promise<MessageRow | null>
}

const safeJsonStringify = (value: unknown): string | null => {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

export class RuntimeEventStore {
  private readonly queue: ConversationEventRow[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private readonly options: RuntimeEventStoreOptions

  constructor(options: RuntimeEventStoreOptions = {}) {
    this.options = options
  }

  append(event: NormalizedAgentRuntimeEvent): void {
    this.persistRuntimeFacts(event)
    this.queue.push({
      id: event.id,
      thread_id: event.threadId,
      agent_run_id: event.agentRunId,
      runtime_agent_run_id: event.runtimeAgentRunId ?? null,
      event_type: event.type,
      event_origin: event.origin,
      correlation_id: event.correlationId,
      payload_json: safeJsonStringify(event.payload) ?? 'null',
      raw_json: safeJsonStringify(event.raw),
      created_at: event.timestamp
    })
    if (
      event.type === 'agentMessageDelta' ||
      event.type === 'agentMessageThinkingDelta' ||
      event.type === 'agentToolCallProgress'
    ) {
      this.scheduleFlush(48)
      return
    }
    this.scheduleFlush(0)
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.queue.length === 0) return
    const rows = this.queue.splice(0, this.queue.length)
    const callback = this.options.onEventsFlushed
    if (callback) {
      Promise.resolve(callback(rows)).catch((error) => {
        console.error('RuntimeEventStore.onEventsFlushed failed', error)
      })
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, delayMs)
  }

  private persistRuntimeFacts(event: NormalizedAgentRuntimeEvent): void {
    if (event.type !== 'agentMessageStarted') return

    const payload = event.payload as AgentMessageStartedPayload
    if (payload?.role !== 'user') return

    const text = this.extractUserText(payload.message)
    if (!text || !event.agentRunId) return

    if (!this.options.ensureConsumedUserMessage) return

    const persistedOrPromise = this.options.ensureConsumedUserMessage({
      threadId: event.threadId,
      text,
      agentRunId: event.agentRunId,
      agentTurnId: event.agentTurnId,
      consumedAt: event.timestamp,
      runtimeSequence: event.sequence,
      submissionId: payload.submissionId ?? null
    })

    Promise.resolve(persistedOrPromise)
      .then((persisted) => {
        if (!persisted) return
        const callback = this.options.onConsumedUserMessage
        if (!callback) return
        return callback(persisted)
      })
      .catch((error) => {
        console.error('RuntimeEventStore.onConsumedUserMessage failed', error)
      })
  }

  private extractUserText(message: unknown): string {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return ''
    const record = message as Record<string, unknown>
    const content = Array.isArray(record.content) ? record.content : []
    const text = content
      .filter(
        (item): item is { type: string; text: string } =>
          Boolean(item) &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          (item as { type?: unknown }).type === 'text' &&
          typeof (item as { text?: unknown }).text === 'string'
      )
      .map((item) => item.text)
      .join('\n')
      .replace(/\r\n/g, '\n')
      .trim()
    return text
  }
}
