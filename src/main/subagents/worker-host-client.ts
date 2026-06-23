import { fork as nodeFork, type ChildProcess } from 'node:child_process'
import type {
  CancelWorkerAttemptInput,
  StartWorkerAttemptInput,
  WorkerHandle,
  WorkerHostClient,
  WorkerHostEvent,
  WorkerReadyEvent
} from './subagent-types.ts'

type ForkFn = (modulePath: string, args: string[]) => ChildProcess

export type WorkerHostClientProcessOptions = {
  entryPath: string
  startTimeoutMs?: number
  cancelGraceMs?: number
  onEvent?: (event: WorkerHostEvent) => void
  fork?: ForkFn
}

export class WorkerHostClientProcess implements WorkerHostClient {
  private readonly entryPath: string
  private readonly startTimeoutMs: number
  private readonly cancelGraceMs: number
  private readonly onEvent?: (event: WorkerHostEvent) => void
  private readonly fork: ForkFn
  private readonly processesByAttempt = new Map<string, ChildProcess>()
  private readonly cancelTimersByAttempt = new Map<string, NodeJS.Timeout>()

  constructor(options: WorkerHostClientProcessOptions) {
    this.entryPath = options.entryPath
    this.startTimeoutMs = Math.max(1, Math.trunc(options.startTimeoutMs ?? 10_000))
    this.cancelGraceMs = Math.max(1, Math.trunc(options.cancelGraceMs ?? 5_000))
    this.onEvent = options.onEvent
    this.fork = options.fork ?? ((modulePath, args) => nodeFork(modulePath, args))
  }

  async startAttempt(input: StartWorkerAttemptInput): Promise<WorkerHandle> {
    this.validateStartInput(input)
    const child = this.fork(this.entryPath, [])
    this.processesByAttempt.set(input.attemptId, child)

    const readyPromise = this.waitForReady(child, input)
    child.send?.({
      kind: 'start_attempt',
      sequence: 1,
      timestamp: new Date().toISOString(),
      input
    })
    const ready = await readyPromise
    child.on('message', (message: unknown) => {
      if (!this.isWorkerHostEvent(message)) return
      this.clearCancelTimerIfSettled(message)
      this.onEvent?.(message)
      if (message.kind === 'settle_attempt' || message.kind === 'worker_error') {
        this.processesByAttempt.delete(message.attemptId)
      }
    })
    return {
      taskId: input.taskId,
      attemptId: input.attemptId,
      processId: ready.processId ?? child.pid ?? null,
      startedAt: input.createdAt
    }
  }

  async cancelAttempt(input: CancelWorkerAttemptInput): Promise<void> {
    const child = this.processesByAttempt.get(input.attemptId)
    if (!child) return
    child.send?.({
      kind: 'cancel_attempt',
      sequence: 1,
      timestamp: new Date().toISOString(),
      groupId: input.groupId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      parentRunId: input.parentRunId,
      correlationId: input.correlationId,
      reason: input.reason
    })
    const existingTimer = this.cancelTimersByAttempt.get(input.attemptId)
    if (existingTimer) clearTimeout(existingTimer)
    const timer = setTimeout(() => {
      child.kill()
      this.cancelTimersByAttempt.delete(input.attemptId)
      this.processesByAttempt.delete(input.attemptId)
      this.onEvent?.({
        kind: 'worker_error',
        groupId: input.groupId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        parentRunId: input.parentRunId,
        correlationId: input.correlationId,
        sequence: 2,
        timestamp: new Date().toISOString(),
        error: {
          code: 'worker_killed_after_cancel',
          message: `Worker did not acknowledge cancel within ${this.cancelGraceMs}ms`,
          retryable: true
        }
      })
    }, this.cancelGraceMs)
    this.cancelTimersByAttempt.set(input.attemptId, timer)
  }

  async disposeAttempt(attemptId: string): Promise<void> {
    const child = this.processesByAttempt.get(attemptId)
    if (!child) return
    child.kill()
    const cancelTimer = this.cancelTimersByAttempt.get(attemptId)
    if (cancelTimer) clearTimeout(cancelTimer)
    this.cancelTimersByAttempt.delete(attemptId)
    this.processesByAttempt.delete(attemptId)
  }

  private waitForReady(
    child: ChildProcess,
    input: StartWorkerAttemptInput
  ): Promise<WorkerReadyEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for worker_ready for attempt ${input.attemptId}`))
      }, this.startTimeoutMs)

      child.once('message', (message: unknown) => {
        if (!this.isReadyForAttempt(message, input)) return
        clearTimeout(timer)
        resolve(message)
      })

      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        reject(new Error(`Worker exited before worker_ready: code=${code ?? 'null'} signal=${signal ?? 'null'}`))
      })
    })
  }

  private isReadyForAttempt(
    message: unknown,
    input: StartWorkerAttemptInput
  ): message is WorkerReadyEvent {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false
    const record = message as Record<string, unknown>
    return (
      record.kind === 'worker_ready' &&
      record.groupId === input.groupId &&
      record.taskId === input.taskId &&
      record.attemptId === input.attemptId &&
      record.parentRunId === input.parentRunId
    )
  }

  private isWorkerHostEvent(message: unknown): message is WorkerHostEvent {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false
    const record = message as Record<string, unknown>
    return (
      typeof record.kind === 'string' &&
      typeof record.groupId === 'string' &&
      typeof record.taskId === 'string' &&
      typeof record.attemptId === 'string' &&
      typeof record.parentRunId === 'string' &&
      typeof record.correlationId === 'string'
    )
  }

  private clearCancelTimerIfSettled(event: WorkerHostEvent): void {
    if (event.kind !== 'cancel_ack' && event.kind !== 'settle_attempt' && event.kind !== 'worker_error') return
    const timer = this.cancelTimersByAttempt.get(event.attemptId)
    if (!timer) return
    clearTimeout(timer)
    this.cancelTimersByAttempt.delete(event.attemptId)
  }

  private validateStartInput(input: StartWorkerAttemptInput): void {
    for (const key of ['groupId', 'taskId', 'attemptId', 'parentRunId'] as const) {
      if (!input[key]) throw new Error(`StartWorkerAttemptInput.${key} is required`)
    }
  }
}
