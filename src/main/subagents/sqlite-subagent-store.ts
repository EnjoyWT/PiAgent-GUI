import type Database from 'better-sqlite3'
import type {
  SubagentAttempt,
  SubagentAttemptStatus,
  SubagentEvent,
  SubagentEventInput,
  SubagentTask,
  SubagentTaskGroup,
  SubagentTaskStatus
} from './subagent-types.ts'
import type { StartupRepairInput, StartupRepairResult, SubagentStore } from './subagent-store.ts'

export type SqliteSubagentStoreOptions = {
  now?: () => string
  migrate?: boolean
}

type GroupRow = {
  id: string
  parent_conversation_id: string
  parent_run_id: string
  parent_message_id: string | null
  parent_tool_call_id: string
  idempotency_key: string | null
  status: SubagentTaskGroup['status']
  wait_strategy: SubagentTaskGroup['waitStrategy']
  created_at: string
  started_at: string | null
  settled_at: string | null
}

type TaskRow = {
  id: string
  group_id: string
  parent_conversation_id: string
  parent_run_id: string
  label: string | null
  instruction: string
  status: SubagentTaskStatus
  depth: number
  workspace_mode: SubagentTask['workspaceMode']
  cwd: string
  tool_allowlist_json: string
  retry_count: number
  current_attempt_id: string | null
  result_summary: string | null
  error: string | null
  created_at: string
  started_at: string | null
  settled_at: string | null
}

type AttemptRow = {
  id: string
  task_id: string
  group_id: string
  parent_run_id: string
  correlation_id: string | null
  attempt_number: number
  status: SubagentAttemptStatus
  worker_session_id: string | null
  process_id: number | null
  result_json: string | null
  error: string | null
  created_at: string
  started_at: string | null
  settled_at: string | null
  lease_expires_at: string | null
}

type EventRow = {
  id: string
  group_id: string
  task_id: string | null
  attempt_id: string | null
  kind: SubagentEvent['kind']
  runtime_event_id: string | null
  severity: SubagentEvent['severity']
  payload_json: string
  created_at: string
  group_event_seq: number
}

export class SqliteSubagentStore implements SubagentStore {
  private readonly now: () => string

