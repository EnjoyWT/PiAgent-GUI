import type { SubagentStore } from './subagent-store.ts'
import { SubagentScheduler } from './subagent-scheduler.ts'
import { SupervisorReporter, type SupervisorGroupReport } from './supervisor-reporter.ts'
import {
  defaultSubagentIdFactory,
  type CancelWorkerGroupInput,
  type CancelWorkerGroupResult,
  type CancelWorkerInput,
  type CancelWorkerResult,
  type CollectWorkerResultsInput,
  type CollectWorkerResultsResult,
  type DelegateWorkersInput,
  type DelegateWorkersResult,
  type IdFactory,
  type RetryWorkerInput,
  type RetryWorkerResult,
  type StartWorkerAttemptInput,
  type SubagentAttempt,
  type SubagentTask,
  type WaitForGroupInput,
  type WaitForGroupResult,
  type WorkerHostClient,
  type WorkerHostEvent,
  type WorkerResultEnvelope,
  type WorkerWorkspacePolicy
} from './subagent-types.ts'

export type SubagentTaskManagerOptions = {
  store: SubagentStore
  scheduler: SubagentScheduler
  workerHost: WorkerHostClient
  now?: () => string
  idFactory?: IdFactory
  onGroupChanged?: (groupId: string) => void | Promise<void>
}

export class SubagentTaskManager {
  private readonly store: SubagentStore
  private readonly scheduler: SubagentScheduler
  private readonly workerHost: WorkerHostClient
  private readonly now: () => string
  private readonly idFactory: IdFactory
  private readonly onGroupChanged?: (groupId: string) => void | Promise<void>
  private readonly usedIds = new Set<string>()
  private readonly inputsByGroup = new Map<string, DelegateWorkersInput>()

  constructor(options: SubagentTaskManagerOptions) {
    this.store = options.store
    this.scheduler = options.scheduler
    this.workerHost = options.workerHost
    this.now = options.now ?? (() => new Date().toISOString())
    this.idFactory = options.idFactory ?? defaultSubagentIdFactory
    this.onGroupChanged = options.onGroupChanged
  }

  async delegateWorkers(input: DelegateWorkersInput): Promise<DelegateWorkersResult> {
    if (input.tasks.length === 0) throw new Error('delegateWorkers requires at least one task')
    const idempotencyKey = this.getIdempotencyKey(input)
    const existing = this.store.findGroupByIdempotencyKey(idempotencyKey)
    if (existing) return this.toDelegateResult(existing.id)

    const groupId = this.nextId('group')
    const createdAt = this.now()
    this.store.createGroup({
      id: groupId,
      parentConversationId: input.parentConversationId,
      parentRunId: input.parentRunId,
      parentMessageId: input.parentMessageId ?? null,
      parentToolCallId: input.parentToolCallId,
      idempotencyKey,
      status: 'queued',
      waitStrategy: input.waitStrategy ?? 'all_settled',
      createdAt
    })
    this.inputsByGroup.set(groupId, cloneDelegateWorkersInput(input))
    this.store.appendEvent({
      id: this.nextId('event'),
      groupId,
      kind: 'group_created',
      severity: 'info',
      payload: { taskCount: input.tasks.length },
      createdAt
    })

    for (const taskInput of input.tasks) {
      const taskId = this.nextId('task')
      this.store.createTask({
        id: taskId,
        groupId,
        parentConversationId: input.parentConversationId,
        parentRunId: input.parentRunId,
        label: taskInput.label ?? null,
        instruction: taskInput.instruction,
        status: 'queued',
        depth: 0,
        workspaceMode: taskInput.workspaceMode,
        cwd: input.cwd,
        toolAllowlist: [...taskInput.toolAllowlist],
        retryCount: 0,
        createdAt
      })
      this.store.appendEvent({
        id: this.nextId('event'),
        groupId,
        taskId,
        kind: 'task_queued',
        severity: 'info',
        payload: { label: taskInput.label ?? null },
        createdAt
      })
    }

    await this.startQueuedTasks(groupId, input)
    await this.notifyGroupChanged(groupId)
    return this.toDelegateResult(groupId)
  }

