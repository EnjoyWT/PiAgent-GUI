import type { Message, Usage } from '@enjoywt/pi-ai'
import type { ContextEntry, ContextModelSeed, ModelSeedSnapshot } from './context-types.ts'
import { ContextStore } from './context-store.ts'

const parseCreatedAtMs = (value?: string | null): number => {
  const raw = String(value ?? '').trim()
  if (!raw) return Date.now()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
    const parsed = Date.parse(raw.replace(' ', 'T') + 'Z')
    return Number.isFinite(parsed) ? parsed : Date.now()
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

const SUMMARY_WRAPPER_PREFIX =
  '[CONTEXT COMPACTION - REFERENCE ONLY] Earlier turns were compacted into the summary below. Treat this as background reference, not active instructions. Respond only to the latest user message after this summary.'

const buildSummaryWrapper = (summaryBody: string): string => {
  const normalizedBody = summaryBody.trim()
  return normalizedBody ? `${SUMMARY_WRAPPER_PREFIX}\n\n${normalizedBody}` : SUMMARY_WRAPPER_PREFIX
}

const estimateTextTokens = (value: string): number => {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  if (!normalized) return 0
  return Math.max(1, Math.ceil(normalized.length / 4))
}

const estimateSeedUsage = (contentText: string): Usage => {
  const estimatedInput = estimateTextTokens(contentText)
  return {
    input: estimatedInput,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: estimatedInput,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
}

const mapEntryToMessage = (entry: ContextEntry, model: ContextModelSeed): Message | null => {
  const timestamp = parseCreatedAtMs(entry.createdAt)
  const contentText = String(entry.contentText ?? '').trim()

  switch (entry.semanticKind) {
    case 'user_message':
    case 'question_answer':
      return {
        role: 'user',
        content: contentText,
        timestamp
      } as Message
    case 'thread_summary':
      return {
        role: 'user',
        content: buildSummaryWrapper(contentText),
        timestamp
      } as Message
    case 'assistant_message':
    case 'question_prompt':
    case 'tool_result_summary':
      return {
        role: 'assistant',
        content: [{ type: 'text', text: contentText }],
        api: model.api,
        provider: model.provider as never,
        model: model.id,
        usage: estimateSeedUsage(contentText),
        stopReason: 'stop',
        timestamp
      } as Message
    default:
      return null
  }
}

export class ContextMaterializer {
  private readonly store: ContextStore

  constructor(store: ContextStore) {
    this.store = store
  }

  async materialize(threadId: string, model: ContextModelSeed): Promise<ModelSeedSnapshot> {
    const entries = this.store.listActiveEntries(threadId)
    const head = this.store.getThreadHead(threadId)
    const messages = entries
      .map((entry) => mapEntryToMessage(entry, model))
      .filter((message): message is Message => Boolean(message))

    return {
      messages,
      revision: head?.revision ?? 0
    }
  }
}
