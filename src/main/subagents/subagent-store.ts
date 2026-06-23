import type {
  SubagentAttempt,
  SubagentAttemptStatus,
  SubagentEvent,
  SubagentEventInput,
  SubagentTask,
  SubagentTaskGroup,
  SubagentTaskStatus
} from './subagent-types.ts'

export type InMemorySubagentStoreOptions = {
  now?: () => string
}

export type StartupRepairInput = {
  repairedAt: string
  reason: string
}

export type StartupRepairResult = {
  groups: number
  tasks: number
  attempts: number
}

export type SubagentStore = {
  createGroup(group: SubagentTaskGroup): SubagentTaskGroup
  createTask(task: SubagentTask): SubagentTask
  createAttempt(attempt: SubagentAttempt): SubagentAttempt
  getGroup(id: string): SubagentTaskGroup | null
  getTask(id: string): SubagentTask | null
  getAttempt(id: string): SubagentAttempt | null
  findGroupByIdempotencyKey(key: string): SubagentTaskGroup | null
  listTasksByGroup(groupId: string): SubagentTask[]
  listAttemptsByTask(taskId: string): SubagentAttempt[]
  listEventsByGroup(groupId: string): SubagentEvent[]
  appendEvent(input: SubagentEventInput): SubagentEvent
  updateTaskStatusWithEvent(taskId: string, status: SubagentTaskStatus, event: SubagentEventInput): SubagentEvent
  updateTask(taskId: string, patch: Partial<SubagentTask>): SubagentTask
  updateAttempt(attemptId: string, patch: Partial<SubagentAttempt>): SubagentAttempt
  updateGroup(groupId: string, patch: Partial<SubagentTaskGroup>): SubagentTaskGroup
  repairInFlightAfterStartup(input: StartupRepairInput): StartupRepairResult
}

export class InMemorySubagentStore implements SubagentStore {
  private readonly groups = new Map<string, SubagentTaskGroup>()
  private readonly tasks = new Map<string, SubagentTask>()
  private readonly attempts = new Map<string, SubagentAttempt>()
  private readonly eventsByGroup = new Map<string, SubagentEvent[]>()
  private readonly runtimeEventIndex = new Map<string, SubagentEvent>()
  private readonly groupSeq = new Map<string, number>()
  private readonly idempotencyIndex = new Map<string, string>()
  private readonly now: () => string

  constructor(options: InMemorySubagentStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
  }

  createGroup(group: SubagentTaskGroup): SubagentTaskGroup {
    const next = { ...group }
    this.groups.set(next.id, next)
    if (next.idempotencyKey) this.idempotencyIndex.set(next.idempotencyKey, next.id)
    return next
  }

  createTask(task: SubagentTask): SubagentTask {
    const next = { ...task, toolAllowlist: [...task.toolAllowlist] }
    this.tasks.set(next.id, next)
    return next
  }

  createAttempt(attempt: SubagentAttempt): SubagentAttempt {
    const next = { ...attempt }
    this.attempts.set(next.id, next)
    const task = this.requireTask(next.taskId)
    this.tasks.set(task.id, { ...task, currentAttemptId: next.id })
    return next
  }

  getGroup(id: string): SubagentTaskGroup | null {
    return this.groups.get(id) ?? null
  }

  getTask(id: string): SubagentTask | null {
    return this.tasks.get(id) ?? null
  }

  getAttempt(id: string): SubagentAttempt | null {
    return this.attempts.get(id) ?? null
  }

  findGroupByIdempotencyKey(key: string): SubagentTaskGroup | null {
    const groupId = this.idempotencyIndex.get(key)
    return groupId ? (this.getGroup(groupId) ?? null) : null
  }

  listTasksByGroup(groupId: string): SubagentTask[] {
    return [...this.tasks.values()].filter((task) => task.groupId === groupId)
  }

  listAttemptsByTask(taskId: string): SubagentAttempt[] {
    return [...this.attempts.values()].filter((attempt) => attempt.taskId === taskId)
  }

  listEventsByGroup(groupId: string): SubagentEvent[] {
    return [...(this.eventsByGroup.get(groupId) ?? [])]
  }