  constructor(
    private readonly db: Database.Database,
    options: SqliteSubagentStoreOptions = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString())
    if (options.migrate !== false) ensureSqliteSubagentSchema(db)
  }

  createGroup(group: SubagentTaskGroup): SubagentTaskGroup {
    this.db
      .prepare(
        `INSERT INTO subagent_task_groups (
          id, parent_conversation_id, parent_run_id, parent_message_id, parent_tool_call_id,
          idempotency_key, status, wait_strategy, created_at, started_at, settled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        group.id,
        group.parentConversationId,
        group.parentRunId,
        group.parentMessageId ?? null,
        group.parentToolCallId,
        group.idempotencyKey ?? null,
        group.status,
        group.waitStrategy,
        group.createdAt,
        group.startedAt ?? null,
        group.settledAt ?? null
      )
    return { ...group }
  }

  createTask(task: SubagentTask): SubagentTask {
    this.db
      .prepare(
        `INSERT INTO subagent_tasks (
          id, group_id, parent_conversation_id, parent_run_id, label, instruction, status, depth,
          workspace_mode, cwd, tool_allowlist_json, retry_count, current_attempt_id, result_summary,
          error, created_at, started_at, settled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.groupId,
        task.parentConversationId,
        task.parentRunId,
        task.label ?? null,
        task.instruction,
        task.status,
        task.depth,
        task.workspaceMode,
        task.cwd,
        JSON.stringify(task.toolAllowlist),
        task.retryCount,
        task.currentAttemptId ?? null,
        task.resultSummary ?? null,
        task.error ?? null,
        task.createdAt,
        task.startedAt ?? null,
        task.settledAt ?? null
      )
    return { ...task, toolAllowlist: [...task.toolAllowlist] }
  }

  createAttempt(attempt: SubagentAttempt): SubagentAttempt {
    this.db
      .prepare(
        `INSERT INTO subagent_attempts (
          id, task_id, group_id, parent_run_id, correlation_id, attempt_number, status,
          worker_session_id, process_id, result_json, error, created_at, started_at, settled_at,
          lease_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        attempt.id,
        attempt.taskId,
        attempt.groupId,
        attempt.parentRunId,
        attempt.correlationId ?? null,
        attempt.attemptNumber,
        attempt.status,
        attempt.workerSessionId ?? null,
        attempt.processId ?? null,
        attempt.result ? JSON.stringify(attempt.result) : null,
        attempt.error ?? null,
        attempt.createdAt,
        attempt.startedAt ?? null,
        attempt.settledAt ?? null,
        attempt.leaseExpiresAt ?? null
      )
    this.db.prepare(`UPDATE subagent_tasks SET current_attempt_id = ? WHERE id = ?`).run(attempt.id, attempt.taskId)
    return { ...attempt }
  }

  getGroup(id: string): SubagentTaskGroup | null {
    const row = this.db.prepare(`SELECT * FROM subagent_task_groups WHERE id = ?`).get(id) as GroupRow | undefined
    return row ? groupFromRow(row) : null
  }

  getTask(id: string): SubagentTask | null {
    const row = this.db.prepare(`SELECT * FROM subagent_tasks WHERE id = ?`).get(id) as TaskRow | undefined
    return row ? taskFromRow(row) : null
  }

  getAttempt(id: string): SubagentAttempt | null {
    const row = this.db.prepare(`SELECT * FROM subagent_attempts WHERE id = ?`).get(id) as AttemptRow | undefined
    return row ? attemptFromRow(row) : null
  }

  findGroupByIdempotencyKey(key: string): SubagentTaskGroup | null {
    const row = this.db
      .prepare(`SELECT * FROM subagent_task_groups WHERE idempotency_key = ?`)
      .get(key) as GroupRow | undefined
    return row ? groupFromRow(row) : null
  }

  listTasksByGroup(groupId: string): SubagentTask[] {
    return (this.db
      .prepare(`SELECT * FROM subagent_tasks WHERE group_id = ? ORDER BY created_at, id`)
      .all(groupId) as TaskRow[]).map(taskFromRow)
  }

  listAttemptsByTask(taskId: string): SubagentAttempt[] {
    return (this.db
      .prepare(`SELECT * FROM subagent_attempts WHERE task_id = ? ORDER BY attempt_number, id`)
      .all(taskId) as AttemptRow[]).map(attemptFromRow)
  }

  listEventsByGroup(groupId: string): SubagentEvent[] {
    return (this.db
      .prepare(`SELECT * FROM subagent_events WHERE group_id = ? ORDER BY group_event_seq`)
      .all(groupId) as EventRow[]).map(eventFromRow)
  }

  appendEvent(input: SubagentEventInput): SubagentEvent {
    if (input.runtimeEventId && input.attemptId) {
      const existing = this.db
        .prepare(`SELECT * FROM subagent_events WHERE attempt_id = ? AND runtime_event_id = ?`)
        .get(input.attemptId, input.runtimeEventId) as EventRow | undefined
      if (existing) return eventFromRow(existing)
    }

    const row = this.db
      .prepare(`SELECT COALESCE(MAX(group_event_seq), 0) + 1 AS next_seq FROM subagent_events WHERE group_id = ?`)
      .get(input.groupId) as { next_seq: number }
    const event: SubagentEvent = {
      ...input,
      taskId: input.taskId ?? null,
      attemptId: input.attemptId ?? null,
      runtimeEventId: input.runtimeEventId ?? null,
      groupEventSeq: row.next_seq
    }
    this.db
      .prepare(
        `INSERT INTO subagent_events (
          id, group_id, task_id, attempt_id, kind, runtime_event_id, severity, payload_json,
          created_at, group_event_seq
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.groupId,
        event.taskId,
        event.attemptId,
        event.kind,
        event.runtimeEventId,
        event.severity,
        JSON.stringify(event.payload),
        event.createdAt,
        event.groupEventSeq
      )
    return event
  }

  updateTaskStatusWithEvent(
    taskId: string,
    status: SubagentTaskStatus,
    event: SubagentEventInput
  ): SubagentEvent {
    const transaction = this.db.transaction(() => {
      this.updateTask(taskId, { status })
      return this.appendEvent(event)
    })
    return transaction()
  }

  updateTask(taskId: string, patch: Partial<SubagentTask>): SubagentTask {
    const existing = this.requireTask(taskId)
    const now = this.now()
    const next: SubagentTask = {
      ...existing,
      ...patch,
      startedAt:
        patch.status === 'running' || patch.status === 'starting'
          ? (existing.startedAt ?? now)
          : (patch.startedAt ?? existing.startedAt),
      settledAt: this.isSettledTaskStatus(patch.status) ? (patch.settledAt ?? now) : patch.settledAt === null ? null : existing.settledAt,
      toolAllowlist: patch.toolAllowlist ? [...patch.toolAllowlist] : existing.toolAllowlist
    }
    this.db
      .prepare(
        `UPDATE subagent_tasks SET
          label = ?, instruction = ?, status = ?, depth = ?, workspace_mode = ?, cwd = ?,
          tool_allowlist_json = ?, retry_count = ?, current_attempt_id = ?, result_summary = ?,
          error = ?, started_at = ?, settled_at = ?
        WHERE id = ?`
      )
      .run(
        next.label ?? null,
        next.instruction,
        next.status,
        next.depth,
        next.workspaceMode,
        next.cwd,
        JSON.stringify(next.toolAllowlist),
        next.retryCount,
        next.currentAttemptId ?? null,
        next.resultSummary ?? null,
        next.error ?? null,
        next.startedAt ?? null,
        next.settledAt ?? null,
        taskId
      )
    return next
  }

  updateAttempt(attemptId: string, patch: Partial<SubagentAttempt>): SubagentAttempt {
    const existing = this.requireAttempt(attemptId)
    const now = this.now()
    const next: SubagentAttempt = {
      ...existing,
      ...patch,
      startedAt:
        patch.status === 'running' || patch.status === 'starting'
          ? (existing.startedAt ?? now)
          : (patch.startedAt ?? existing.startedAt),
      settledAt: this.isSettledAttemptStatus(patch.status) ? (patch.settledAt ?? now) : patch.settledAt === null ? null : existing.settledAt
    }
    this.db
      .prepare(
        `UPDATE subagent_attempts SET
          correlation_id = ?, status = ?, worker_session_id = ?, process_id = ?, result_json = ?,
          error = ?, started_at = ?, settled_at = ?, lease_expires_at = ?
        WHERE id = ?`
      )
      .run(
        next.correlationId ?? null,
        next.status,
        next.workerSessionId ?? null,
        next.processId ?? null,
        next.result ? JSON.stringify(next.result) : null,
        next.error ?? null,
        next.startedAt ?? null,
        next.settledAt ?? null,
        next.leaseExpiresAt ?? null,
        attemptId
      )
    return next
  }

  updateGroup(groupId: string, patch: Partial<SubagentTaskGroup>): SubagentTaskGroup {
    const existing = this.getGroup(groupId)
    if (!existing) throw new Error(`Unknown subagent group: ${groupId}`)
    const now = this.now()
    const next: SubagentTaskGroup = {
      ...existing,
      ...patch,
      startedAt: patch.status === 'running' ? (existing.startedAt ?? now) : (patch.startedAt ?? existing.startedAt),
      settledAt: this.isSettledGroupStatus(patch.status) ? (patch.settledAt ?? now) : patch.settledAt === null ? null : existing.settledAt
    }
    this.db
      .prepare(
        `UPDATE subagent_task_groups SET
          status = ?, wait_strategy = ?, started_at = ?, settled_at = ?
        WHERE id = ?`
      )
      .run(next.status, next.waitStrategy, next.startedAt ?? null, next.settledAt ?? null, groupId)
    return next
  }

  repairInFlightAfterStartup(input: StartupRepairInput): StartupRepairResult {
    const groups = this.db
      .prepare(`UPDATE subagent_task_groups SET status = 'interrupted', settled_at = COALESCE(settled_at, ?) WHERE status IN ('queued', 'running')`)
      .run(input.repairedAt).changes
    const tasks = this.db
      .prepare(`UPDATE subagent_tasks SET status = 'interrupted', error = ?, settled_at = COALESCE(settled_at, ?) WHERE status IN ('queued', 'starting', 'running', 'cancel_requested')`)
      .run(input.reason, input.repairedAt).changes
    const attempts = this.db
      .prepare(`UPDATE subagent_attempts SET status = 'worker_lost', error = ?, settled_at = COALESCE(settled_at, ?) WHERE status IN ('created', 'starting', 'running', 'cancel_requested')`)
      .run(input.reason, input.repairedAt).changes
    return { groups, tasks, attempts }
  }

  private requireTask(taskId: string): SubagentTask {
    const task = this.getTask(taskId)
    if (!task) throw new Error(`Unknown subagent task: ${taskId}`)
    return task
  }

  private requireAttempt(attemptId: string): SubagentAttempt {
    const attempt = this.getAttempt(attemptId)
    if (!attempt) throw new Error(`Unknown subagent attempt: ${attemptId}`)
    return attempt
  }

  private isSettledTaskStatus(status?: SubagentTaskStatus): boolean {
    return Boolean(status && ['completed', 'failed', 'blocked', 'timed_out', 'canceled', 'interrupted'].includes(status))
  }

  private isSettledAttemptStatus(status?: SubagentAttemptStatus): boolean {
    return Boolean(status && ['completed', 'failed', 'blocked', 'timed_out', 'canceled', 'worker_lost'].includes(status))
  }

  private isSettledGroupStatus(status?: SubagentTaskGroup['status']): boolean {
    return Boolean(status && ['completed', 'partial', 'failed', 'canceled', 'timed_out', 'interrupted'].includes(status))
  }
}

export const ensureSqliteSubagentSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subagent_task_groups (
      id TEXT PRIMARY KEY,
      parent_conversation_id TEXT NOT NULL,
      parent_run_id TEXT NOT NULL,
      parent_message_id TEXT,
      parent_tool_call_id TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      status TEXT NOT NULL,
      wait_strategy TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS subagent_tasks (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      parent_conversation_id TEXT NOT NULL,
      parent_run_id TEXT NOT NULL,
      label TEXT,
      instruction TEXT NOT NULL,
      status TEXT NOT NULL,
      depth INTEGER NOT NULL,
      workspace_mode TEXT NOT NULL,
      cwd TEXT NOT NULL,
      tool_allowlist_json TEXT NOT NULL,
      retry_count INTEGER NOT NULL,
      current_attempt_id TEXT,
      result_summary TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      settled_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_subagent_tasks_group
      ON subagent_tasks(group_id, created_at);

    CREATE TABLE IF NOT EXISTS subagent_attempts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      parent_run_id TEXT NOT NULL,
      correlation_id TEXT,
      attempt_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      worker_session_id TEXT,
      process_id INTEGER,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      settled_at TEXT,
      lease_expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_subagent_attempts_task
      ON subagent_attempts(task_id, attempt_number);

    CREATE TABLE IF NOT EXISTS subagent_events (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      task_id TEXT,
      attempt_id TEXT,
      kind TEXT NOT NULL,
      runtime_event_id TEXT,
      severity TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      group_event_seq INTEGER NOT NULL,
      UNIQUE(group_id, group_event_seq)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_subagent_events_runtime_dedupe
      ON subagent_events(attempt_id, runtime_event_id)
      WHERE attempt_id IS NOT NULL AND runtime_event_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_subagent_events_group_seq
      ON subagent_events(group_id, group_event_seq);
  `)
}

const groupFromRow = (row: GroupRow): SubagentTaskGroup => ({
  id: row.id,
  parentConversationId: row.parent_conversation_id,
  parentRunId: row.parent_run_id,
  parentMessageId: row.parent_message_id,
  parentToolCallId: row.parent_tool_call_id,
  idempotencyKey: row.idempotency_key,
  status: row.status,
  waitStrategy: row.wait_strategy,
  createdAt: row.created_at,
  startedAt: row.started_at,
  settledAt: row.settled_at
})

const taskFromRow = (row: TaskRow): SubagentTask => ({
  id: row.id,
  groupId: row.group_id,
  parentConversationId: row.parent_conversation_id,
  parentRunId: row.parent_run_id,
  label: row.label,
  instruction: row.instruction,
  status: row.status,
  depth: row.depth,
  workspaceMode: row.workspace_mode,
  cwd: row.cwd,
  toolAllowlist: parseJsonArray(row.tool_allowlist_json),
  retryCount: row.retry_count,
  currentAttemptId: row.current_attempt_id,
  resultSummary: row.result_summary,
  error: row.error,
  createdAt: row.created_at,
  startedAt: row.started_at,
  settledAt: row.settled_at
})

const attemptFromRow = (row: AttemptRow): SubagentAttempt => ({
  id: row.id,
  taskId: row.task_id,
  groupId: row.group_id,
  parentRunId: row.parent_run_id,
  correlationId: row.correlation_id,
  attemptNumber: row.attempt_number,
  status: row.status,
  workerSessionId: row.worker_session_id,
  processId: row.process_id,
  result: row.result_json ? JSON.parse(row.result_json) : null,
  error: row.error,
  createdAt: row.created_at,
  startedAt: row.started_at,
  settledAt: row.settled_at,
  leaseExpiresAt: row.lease_expires_at
})

const eventFromRow = (row: EventRow): SubagentEvent => ({
  id: row.id,
  groupId: row.group_id,
  taskId: row.task_id,
  attemptId: row.attempt_id,
  kind: row.kind,
  runtimeEventId: row.runtime_event_id,
  severity: row.severity,
  payload: JSON.parse(row.payload_json),
  createdAt: row.created_at,
  groupEventSeq: row.group_event_seq
})

const parseJsonArray = (text: string): string[] => {
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}
