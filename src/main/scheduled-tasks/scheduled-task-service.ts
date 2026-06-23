import type Database from 'better-sqlite3'
import { generateId } from '../../shared/id.ts'
import type { ConversationExecutionOverride } from '../core-v2/domain.ts'
import { getCoreV2Db, getCoreV2Service } from '../core-v2/sqlite-db.ts'
import { normalizeCoreTimestamp, parseCoreTimestampMs } from '../core-v2/time.ts'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskDeliveryPolicy,
  ScheduledTaskRetryPolicy,
  ScheduledTaskRun,
  ScheduledTaskRunStatus,
  ScheduledTaskStatus,
  ScheduledTaskTimeoutPolicy,
  ScheduledTaskValidationResult,
  UpdateScheduledTaskInput
} from '../../shared/scheduled-tasks.ts'
import {
  computeScheduledTaskNextRunAt,
  getScheduleDisplay,
  parseScheduledTaskSchedule,
  validateScheduledTaskSchedule
} from './schedule-parser.ts'

type ScheduledTaskRow = {
  id: string
  task_type: ScheduledTask['taskType']
  name: string
  description: string | null
  status: ScheduledTaskStatus
  enabled: number
  schedule_kind: ScheduledTask['scheduleKind']
  schedule_json: string
  schedule_display: string
  timezone: string
  next_run_at: string | null
  execution_mode: ScheduledTask['executionMode']
  target_conversation_id: string | null
  target_thread_id: string | null
  workspace_path: string | null
  prompt: string
  trigger_execution_override_json: string | null
  delivery_policy_json: string
  concurrency_policy: ScheduledTask['concurrencyPolicy']
  misfire_policy: ScheduledTask['misfirePolicy']
  retry_policy_json: string
  timeout_policy_json: string
  lease_owner: string | null
  lease_until: string | null
  last_run_id: string | null
  last_run_at: string | null
  last_run_status: ScheduledTaskRunStatus | null
  last_error_text: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

type ScheduledTaskRunRow = {
  id: string
  task_id: string
  status: ScheduledTaskRunStatus
  scheduled_for: string
  started_at: string | null
  ended_at: string | null
  attempt: number
  agent_run_id: string | null
  conversation_id: string | null
  thread_id: string | null
  lease_owner: string | null
  error_text: string | null
  result_summary: string | null
  delivery_status: string | null
  delivery_error_text: string | null
  created_at: string
  updated_at: string
}

type DueClaim = {
  task: ScheduledTask
  taskRun: ScheduledTaskRun
}

const DEFAULT_DELIVERY_POLICY: ScheduledTaskDeliveryPolicy = {
  mode: 'thread_only',
  suppressOnSilent: true,
  notifyOnFailure: true,
  target: null
}

const DEFAULT_RETRY_POLICY: ScheduledTaskRetryPolicy = {
  maxAttempts: 1,
  baseDelayMs: 60_000,
  maxDelayMs: 900_000,
  backoff: 'fixed'
}

const DEFAULT_TIMEOUT_POLICY: ScheduledTaskTimeoutPolicy = {
  wallClockMs: 30 * 60_000,
  inactivityMs: null
}

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value) as T
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

const asBool = (value: number): boolean => value === 1

const toTask = (row: ScheduledTaskRow): ScheduledTask => ({
  id: row.id,
  taskType: row.task_type,
  name: row.name,
  description: row.description,
  status: row.status,
  enabled: asBool(row.enabled),
  scheduleKind: row.schedule_kind,
  schedule: parseJson(row.schedule_json, { kind: row.schedule_kind } as ScheduledTask['schedule']),
  scheduleDisplay: row.schedule_display,
  timezone: row.timezone,
  nextRunAt: row.next_run_at,
  executionMode: row.execution_mode,
  targetConversationId: row.target_conversation_id,
  targetThreadId: row.target_thread_id,
  workspacePath: row.workspace_path,
  prompt: row.prompt,
  triggerExecutionOverride: parseJson<ConversationExecutionOverride | null>(
    row.trigger_execution_override_json,
    null
  ),
  deliveryPolicy: parseJson(row.delivery_policy_json, DEFAULT_DELIVERY_POLICY),
  concurrencyPolicy: row.concurrency_policy,
  misfirePolicy: row.misfire_policy,
  retryPolicy: parseJson(row.retry_policy_json, DEFAULT_RETRY_POLICY),
  timeoutPolicy: parseJson(row.timeout_policy_json, DEFAULT_TIMEOUT_POLICY),
  leaseOwner: row.lease_owner,
  leaseUntil: row.lease_until,
  lastRunId: row.last_run_id,
  lastRunAt: row.last_run_at,
  lastRunStatus: row.last_run_status,
  lastErrorText: row.last_error_text,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at
})