  async waitForGroup(input: WaitForGroupInput): Promise<WaitForGroupResult> {
    const group = this.store.getGroup(input.groupId)
    if (!group) throw new Error(`Unknown subagent group: ${input.groupId}`)
    if (this.isSettledGroup(group.status)) {
      return {
        waitStatus: group.status === 'failed' ? 'failed' : group.status === 'canceled' ? 'canceled' : 'settled',
        groupStatus: group.status,
        completedResults: this.getCompletedResults(group.id)
      }
    }
    if (input.timeoutMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.timeoutMs))
    }
    const after = this.store.getGroup(input.groupId)
    if (!after) throw new Error(`Unknown subagent group: ${input.groupId}`)
    return {
      waitStatus: this.isSettledGroup(after.status)
        ? after.status === 'failed'
          ? 'failed'
          : after.status === 'canceled'
            ? 'canceled'
            : 'settled'
        : 'timeout',
      groupStatus: after.status,
      completedResults: this.getCompletedResults(after.id)
    }
  }

  buildSupervisorReport(input: { groupId: string; afterEventSeq?: number }): SupervisorGroupReport {
    return new SupervisorReporter({ store: this.store }).buildGroupReport(input)
  }

  collectWorkerResults(input: CollectWorkerResultsInput): CollectWorkerResultsResult {
    const group = this.store.getGroup(input.groupId)
    if (!group) throw new Error(`Unknown subagent group: ${input.groupId}`)
    return {
      groupId: group.id,
      groupStatus: group.status,
      completedResults: this.getCompletedResults(group.id)
    }
  }

  async retryWorker(input: RetryWorkerInput): Promise<RetryWorkerResult> {
    const task = this.store.getTask(input.taskId)
    if (!task) throw new Error(`Unknown subagent task: ${input.taskId}`)
    if (!this.isRetryableTaskStatus(task.status)) {
      throw new Error(`Cannot retry subagent task ${input.taskId} with status ${task.status}`)
    }
    const delegateInput = this.inputsByGroup.get(task.groupId)
    if (!delegateInput) throw new Error(`Cannot retry subagent task ${input.taskId}; original input is unavailable`)

    const nextRetryCount = task.retryCount + 1
    this.store.updateTask(task.id, {
      status: 'queued',
      retryCount: nextRetryCount,
      error: null,
      resultSummary: null,
      settledAt: null
    })
    this.store.updateGroup(task.groupId, { status: 'running', settledAt: null })
    this.store.appendEvent({
      id: this.nextId('event'),
      groupId: task.groupId,
      taskId: task.id,
      kind: 'task_queued',
      severity: 'info',
      payload: { retryCount: nextRetryCount },
      createdAt: this.now()
    })

    await this.startQueuedTasks(task.groupId, delegateInput)
    await this.notifyGroupChanged(task.groupId)
    const updatedTask = this.store.getTask(task.id)
    const attemptId = updatedTask?.currentAttemptId ?? null
    if (!attemptId) throw new Error(`Retry did not create an attempt for subagent task ${task.id}`)
    const attempt = this.store.getAttempt(attemptId)
    if (!attempt) throw new Error(`Unknown subagent attempt: ${attemptId}`)

    return {
      taskId: task.id,
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: updatedTask?.status ?? 'queued'
    }
  }

  async cancelWorker(input: CancelWorkerInput): Promise<CancelWorkerResult> {
    const task = this.store.getTask(input.taskId)
    if (!task) throw new Error(`Unknown subagent task: ${input.taskId}`)
    if (this.isSettledTaskStatus(task.status)) {
      return { taskId: task.id, attemptId: task.currentAttemptId ?? null, status: task.status }
    }

    if (task.status === 'queued') {
      this.store.updateTaskStatusWithEvent(task.id, 'canceled', {
        id: this.nextId('event'),
        groupId: task.groupId,
        taskId: task.id,
        kind: 'task_canceled',
        severity: 'warning',
        payload: { reason: input.reason },
        createdAt: this.now()
      })
      this.updateGroupSettlement(task.groupId)
      await this.notifyGroupChanged(task.groupId)
      return { taskId: task.id, attemptId: null, status: 'canceled' }
    }

    const attemptId = task.currentAttemptId
    if (!attemptId) throw new Error(`Subagent task ${task.id} has no current attempt to cancel`)
    const attempt = this.store.getAttempt(attemptId)
    if (!attempt) throw new Error(`Unknown subagent attempt: ${attemptId}`)

    this.store.updateAttempt(attempt.id, { status: 'cancel_requested' })
    this.store.updateTaskStatusWithEvent(task.id, 'cancel_requested', {
      id: this.nextId('event'),
      groupId: task.groupId,
      taskId: task.id,
      attemptId: attempt.id,
      kind: 'task_canceled',
      severity: 'warning',
      payload: { reason: input.reason, status: 'cancel_requested' },
      createdAt: this.now()
    })
    await this.workerHost.cancelAttempt({
      groupId: task.groupId,
      taskId: task.id,
      attemptId: attempt.id,
      parentRunId: task.parentRunId,
      correlationId: attempt.correlationId ?? this.nextId('correlation'),
      reason: input.reason
    })

    await this.notifyGroupChanged(task.groupId)
    return { taskId: task.id, attemptId: attempt.id, status: 'cancel_requested' }
  }

  async cancelWorkerGroup(input: CancelWorkerGroupInput): Promise<CancelWorkerGroupResult> {
    const group = this.store.getGroup(input.groupId)
    if (!group) throw new Error(`Unknown subagent group: ${input.groupId}`)
    const tasks: CancelWorkerResult[] = []
    for (const task of this.store.listTasksByGroup(group.id)) {
      tasks.push(await this.cancelWorker({ taskId: task.id, reason: input.reason }))
    }
    const updatedGroup = this.store.getGroup(group.id)
    return {
      groupId: group.id,
      groupStatus: updatedGroup?.status ?? group.status,
      tasks
    }
  }

  async ingestWorkerEvent(event: WorkerHostEvent): Promise<void> {
    if (event.kind === 'settle_attempt') {
      this.settleAttempt(event)
      await this.notifyGroupChanged(event.groupId)
      return
    }
    if (event.kind === 'worker_error') {
      await this.handleWorkerError(event)
      await this.notifyGroupChanged(event.groupId)
      return
    }
    if (event.kind === 'runtime_event') {
      this.store.appendEvent({
        id: this.nextId('event'),
        groupId: event.groupId,
        taskId: event.taskId,
        attemptId: event.attemptId,
        kind: 'runtime_event',
        runtimeEventId: event.runtimeEventId,
        severity: 'info',
        payload: event.payload,
        createdAt: event.timestamp
      })
      await this.notifyGroupChanged(event.groupId)
      return
    }
    if (event.kind === 'progress') {
      this.store.appendEvent({
        id: this.nextId('event'),
        groupId: event.groupId,
        taskId: event.taskId,
        attemptId: event.attemptId,
        kind: 'progress',
        severity: 'info',
        payload: { summary: event.summary, currentToolName: event.currentToolName ?? null },
        createdAt: event.timestamp
      })
      await this.notifyGroupChanged(event.groupId)
      return
    }
    if (event.kind === 'heartbeat') {
      this.store.updateAttempt(event.attemptId, { leaseExpiresAt: event.leaseExpiresAt })
    }
  }

  private async startQueuedTasks(groupId: string, input: DelegateWorkersInput): Promise<void> {
    const tasks = this.store.listTasksByGroup(groupId)
    for (const task of tasks) {
      if (task.status !== 'queued') continue
      if (!this.scheduler.tryAcquire(task.parentRunId, task.id)) continue
      const attempt = this.createAttempt(task)
      const correlationId = this.nextId('correlation')
      this.store.updateAttempt(attempt.id, { correlationId })
      this.store.updateGroup(groupId, { status: 'running' })
      this.store.updateTaskStatusWithEvent(task.id, 'running', {
        id: this.nextId('event'),
        groupId,
        taskId: task.id,
        attemptId: attempt.id,
        kind: 'task_started',
        severity: 'info',
        payload: {},
        createdAt: this.now()
      })
      this.store.updateAttempt(attempt.id, { status: 'running' })
      await this.workerHost.startAttempt(this.toStartWorkerAttemptInput(input, task, attempt, correlationId))
    }
  }

  private async handleWorkerError(event: Extract<WorkerHostEvent, { kind: 'worker_error' }>): Promise<void> {
    this.store.updateAttempt(event.attemptId, {
      status: 'worker_lost',
      error: event.error.message
    })
    this.store.updateTaskStatusWithEvent(event.taskId, 'failed', {
      id: this.nextId('event'),
      groupId: event.groupId,
      taskId: event.taskId,
      attemptId: event.attemptId,
      kind: 'worker_lost',
      severity: 'error',
      payload: event.error,
      createdAt: event.timestamp
    })
    this.scheduler.release(event.parentRunId, event.taskId)
    this.updateGroupSettlement(event.groupId)

    const input = this.inputsByGroup.get(event.groupId)
    if (input) await this.startQueuedTasks(event.groupId, input)
  }

  private createAttempt(task: SubagentTask): SubagentAttempt {
    return this.store.createAttempt({
      id: this.nextId('attempt'),
      taskId: task.id,
      groupId: task.groupId,
      parentRunId: task.parentRunId,
      attemptNumber: task.retryCount + 1,
      status: 'starting',
      createdAt: this.now()
    })
  }

  private settleAttempt(event: Extract<WorkerHostEvent, { kind: 'settle_attempt' }>): void {
    const taskStatus = this.toTaskStatus(event.result.status)
    const attemptStatus = this.toAttemptStatus(event.result.status)
    this.store.updateAttempt(event.attemptId, {
      status: attemptStatus,
      result: event.result,
      error: event.result.error?.message ?? null
    })
    this.store.updateTaskStatusWithEvent(event.taskId, taskStatus, {
      id: this.nextId('event'),
      groupId: event.groupId,
      taskId: event.taskId,
      attemptId: event.attemptId,
      kind: taskStatus === 'completed' ? 'task_completed' : 'task_failed',
      severity: taskStatus === 'completed' ? 'info' : 'error',
      payload: event.result,
      createdAt: event.timestamp
    })
    this.store.updateTask(event.taskId, {
      resultSummary: event.result.summary,
      error: event.result.error?.message ?? null
    })
    this.scheduler.release(event.parentRunId, event.taskId)
    this.updateGroupSettlement(event.groupId)
  }

  private async notifyGroupChanged(groupId: string): Promise<void> {
    if (!this.onGroupChanged) return
    try {
      await this.onGroupChanged(groupId)
    } catch (error) {
      console.error('Notify subagent group change failed', error)
    }
  }

  private updateGroupSettlement(groupId: string): void {
    const tasks = this.store.listTasksByGroup(groupId)
    if (tasks.some((task) => task.status === 'queued' || task.status === 'running' || task.status === 'starting')) {
      this.store.updateGroup(groupId, { status: 'running' })
      return
    }
    if (tasks.every((task) => task.status === 'completed')) {
      this.store.updateGroup(groupId, { status: 'completed' })
      return
    }
    if (tasks.some((task) => task.status === 'completed')) {
      this.store.updateGroup(groupId, { status: 'partial' })
      return
    }
    if (tasks.some((task) => task.status === 'canceled')) {
      this.store.updateGroup(groupId, { status: 'canceled' })
      return
    }
    this.store.updateGroup(groupId, { status: 'failed' })
  }

  private toStartWorkerAttemptInput(
    input: DelegateWorkersInput,
    task: SubagentTask,
    attempt: SubagentAttempt,
    correlationId: string
  ): StartWorkerAttemptInput {
    return {
      groupId: task.groupId,
      taskId: task.id,
      attemptId: attempt.id,
      parentConversationId: task.parentConversationId,
      parentRunId: task.parentRunId,
      parentMessageId: input.parentMessageId ?? null,
      parentToolCallId: input.parentToolCallId,
      correlationId,
      attemptNumber: attempt.attemptNumber,
      createdAt: attempt.createdAt,
      timeoutMs: input.tasks.find((candidate) => candidate.instruction === task.instruction)?.timeoutMs ?? 60_000,
      cwd: task.cwd,
      workspace: this.toWorkspacePolicy(task),
      promptPackage: {
        systemPrompt: 'You are a headless worker agent. Only execute the assigned task.',
        contextMessages: [],
        taskInstruction: task.instruction,
        resultContract: 'Return a concise structured result envelope.'
      },
      permissionSnapshot: {
        readableRoots: [task.cwd],
        writableRoots: [],
        allowedTools: [...task.toolAllowlist],
        deniedTools: [
          'delegate_workers',
          'inspect_supervisor_report',
          'collect_worker_results',
          'retry_worker',
          'cancel_worker',
          'cancel_worker_group'
        ],
        network: { enabled: false },
        secrets: { mode: 'none' },
        shell: { enabled: false },
        environment: { allowedKeys: [] }
      },
      modelPolicy: {
        providerId: input.runtimeModel.providerId,
        modelId: input.runtimeModel.modelId,
        reasoningLevel: input.runtimeModel.reasoningLevel ?? null
      },
      runtimeModel: cloneRuntimeModelConfig(input.runtimeModel),
      toolPolicy: {
        activeToolNames: [...task.toolAllowlist],
        blockedToolNames: [
          'delegate_workers',
          'inspect_supervisor_report',
          'collect_worker_results',
          'retry_worker',
          'cancel_worker',
          'cancel_worker_group'
        ]
      }
    }
  }

  private toWorkspacePolicy(task: SubagentTask): WorkerWorkspacePolicy {
    if (task.workspaceMode === 'scratch') {
      return { mode: 'scratch', readableRoots: [task.cwd], writableRoots: [`${task.cwd}/.piagent/subagents/${task.id}`] }
    }
    if (task.workspaceMode === 'worktree') {
      return {
        mode: 'worktree',
        readableRoots: [task.cwd],
        writableRoots: [task.cwd],
        worktreePath: task.cwd
      }
    }
    return { mode: 'readonly', readableRoots: [task.cwd], writableRoots: [] }
  }

  private getCompletedResults(groupId: string): WorkerResultEnvelope[] {
    return this.store
      .listTasksByGroup(groupId)
      .flatMap((task) => this.store.listAttemptsByTask(task.id))
      .map((attempt) => attempt.result)
      .filter((result): result is WorkerResultEnvelope => Boolean(result))
  }

  private toDelegateResult(groupId: string): DelegateWorkersResult {
    return {
      groupId,
      tasks: this.store.listTasksByGroup(groupId).map((task) => ({
        taskId: task.id,
        label: task.label ?? null,
        status: task.status
      }))
    }
  }

  private getIdempotencyKey(input: DelegateWorkersInput): string {
    return [input.parentRunId, input.parentToolCallId, input.optionalRequestId ?? ''].join(':')
  }

  private nextId(prefix: string): string {
    let candidate = this.idFactory(prefix)
    let counter = 2
    while (this.usedIds.has(candidate)) {
      candidate = `${this.idFactory(prefix)}-${counter}`
      counter += 1
    }
    this.usedIds.add(candidate)
    return candidate
  }

  private isSettledGroup(status: string): boolean {
    return ['completed', 'partial', 'failed', 'canceled', 'timed_out', 'interrupted'].includes(status)
  }

  private isSettledTaskStatus(status: SubagentTask['status']): boolean {
    return ['completed', 'failed', 'blocked', 'timed_out', 'canceled', 'interrupted'].includes(status)
  }

  private isRetryableTaskStatus(status: SubagentTask['status']): boolean {
    return ['failed', 'blocked', 'timed_out', 'canceled', 'interrupted'].includes(status)
  }

  private toTaskStatus(status: WorkerResultEnvelope['status']) {
    if (status === 'partial') return 'failed'
    return status
  }

  private toAttemptStatus(status: WorkerResultEnvelope['status']) {
    if (status === 'partial') return 'failed'
    return status
  }
}

const cloneDelegateWorkersInput = (input: DelegateWorkersInput): DelegateWorkersInput => ({
  ...input,
  runtimeModel: cloneRuntimeModelConfig(input.runtimeModel),
  tasks: input.tasks.map((task) => ({
    ...task,
    toolAllowlist: [...task.toolAllowlist]
  }))
})

const cloneRuntimeModelConfig = (
  config: DelegateWorkersInput['runtimeModel']
): DelegateWorkersInput['runtimeModel'] => ({
  ...config,
  providerConfig: {
    ...config.providerConfig,
    headers: config.providerConfig.headers ? { ...config.providerConfig.headers } : undefined,
    models: config.providerConfig.models.map((model) => ({
      ...model,
      thinkingLevelMap: model.thinkingLevelMap ? { ...model.thinkingLevelMap } : undefined,
      input: [...model.input],
      cost: { ...model.cost },
      headers: model.headers ? { ...model.headers } : undefined,
      compat: model.compat
    }))
  }
})
