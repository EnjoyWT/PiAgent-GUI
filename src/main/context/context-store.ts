import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import type {
  ContextCompaction,
  ContextEngineStateRow,
  ContextEntry,
  ContextEntryInput,
  ThreadContextHead
} from './context-types.ts'

const formatSqliteUtcTimestamp = (value?: string | number | Date | null): string => {
  if (typeof value === 'string')
    return value.trim() || new Date().toISOString().replace('T', ' ').replace('Z', '')
  if (typeof value === 'number')
    return new Date(value).toISOString().replace('T', ' ').replace('Z', '')
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('Z', '')
  return new Date().toISOString().replace('T', ' ').replace('Z', '')
}

const parseContextTimestampMs = (value?: string | null): number => {
  const raw = String(value ?? '').trim()
  if (!raw) return Number.NaN
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
    const parsed = Date.parse(`${raw.replace(' ', 'T')}Z`)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

const rowToEntry = (row: Record<string, unknown>): ContextEntry => ({
  id: String(row.id),
  threadId: String(row.thread_id),
  seq: Number(row.seq),
  agentRunId: row.agent_run_id == null ? null : String(row.agent_run_id),
  agentTurnId: row.agent_turn_id == null ? null : String(row.agent_turn_id),
  sourceKind: String(row.source_kind) as ContextEntry['sourceKind'],
  sourceRef: row.source_ref == null ? null : String(row.source_ref),
  groupId: row.group_id == null ? null : String(row.group_id),
  role: String(row.role) as ContextEntry['role'],
  semanticKind: String(row.semantic_kind) as ContextEntry['semanticKind'],
  includeInModelContext: Number(row.include_in_model_context) === 1,
  includeInMemory: Number(row.include_in_memory) === 1,
  compactPolicy: String(row.compact_policy) as ContextEntry['compactPolicy'],
  contentText: row.content_text == null ? null : String(row.content_text),
  contentJson: row.content_json == null ? null : String(row.content_json),
  tokenEstimate: row.token_estimate == null ? null : Number(row.token_estimate),
  createdAt: String(row.created_at)
})

const rowToHead = (row: Record<string, unknown>): ThreadContextHead => ({
  threadId: String(row.thread_id),
  engineName: String(row.engine_name),
  activeSummaryEntryId:
    row.active_summary_entry_id == null ? null : String(row.active_summary_entry_id),
  compactedUntilSeq: row.compacted_until_seq == null ? null : Number(row.compacted_until_seq),
  revision: Number(row.revision),
  contextUsageTokens: row.context_usage_tokens == null ? null : Number(row.context_usage_tokens),
  contextUsageWindow: row.context_usage_window == null ? null : Number(row.context_usage_window),
  contextUsageRevision: row.context_usage_revision == null ? null : Number(row.context_usage_revision),
  contextUsageUpdatedAt:
    row.context_usage_updated_at == null ? null : String(row.context_usage_updated_at),
  updatedAt: String(row.updated_at)
})

const rowToCompaction = (row: Record<string, unknown>): ContextCompaction => ({
  id: String(row.id),
  threadId: String(row.thread_id),
  engineName: String(row.engine_name),
  reason: String(row.reason) as ContextCompaction['reason'],
  baseSummaryEntryId: row.base_summary_entry_id == null ? null : String(row.base_summary_entry_id),
  newSummaryEntryId: row.new_summary_entry_id == null ? null : String(row.new_summary_entry_id),
  fromSeqExclusive: Number(row.from_seq_exclusive),
  compactedUntilSeq: Number(row.compacted_until_seq),
  protectedTailStartSeq:
    row.protected_tail_start_seq == null ? null : Number(row.protected_tail_start_seq),
  estimatedInputTokens:
    row.estimated_input_tokens == null ? null : Number(row.estimated_input_tokens),
  estimatedOutputTokens:
    row.estimated_output_tokens == null ? null : Number(row.estimated_output_tokens),
  createdAt: String(row.created_at)
})

export class ContextStore {
  private readonly db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  ensureThreadHead(threadId: string, engineName: string): ThreadContextHead {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) throw new Error('threadId is required')

    this.db
      .prepare(
        `
          INSERT INTO thread_context_heads (thread_id, engine_name, revision, updated_at)
          VALUES (?, ?, 0, ?)
          ON CONFLICT(thread_id) DO NOTHING
        `
      )
      .run(normalizedThreadId, engineName, formatSqliteUtcTimestamp())

    const row = this.db
      .prepare('SELECT * FROM thread_context_heads WHERE thread_id = ?')
      .get(normalizedThreadId) as Record<string, unknown> | undefined
    if (!row) throw new Error(`Failed to load context head for thread ${normalizedThreadId}`)
    return rowToHead(row)
  }

  getThreadHead(threadId: string): ThreadContextHead | null {
    const row = this.db
      .prepare('SELECT * FROM thread_context_heads WHERE thread_id = ?')
      .get(threadId) as Record<string, unknown> | undefined
    return row ? rowToHead(row) : null
  }

  upsertThreadHead(input: {
    threadId: string
    engineName: string
    activeSummaryEntryId?: string | null
    compactedUntilSeq?: number | null
    revision?: number
    contextUsageTokens?: number | null
    contextUsageWindow?: number | null
    contextUsageRevision?: number | null
    contextUsageUpdatedAt?: string | null
  }): ThreadContextHead {
    const current = this.getThreadHead(input.threadId)
    const revision =
      typeof input.revision === 'number' ? input.revision : (current?.revision ?? 0) + 1
    const updatedAt = formatSqliteUtcTimestamp()
    this.db
      .prepare(
        `
          INSERT INTO thread_context_heads (
            thread_id, engine_name, active_summary_entry_id, compacted_until_seq, revision,
            context_usage_tokens, context_usage_window, context_usage_revision, context_usage_updated_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET
            engine_name = excluded.engine_name,
            active_summary_entry_id = excluded.active_summary_entry_id,
            compacted_until_seq = excluded.compacted_until_seq,
            revision = excluded.revision,
            context_usage_tokens = excluded.context_usage_tokens,
            context_usage_window = excluded.context_usage_window,
            context_usage_revision = excluded.context_usage_revision,
            context_usage_updated_at = excluded.context_usage_updated_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.threadId,
        input.engineName,
        input.activeSummaryEntryId ?? null,
        input.compactedUntilSeq ?? null,
        revision,
        input.contextUsageTokens ?? current?.contextUsageTokens ?? null,
        input.contextUsageWindow ?? current?.contextUsageWindow ?? null,
        input.contextUsageRevision ?? current?.contextUsageRevision ?? null,
        input.contextUsageUpdatedAt ?? current?.contextUsageUpdatedAt ?? null,
        updatedAt
      )
    return this.ensureThreadHead(input.threadId, input.engineName)
  }

  saveContextUsage(threadId: string, usage: { tokens: number; contextWindow: number }): ThreadContextHead {
    const head = this.getThreadHead(threadId) ?? this.ensureThreadHead(threadId, 'summary-compressor')
    const updatedAt = formatSqliteUtcTimestamp()
    this.db.prepare(`
      UPDATE thread_context_heads
      SET context_usage_tokens = ?, context_usage_window = ?, context_usage_revision = ?,
          context_usage_updated_at = ?, updated_at = ?
      WHERE thread_id = ?
    `).run(Math.trunc(usage.tokens), Math.trunc(usage.contextWindow), head.revision, updatedAt, updatedAt, threadId)
    return this.ensureThreadHead(threadId, head.engineName)
  }

  listEntries(threadId: string): ContextEntry[] {
    return (
      this.db
        .prepare(
          `
            SELECT *
            FROM context_entries
            WHERE thread_id = ?
            ORDER BY seq ASC
          `
        )
        .all(threadId) as Array<Record<string, unknown>>
    ).map(rowToEntry)
  }

  listActiveEntries(threadId: string): ContextEntry[] {
    const head = this.getThreadHead(threadId)
    if (!head || (head.activeSummaryEntryId == null && head.compactedUntilSeq == null)) {
      return (
        this.db
          .prepare(
            `
              SELECT *
              FROM context_entries
              WHERE thread_id = ?
                AND include_in_model_context = 1
              ORDER BY seq ASC
            `
          )
          .all(threadId) as Array<Record<string, unknown>>
      ).map(rowToEntry)
    }

    const entries: ContextEntry[] = []
    const keepRows = this.db
      .prepare(
        `
          SELECT *
          FROM context_entries
          WHERE thread_id = ?
            AND include_in_model_context = 1
            AND compact_policy = 'keep'
            AND semantic_kind != 'thread_summary'
            AND seq <= ?
          ORDER BY seq ASC
        `
      )
      .all(threadId, head.compactedUntilSeq ?? 0) as Array<Record<string, unknown>>
    entries.push(...keepRows.map(rowToEntry))

    if (head.activeSummaryEntryId) {
      const summaryRow = this.db
        .prepare('SELECT * FROM context_entries WHERE id = ? LIMIT 1')
        .get(head.activeSummaryEntryId) as Record<string, unknown> | undefined
      if (summaryRow) entries.push(rowToEntry(summaryRow))
    }

    const tailRows = this.db
      .prepare(
        `
          SELECT *
          FROM context_entries
          WHERE thread_id = ?
            AND include_in_model_context = 1
            AND seq > ?
            AND id != ?
          ORDER BY seq ASC
        `
      )
      .all(threadId, head.compactedUntilSeq ?? 0, head.activeSummaryEntryId ?? '') as Array<
      Record<string, unknown>
    >

    entries.push(...tailRows.map(rowToEntry))
    return entries
  }

  listForMemory(threadId: string, limit: number): ContextEntry[] {
    const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit || 0), 200))
    return (
      this.db
        .prepare(
          `
            SELECT *
            FROM context_entries
            WHERE thread_id = ?
              AND include_in_memory = 1
            ORDER BY seq DESC
            LIMIT ?
          `
        )
        .all(threadId, normalizedLimit) as Array<Record<string, unknown>>
    )
      .map(rowToEntry)
      .reverse()
  }

  findEntryBySourceRef(
    threadId: string,
    semanticKind: ContextEntry['semanticKind'],
    sourceRef: string
  ): ContextEntry | null {
    const normalizedSourceRef = String(sourceRef ?? '').trim()
    if (!normalizedSourceRef) return null
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM context_entries
          WHERE thread_id = ?
            AND semantic_kind = ?
            AND source_ref = ?
          LIMIT 1
        `
      )
      .get(threadId, semanticKind, normalizedSourceRef) as Record<string, unknown> | undefined
    return row ? rowToEntry(row) : null
  }

  appendEntry(input: ContextEntryInput): ContextEntry {
    const normalizedSourceRef = String(input.sourceRef ?? '').trim()
    if (normalizedSourceRef) {
      const existing = this.findEntryBySourceRef(
        input.threadId,
        input.semanticKind,
        normalizedSourceRef
      )
      if (existing) return existing
    }

    const append = this.db.transaction((draft: ContextEntryInput): ContextEntry => {
      const nextSeqRow = this.db
        .prepare(
          `
            SELECT COALESCE(MAX(seq), 0) AS max_seq
            FROM context_entries
            WHERE thread_id = ?
          `
        )
        .get(draft.threadId) as { max_seq?: number } | undefined
      const nextSeq = Math.max(0, Number(nextSeqRow?.max_seq ?? 0)) + 1
      const id = nanoid(16)
      this.db
        .prepare(
          `
            INSERT INTO context_entries (
              id, thread_id, seq, agent_run_id, agent_turn_id, source_kind, source_ref, group_id,
              role, semantic_kind, include_in_model_context, include_in_memory, compact_policy,
              content_text, content_json, token_estimate, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          id,
          draft.threadId,
          nextSeq,
          draft.agentRunId ?? null,
          draft.agentTurnId ?? null,
          draft.sourceKind,
          normalizedSourceRef || null,
          draft.groupId ?? null,
          draft.role,
          draft.semanticKind,
          draft.includeInModelContext ? 1 : 0,
          draft.includeInMemory ? 1 : 0,
          draft.compactPolicy,
          draft.contentText ?? null,
          draft.contentJson ?? null,
          draft.tokenEstimate ?? null,
          formatSqliteUtcTimestamp(draft.createdAt)
        )

      const row = this.db.prepare('SELECT * FROM context_entries WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined
      if (!row) throw new Error(`Failed to read appended context entry ${id}`)
      return rowToEntry(row)
    })

    return append(input)
  }

  appendEntries(entries: ContextEntryInput[]): ContextEntry[] {
    if (entries.length === 0) return []
    const results: ContextEntry[] = []
    for (const entry of entries) results.push(this.appendEntry(entry))
    return results
  }

  pruneThreadAfter(threadId: string, cutoffCreatedAt: string): number {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) throw new Error('threadId is required')
    const cutoffMs = parseContextTimestampMs(cutoffCreatedAt)
    if (!Number.isFinite(cutoffMs)) throw new Error('cutoffCreatedAt is invalid')

    const entryRows = this.db
      .prepare(
        `
          SELECT id, created_at
          FROM context_entries
          WHERE thread_id = ?
        `
      )
      .all(normalizedThreadId) as Array<{ id: string; created_at: string }>
    const entryIds = entryRows
      .filter((row) => parseContextTimestampMs(row.created_at) >= cutoffMs)
      .map((row) => row.id)

    const compactionRows = this.db
      .prepare(
        `
          SELECT id, created_at
          FROM context_compactions
          WHERE thread_id = ?
        `
      )
      .all(normalizedThreadId) as Array<{ id: string; created_at: string }>
    const compactionIds = compactionRows
      .filter((row) => parseContextTimestampMs(row.created_at) >= cutoffMs)
      .map((row) => row.id)

    if (entryIds.length === 0 && compactionIds.length === 0) return 0

    const prune = this.db.transaction(() => {
      if (compactionIds.length > 0) {
        const placeholders = compactionIds.map(() => '?').join(', ')
        this.db
          .prepare(`DELETE FROM context_compactions WHERE id IN (${placeholders})`)
          .run(...compactionIds)
      }

      if (entryIds.length > 0) {
        const placeholders = entryIds.map(() => '?').join(', ')
        this.db.prepare(`DELETE FROM context_entries WHERE id IN (${placeholders})`).run(...entryIds)
      }

      const head = this.getThreadHead(normalizedThreadId)
      if (head) {
        const activeSummaryExists =
          !head.activeSummaryEntryId ||
          Boolean(
            this.db
              .prepare('SELECT id FROM context_entries WHERE id = ? LIMIT 1')
              .get(head.activeSummaryEntryId)
          )
        const nextActiveSummaryEntryId = activeSummaryExists ? head.activeSummaryEntryId : null
        const nextCompactedUntilSeq = activeSummaryExists ? head.compactedUntilSeq : null
        this.db
          .prepare(
            `
              UPDATE thread_context_heads
              SET active_summary_entry_id = ?,
                  compacted_until_seq = ?,
                  revision = revision + 1,
                  updated_at = ?
              WHERE thread_id = ?
            `
          )
          .run(
            nextActiveSummaryEntryId,
            nextCompactedUntilSeq ?? null,
            formatSqliteUtcTimestamp(),
            normalizedThreadId
          )
      }

      this.db.prepare('DELETE FROM context_engine_state WHERE thread_id = ?').run(normalizedThreadId)
    })

    prune()
    return entryIds.length
  }

  updateCompactPolicy(entryIds: string[], policy: ContextEntry['compactPolicy']): void {
    const normalizedIds = Array.from(
      new Set(entryIds.map((entryId) => String(entryId ?? '').trim()).filter(Boolean))
    )
    if (normalizedIds.length === 0) return

    const update = this.db.transaction((ids: string[]) => {
      const statement = this.db.prepare(
        'UPDATE context_entries SET compact_policy = ? WHERE id = ?'
      )
      for (const entryId of ids) statement.run(policy, entryId)
    })

    update(normalizedIds)
  }

  getEngineState(threadId: string, engineName: string): ContextEngineStateRow | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM context_engine_state
          WHERE thread_id = ?
            AND engine_name = ?
          LIMIT 1
        `
      )
      .get(threadId, engineName) as Record<string, unknown> | undefined

    if (!row) return null
    return {
      threadId: String(row.thread_id),
      engineName: String(row.engine_name),
      stateJson: String(row.state_json),
      updatedAt: String(row.updated_at)
    }
  }

  setEngineState(threadId: string, engineName: string, stateJson: string): ContextEngineStateRow {
    const updatedAt = formatSqliteUtcTimestamp()
    this.db
      .prepare(
        `
          INSERT INTO context_engine_state (thread_id, engine_name, state_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(thread_id, engine_name) DO UPDATE SET
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
        `
      )
      .run(threadId, engineName, stateJson, updatedAt)

    const row = this.getEngineState(threadId, engineName)
    if (!row)
      throw new Error(`Failed to persist context engine state for ${threadId}/${engineName}`)
    return row
  }

  addCompaction(row: ContextCompaction): void {
    this.db
      .prepare(
        `
          INSERT INTO context_compactions (
            id, thread_id, engine_name, reason, base_summary_entry_id, new_summary_entry_id,
            from_seq_exclusive, compacted_until_seq, protected_tail_start_seq,
            estimated_input_tokens, estimated_output_tokens, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        row.id,
        row.threadId,
        row.engineName,
        row.reason,
        row.baseSummaryEntryId ?? null,
        row.newSummaryEntryId ?? null,
        row.fromSeqExclusive,
        row.compactedUntilSeq,
        row.protectedTailStartSeq ?? null,
        row.estimatedInputTokens ?? null,
        row.estimatedOutputTokens ?? null,
        formatSqliteUtcTimestamp(row.createdAt)
      )
  }

  listCompactions(threadId: string, limit = 10): ContextCompaction[] {
    const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit || 0), 100))
    return (
      this.db
        .prepare(
          `
            SELECT *
            FROM context_compactions
            WHERE thread_id = ?
            ORDER BY created_at DESC
            LIMIT ?
          `
        )
        .all(threadId, normalizedLimit) as Array<Record<string, unknown>>
    ).map(rowToCompaction)
  }

  deleteThread(threadId: string): boolean {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) return false

    const deleteAll = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM context_entries WHERE thread_id = ?')
        .run(normalizedThreadId)
      this.db
        .prepare('DELETE FROM context_compactions WHERE thread_id = ?')
        .run(normalizedThreadId)
      this.db
        .prepare('DELETE FROM context_engine_state WHERE thread_id = ?')
        .run(normalizedThreadId)
      this.db
        .prepare('DELETE FROM thread_context_heads WHERE thread_id = ?')
        .run(normalizedThreadId)
    })

    deleteAll()
    return true
  }

  getStats(): { threadCount: number; entryCount: number; compactionCount: number } {
    const threadCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM thread_context_heads').get() as {
        count: number
      }
    ).count
    const entryCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM context_entries').get() as { count: number }
    ).count
    const compactionCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM context_compactions').get() as {
        count: number
      }
    ).count
    return { threadCount, entryCount, compactionCount }
  }
}
