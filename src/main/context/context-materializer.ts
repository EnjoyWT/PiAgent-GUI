import type { Message, Usage } from '@earendil-works/pi-ai/compat'
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

/**
 * Zero usage for seeded assistants.
 *
 * Why zero (not omitted, not content-estimated):
 * 1. pi-coding-agent/pi-ai always read `message.usage.totalTokens` /
 *    `message.usage.input` without optional chaining. Missing usage throws
 *    `Cannot read properties of undefined (reading 'totalTokens')`.
 * 2. estimateContextTokens trusts the last assistant with usage > 0 and then
 *    only adds trailing messages. Content-estimated per-message usage would
 *    undercount multi-entry tool history (only the last seed counts).
 * 3. Zero usage is ignored by getAssistantUsage (requires > 0), so estimation
 *    falls back to full-message heuristics — the correct behavior for seeds.
 */
const ZERO_SEED_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
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
        usage: ZERO_SEED_USAGE,
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