const toTaskRun = (row: ScheduledTaskRunRow): ScheduledTaskRun => ({
  id: row.id,
  taskId: row.task_id,
  status: row.status,
  scheduledFor: row.scheduled_for,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  attempt: row.attempt,
  agentRunId: row.agent_run_id,
  conversationId: row.conversation_id,
  threadId: row.thread_id,
  leaseOwner: row.lease_owner,
  errorText: row.error_text,
  resultSummary: row.result_summary,
  deliveryStatus: row.delivery_status,
  deliveryErrorText: row.delivery_error_text,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

export class ScheduledTaskService {
  private readonly db: Database.Database

  constructor(db: Database.Database = getCoreV2Db()) {
    this.db = db
  }

  /**
   * Resolve triggerExecutionOverride from modelProviderId/modelId fields:
   * - If modelProviderId is explicitly provided (even empty string), use it
   *   (empty = clear override, value = build override from it)
   * - If not provided, fall back to triggerExecutionOverride field
   */
  private resolveTriggerExecutionOverride(
    input: CreateScheduledTaskInput | UpdateScheduledTaskInput
  ): ConversationExecutionOverride | null {
    if ('modelProviderId' in input) {
      const providerId = String(input.modelProviderId ?? '').trim()
      const modelId = String(input.modelId ?? '').trim()
      if (providerId && modelId) {
        return {
          model: { providerId, modelId },
          ...(input.triggerExecutionOverride ?? {})
        }
      }
      return null
    }
    return input.triggerExecutionOverride ?? null
  }

  validate(
    input: CreateScheduledTaskInput | UpdateScheduledTaskInput
  ): ScheduledTaskValidationResult {
    const name = String(input.name ?? '').trim()
    if (!name) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        message: 'name is required',
        fieldErrors: [{ path: 'payload.name', message: 'Required' }]
      }
    }

    const prompt = String(input.prompt ?? '').trim()
    if (!prompt) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        message: 'prompt is required',
        fieldErrors: [{ path: 'payload.prompt', message: 'Required' }]
      }
    }

    const scheduleInput = input.schedule
    if (!scheduleInput) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        message: 'schedule is required',
        fieldErrors: [{ path: 'payload.schedule', message: 'Required' }]
      }
    }

    const scheduleValidation = validateScheduledTaskSchedule(scheduleInput)
    if (scheduleValidation) return scheduleValidation
    const schedule = parseScheduledTaskSchedule(scheduleInput)
    const scheduleDisplay = getScheduleDisplay(schedule)
    const timezone = String(input.timezone ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE
    const nextRunAt = computeScheduledTaskNextRunAt(schedule, new Date())
    const status = 'status' in input && input.status ? input.status : 'scheduled'
    const enabled = 'enabled' in input && typeof input.enabled === 'boolean' ? input.enabled : true

    return {
      ok: true,
      task: {
        taskType: input.taskType ?? 'scheduled_task',
        name,
        description: input.description?.trim() || null,
        status,
        enabled,
        scheduleKind: schedule.kind,
        schedule,
        scheduleDisplay,
        timezone,
        nextRunAt,
        executionMode: input.executionMode ?? 'main_thread',
        targetConversationId: input.targetConversationId?.trim() || null,
        targetThreadId: input.targetThreadId?.trim() || null,
        workspacePath: input.workspacePath?.trim() || null,
        prompt,
        triggerExecutionOverride: this.resolveTriggerExecutionOverride(input),
        deliveryPolicy: {
          ...DEFAULT_DELIVERY_POLICY,
          ...(input.deliveryPolicy ?? {}),
          target: input.deliveryPolicy?.target ?? null
        },
        concurrencyPolicy: input.concurrencyPolicy ?? 'forbid',
        misfirePolicy: input.misfirePolicy ?? 'skip',
        retryPolicy: {
          ...DEFAULT_RETRY_POLICY,
          ...(input.retryPolicy ?? {})
        },
        timeoutPolicy: {
          ...DEFAULT_TIMEOUT_POLICY,
          ...(input.timeoutPolicy ?? {})
        }
      }
    }
  }

  createTask(input: CreateScheduledTaskInput): ScheduledTask {
    const validation = this.validate(input)
    if (!validation.ok) throw new Error(validation.message)
    const task = validation.task
    const id = generateId()
    const now = normalizeCoreTimestamp()

    this.db
      .prepare(
        `
          INSERT INTO scheduled_tasks (
            id, task_type, name, description, status, enabled, schedule_kind, schedule_json, schedule_display,
            timezone, next_run_at, execution_mode, target_conversation_id, target_thread_id, workspace_path,
            prompt, trigger_execution_override_json, delivery_policy_json, concurrency_policy, misfire_policy,
            retry_policy_json, timeout_policy_json, lease_owner, lease_until, last_run_id, last_run_at,
            last_run_status, last_error_text, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL)
        `
      )
      .run(
        id,
        task.taskType,
        task.name,
        task.description,
        task.status,
        task.enabled ? 1 : 0,
        task.scheduleKind,
        JSON.stringify(task.schedule),
        task.scheduleDisplay,
        task.timezone,
        task.nextRunAt,
        task.executionMode,
        task.targetConversationId,
        task.targetThreadId,
        task.workspacePath,
        task.prompt,
        JSON.stringify(task.triggerExecutionOverride),
        JSON.stringify(task.deliveryPolicy),
        task.concurrencyPolicy,
        task.misfirePolicy,
        JSON.stringify(task.retryPolicy),
        JSON.stringify(task.timeoutPolicy),
        now,
        now
      )

    return this.getTask(id) as ScheduledTask
  }

  getTask(id: string): ScheduledTask | null {
    const row = this.db
      .prepare(`SELECT * FROM scheduled_tasks WHERE id = ? AND deleted_at IS NULL`)
      .get(id) as ScheduledTaskRow | undefined
    return row ? toTask(row) : null
  }

  listTasks(options?: { includeDisabled?: boolean }): ScheduledTask[] {
    const includeDisabled = Boolean(options?.includeDisabled)
    const rows = this.db
      .prepare(
        `SELECT * FROM scheduled_tasks WHERE deleted_at IS NULL ${includeDisabled ? '' : 'AND enabled = 1'} ORDER BY created_at DESC`
      )
      .all() as ScheduledTaskRow[]
    return rows.map(toTask)
  }

  updateTask(input: UpdateScheduledTaskInput): ScheduledTask {
    const existing = this.getTask(input.id)
    if (!existing) throw new Error(`Unknown scheduled task: ${input.id}`)
    const merged: UpdateScheduledTaskInput = {
      ...existing,
      ...input,
      id: existing.id,
      taskType: input.taskType ?? existing.taskType,
      name: input.name ?? existing.name,
      prompt: input.prompt ?? existing.prompt,
      schedule: input.schedule ?? existing.schedule,
      description: input.description === undefined ? existing.description : input.description
    }
    const validation = this.validate(merged)
    if (!validation.ok) throw new Error(validation.message)
    const task = validation.task
    const now = normalizeCoreTimestamp()
    this.db
      .prepare(
        `
          UPDATE scheduled_tasks SET
            task_type = ?, name = ?, description = ?, status = ?, enabled = ?, schedule_kind = ?, schedule_json = ?,
            schedule_display = ?, timezone = ?, next_run_at = ?, execution_mode = ?, target_conversation_id = ?,
            target_thread_id = ?, workspace_path = ?, prompt = ?, trigger_execution_override_json = ?,
            delivery_policy_json = ?, concurrency_policy = ?, misfire_policy = ?, retry_policy_json = ?,
            timeout_policy_json = ?, updated_at = ?, deleted_at = ?
          WHERE id = ?
        `
      )
      .run(
        task.taskType,
        task.name,
        task.description,
        task.status,
        task.enabled ? 1 : 0,
        task.scheduleKind,
        JSON.stringify(task.schedule),
        task.scheduleDisplay,
        task.timezone,
        task.nextRunAt,
        task.executionMode,
        task.targetConversationId,
        task.targetThreadId,
        task.workspacePath,
        task.prompt,
        JSON.stringify(task.triggerExecutionOverride),
        JSON.stringify(task.deliveryPolicy),
        task.concurrencyPolicy,
        task.misfirePolicy,
        JSON.stringify(task.retryPolicy),
        JSON.stringify(task.timeoutPolicy),
        now,
        input.status === 'deleted' ? now : null,
        input.id
      )
    return this.getTask(input.id) as ScheduledTask
  }

  pauseTask(id: string): ScheduledTask {
    return this.updateTask({ id, status: 'paused', enabled: false })
  }

  resumeTask(id: string): ScheduledTask {
    const task = this.getTask(id)
    if (!task) throw new Error(`Unknown scheduled task: ${id}`)
    const nextRunAt = computeScheduledTaskNextRunAt(task.schedule, new Date())
    this.db
      .prepare(
        `UPDATE scheduled_tasks SET status = 'scheduled', enabled = 1, next_run_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(nextRunAt, normalizeCoreTimestamp(), id)
    return this.getTask(id) as ScheduledTask
  }

  deleteTask(id: string): { success: true } {
    this.db
      .prepare(
        `UPDATE scheduled_tasks SET status = 'deleted', enabled = 0, deleted_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(normalizeCoreTimestamp(), normalizeCoreTimestamp(), id)
    return { success: true }
  }

  triggerTaskNow(id: string): ScheduledTask {
    this.db
      .prepare(
        `UPDATE scheduled_tasks SET enabled = 1, status = 'scheduled', next_run_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(normalizeCoreTimestamp(), normalizeCoreTimestamp(), id)
    return this.getTask(id) as ScheduledTask
  }

  listRuns(taskId: string, limit = 20): ScheduledTaskRun[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(taskId, Math.max(1, Math.trunc(limit))) as ScheduledTaskRunRow[]
    return rows.map(toTaskRun)
  }

  recoverInterruptedRuns(ownerPrefix?: string): number {
    const now = normalizeCoreTimestamp()
    const rows = this.db
      .prepare(`SELECT * FROM scheduled_task_runs WHERE status IN ('claimed', 'queued', 'running')`)
      .all() as ScheduledTaskRunRow[]
    let recovered = 0
    for (const row of rows) {
      if (ownerPrefix && row.lease_owner && !row.lease_owner.startsWith(ownerPrefix)) continue
      this.completeRun({
        runId: row.id,
        status: 'failed',
        errorText: 'Scheduled task run interrupted before completion',
        endedAt: now
      })
      recovered += 1
    }
    return recovered
  }

  claimDueTasks(input: {
    owner: string
    leaseMs?: number
    limit?: number
    now?: string | Date
  }): DueClaim[] {
    const owner = String(input.owner ?? '').trim()
    if (!owner) return []
    const leaseMs = Math.max(5_000, Math.trunc(input.leaseMs ?? 120_000))
    const limit = Math.max(1, Math.trunc(input.limit ?? 10))
    const nowIso = normalizeCoreTimestamp(input.now ?? undefined)
    const nowMs = parseCoreTimestampMs(nowIso)
    const leaseUntil = normalizeCoreTimestamp(new Date(nowMs + leaseMs))
    const tx = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `
            SELECT * FROM scheduled_tasks
            WHERE deleted_at IS NULL
              AND enabled = 1
              AND status = 'scheduled'
              AND next_run_at IS NOT NULL
              AND next_run_at <= ?
              AND (lease_until IS NULL OR lease_until < ?)
            ORDER BY next_run_at ASC, created_at ASC
            LIMIT ?
          `
        )
        .all(nowIso, nowIso, limit) as ScheduledTaskRow[]

      const claims: DueClaim[] = []
      for (const row of rows) {
        const task = toTask(row)
        const activeCount = this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM scheduled_task_runs WHERE task_id = ? AND status IN ('claimed', 'queued', 'running')`
          )
          .get(task.id) as { count: number }

        if (task.concurrencyPolicy === 'forbid' && activeCount.count > 0) {
          const skippedRunId = generateId()
          this.db
            .prepare(
              `
                INSERT INTO scheduled_task_runs (
                  id, task_id, status, scheduled_for, started_at, ended_at, attempt, agent_run_id, conversation_id, thread_id,
                  lease_owner, error_text, result_summary, delivery_status, delivery_error_text, created_at, updated_at
                ) VALUES (?, ?, 'skipped', ?, NULL, ?, 1, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
              `
            )
            .run(
              skippedRunId,
              task.id,
              task.nextRunAt,
              nowIso,
              task.targetConversationId,
              task.targetThreadId,
              owner,
              'Skipped because a previous run is still active',
              'concurrency_forbid',
              nowIso,
              nowIso
            )
          const nextRunAt = this.computeNextRunAfter(task, row.next_run_at)
          this.db
            .prepare(
              `UPDATE scheduled_tasks SET next_run_at = ?, last_run_id = ?, last_run_at = ?, last_run_status = 'skipped', last_error_text = ?, updated_at = ? WHERE id = ?`
            )
            .run(
              nextRunAt,
              skippedRunId,
              nowIso,
              'Skipped because a previous run is still active',
              nowIso,
              task.id
            )
          continue
        }

        const taskRunId = generateId()
        const scheduledFor = row.next_run_at ?? nowIso
        const taskRunCreatedAt = normalizeCoreTimestamp()
        this.db
          .prepare(
            `
              INSERT INTO scheduled_task_runs (
                id, task_id, status, scheduled_for, started_at, ended_at, attempt, agent_run_id, conversation_id, thread_id,
                lease_owner, error_text, result_summary, delivery_status, delivery_error_text, created_at, updated_at
              ) VALUES (?, ?, 'claimed', ?, NULL, NULL, 1, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
            `
          )
          .run(
            taskRunId,
            task.id,
            scheduledFor,
            task.targetConversationId,
            task.targetThreadId,
            owner,
            taskRunCreatedAt,
            taskRunCreatedAt
          )

        const nextRunAt = this.computeNextRunAfter(task, scheduledFor)
        const nextStatus =
          task.schedule.kind === 'at' && nextRunAt == null ? 'completed' : task.status
        const nextEnabled = task.schedule.kind === 'at' && nextRunAt == null ? 0 : 1
        this.db
          .prepare(
            `
              UPDATE scheduled_tasks SET
                lease_owner = ?, lease_until = ?, last_run_id = ?, updated_at = ?, next_run_at = ?, status = ?, enabled = ?
              WHERE id = ?
            `
          )
          .run(owner, leaseUntil, taskRunId, nowIso, nextRunAt, nextStatus, nextEnabled, task.id)

        claims.push({
          task: this.getTask(task.id) as ScheduledTask,
          taskRun: this.getRun(taskRunId) as ScheduledTaskRun
        })
      }

      return claims
    })

    return tx()
  }

  markRunQueued(input: {
    runId: string
    agentRunId: string
    conversationId?: string | null
    threadId?: string | null
  }): ScheduledTaskRun {
    this.db
      .prepare(
        `UPDATE scheduled_task_runs SET status = 'queued', agent_run_id = ?, conversation_id = COALESCE(?, conversation_id), thread_id = COALESCE(?, thread_id), updated_at = ? WHERE id = ?`
      )
      .run(
        input.agentRunId,
        input.conversationId ?? null,
        input.threadId ?? null,
        normalizeCoreTimestamp(),
        input.runId
      )
    return this.getRun(input.runId) as ScheduledTaskRun
  }

  markAgentRunStarted(agentRunId: string): void {
    const row = this.db
      .prepare(
        `SELECT * FROM scheduled_task_runs WHERE agent_run_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(agentRunId) as ScheduledTaskRunRow | undefined
    if (!row) return
    const now = normalizeCoreTimestamp()
    this.db
      .prepare(
        `UPDATE scheduled_task_runs SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?`
      )
      .run(now, now, row.id)
    this.db
      .prepare(`UPDATE scheduled_tasks SET status = 'running', updated_at = ? WHERE id = ?`)
      .run(now, row.task_id)
  }

  markAgentRunFinished(input: {
    agentRunId: string
    status: Extract<ScheduledTaskRunStatus, 'succeeded' | 'failed' | 'timed_out' | 'cancelled'>
    resultSummary?: string | null
    errorText?: string | null
    endedAt?: string | number | Date | null
  }): void {
    const row = this.db
      .prepare(
        `SELECT * FROM scheduled_task_runs WHERE agent_run_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(input.agentRunId) as ScheduledTaskRunRow | undefined
    if (!row) return
    this.completeRun({
      runId: row.id,
      status: input.status,
      resultSummary: input.resultSummary ?? null,
      errorText: input.errorText ?? null,
      endedAt: input.endedAt ?? null
    })
  }

  completeRun(input: {
    runId: string
    status: Extract<
      ScheduledTaskRunStatus,
      'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'skipped'
    >
    resultSummary?: string | null
    errorText?: string | null
    endedAt?: string | number | Date | null
  }): ScheduledTaskRun | null {
    const existing = this.getRun(input.runId)
    if (!existing) return null
    const endedAt = normalizeCoreTimestamp(input.endedAt ?? undefined)
    const updatedAt = normalizeCoreTimestamp()
    this.db
      .prepare(
        `
          UPDATE scheduled_task_runs
          SET status = ?, ended_at = ?, error_text = ?, result_summary = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        input.status,
        endedAt,
        input.errorText ?? null,
        input.resultSummary ?? null,
        updatedAt,
        input.runId
      )
    this.db
      .prepare(
        `
          UPDATE scheduled_tasks
          SET lease_owner = NULL, lease_until = NULL, last_run_at = ?, last_run_status = ?, last_error_text = ?, status = CASE WHEN enabled = 1 THEN 'scheduled' ELSE status END, updated_at = ?
          WHERE id = ?
        `
      )
      .run(endedAt, input.status, input.errorText ?? null, updatedAt, existing.taskId)
    return this.getRun(input.runId)
  }

  getRun(id: string): ScheduledTaskRun | null {
    const row = this.db.prepare(`SELECT * FROM scheduled_task_runs WHERE id = ?`).get(id) as
      | ScheduledTaskRunRow
      | undefined
    return row ? toTaskRun(row) : null
  }

  getRunByAgentRunId(agentRunId: string): ScheduledTaskRun | null {
    const row = this.db
      .prepare(
        `SELECT * FROM scheduled_task_runs WHERE agent_run_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(agentRunId) as ScheduledTaskRunRow | undefined
    return row ? toTaskRun(row) : null
  }

  getTaskByAgentRunId(agentRunId: string): ScheduledTask | null {
    const run = this.getRunByAgentRunId(agentRunId)
    if (!run) return null
    return this.getTask(run.taskId)
  }

  private computeNextRunAfter(
    task: ScheduledTask,
    currentScheduledFor: string | null
  ): string | null {
    if (!currentScheduledFor) return computeScheduledTaskNextRunAt(task.schedule, new Date())
    return computeScheduledTaskNextRunAt(
      task.schedule,
      new Date(parseCoreTimestampMs(currentScheduledFor))
    )
  }
}

let scheduledTaskServiceSingleton: ScheduledTaskService | null = null

export const getScheduledTaskService = (): ScheduledTaskService => {
  if (scheduledTaskServiceSingleton) return scheduledTaskServiceSingleton
  scheduledTaskServiceSingleton = new ScheduledTaskService(getCoreV2Db())
  return scheduledTaskServiceSingleton
}

export const getScheduledTaskCoreService = () => getCoreV2Service()