  appendEvent(input: SubagentEventInput): SubagentEvent {
    if (input.runtimeEventId && input.attemptId) {
      const key = `${input.attemptId}:${input.runtimeEventId}`
      const existing = this.runtimeEventIndex.get(key)
      if (existing) return existing
    }

    const nextSeq = (this.groupSeq.get(input.groupId) ?? 0) + 1
    this.groupSeq.set(input.groupId, nextSeq)
    const event: SubagentEvent = {
      ...input,
      taskId: input.taskId ?? null,
      attemptId: input.attemptId ?? null,
      runtimeEventId: input.runtimeEventId ?? null,
      groupEventSeq: nextSeq
    }
    const groupEvents = this.eventsByGroup.get(input.groupId) ?? []
    groupEvents.push(event)
    this.eventsByGroup.set(input.groupId, groupEvents)

    if (input.runtimeEventId && input.attemptId) {
      this.runtimeEventIndex.set(`${input.attemptId}:${input.runtimeEventId}`, event)
    }
    return event
  }

  updateTaskStatusWithEvent(
    taskId: string,
    status: SubagentTaskStatus,
    event: SubagentEventInput
  ): SubagentEvent {
    this.updateTask(taskId, { status })
    return this.appendEvent(event)
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
      settledAt: this.isSettledTaskStatus(patch.status) ? (patch.settledAt ?? now) : existing.settledAt,
      toolAllowlist: patch.toolAllowlist ? [...patch.toolAllowlist] : existing.toolAllowlist
    }
    this.tasks.set(taskId, next)
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
      settledAt: this.isSettledAttemptStatus(patch.status)
        ? (patch.settledAt ?? now)
        : existing.settledAt
    }
    this.attempts.set(attemptId, next)
    return next
  }

  updateGroup(groupId: string, patch: Partial<SubagentTaskGroup>): SubagentTaskGroup {
    const existing = this.groups.get(groupId)
    if (!existing) throw new Error(`Unknown subagent group: ${groupId}`)
    const now = this.now()
    const next: SubagentTaskGroup = {
      ...existing,
      ...patch,
      startedAt: patch.status === 'running' ? (existing.startedAt ?? now) : (patch.startedAt ?? existing.startedAt),
      settledAt: this.isSettledGroupStatus(patch.status)
        ? (patch.settledAt ?? now)
        : existing.settledAt
    }
    this.groups.set(groupId, next)
    return next
  }

  repairInFlightAfterStartup(input: StartupRepairInput): StartupRepairResult {
    let groups = 0
    let tasks = 0
    let attempts = 0

    for (const [groupId, group] of this.groups) {
      if (!this.isInFlightGroupStatus(group.status)) continue
      this.groups.set(groupId, {
        ...group,
        status: 'interrupted',
        settledAt: group.settledAt ?? input.repairedAt
      })
      groups += 1
    }

    for (const [taskId, task] of this.tasks) {
      if (!this.isInFlightTaskStatus(task.status)) continue
      this.tasks.set(taskId, {
        ...task,
        status: 'interrupted',
        error: input.reason,
        settledAt: task.settledAt ?? input.repairedAt
      })
      tasks += 1
    }

    for (const [attemptId, attempt] of this.attempts) {
      if (!this.isInFlightAttemptStatus(attempt.status)) continue
      this.attempts.set(attemptId, {
        ...attempt,
        status: 'worker_lost',
        error: input.reason,
        settledAt: attempt.settledAt ?? input.repairedAt
      })
      attempts += 1
    }

    return { groups, tasks, attempts }
  }

  private requireTask(taskId: string): SubagentTask {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Unknown subagent task: ${taskId}`)
    return task
  }

  private requireAttempt(attemptId: string): SubagentAttempt {
    const attempt = this.attempts.get(attemptId)
    if (!attempt) throw new Error(`Unknown subagent attempt: ${attemptId}`)
    return attempt
  }

  private isSettledTaskStatus(status?: SubagentTaskStatus): boolean {
    return Boolean(
      status &&
        ['completed', 'failed', 'blocked', 'timed_out', 'canceled', 'interrupted'].includes(status)
    )
  }

  private isSettledAttemptStatus(status?: SubagentAttemptStatus): boolean {
    return Boolean(
      status &&
        ['completed', 'failed', 'blocked', 'timed_out', 'canceled', 'worker_lost'].includes(status)
    )
  }

  private isSettledGroupStatus(status?: SubagentTaskGroup['status']): boolean {
    return Boolean(
      status && ['completed', 'partial', 'failed', 'canceled', 'timed_out', 'interrupted'].includes(status)
    )
  }

  private isInFlightGroupStatus(status: SubagentTaskGroup['status']): boolean {
    return status === 'queued' || status === 'running'
  }

  private isInFlightTaskStatus(status: SubagentTaskStatus): boolean {
    return status === 'queued' || status === 'starting' || status === 'running' || status === 'cancel_requested'
  }

  private isInFlightAttemptStatus(status: SubagentAttemptStatus): boolean {
    return status === 'created' || status === 'starting' || status === 'running' || status === 'cancel_requested'
  }
}
