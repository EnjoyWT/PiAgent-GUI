import type {
  StartWorkerAttemptInput,
  WorkerHostCommand,
  WorkerHostEvent,
  WorkerRuntimeEvent,
  WorkerSessionHandle
} from './subagent-types.ts'
import { WorkerSessionFactoryImpl, type WorkerSessionFactory } from './worker-session-factory.ts'

type WorkerHostIpcServerOptions = {
  send: (message: WorkerHostEvent) => void
  sessionFactory: WorkerSessionFactory
  now?: () => string
  processId?: number | null
}

type ActiveAttempt = {
  abortController: AbortController
  handle?: WorkerSessionHandle
}

export class WorkerHostIpcServer {
  private readonly activeAttempts = new Map<string, ActiveAttempt>()
  private readonly now: () => string
  private readonly processId: number | null
  private readonly options: WorkerHostIpcServerOptions

  constructor(options: WorkerHostIpcServerOptions) {
    this.options = options
    this.now = options.now ?? (() => new Date().toISOString())
    this.processId = options.processId ?? getProcessId()
  }

  async handleCommand(command: WorkerHostCommand): Promise<void> {
    if (command.kind === 'cancel_attempt') {
      this.cancelAttempt(command)
      return
    }

    await this.startAttempt(command.input, command.sequence)
  }

  private async startAttempt(input: StartWorkerAttemptInput, sequence: number): Promise<void> {
    const abortController = new AbortController()
    this.activeAttempts.set(input.attemptId, { abortController })

    try {
      const handle = await this.options.sessionFactory.create(input)
      this.activeAttempts.set(input.attemptId, { abortController, handle })

      this.options.send({
        ...baseEvent(input, sequence, this.now()),
        kind: 'worker_ready',
        processId: this.processId,
        workerSessionId: handle.workerSessionId
      })

      const result = await handle.run(abortController.signal, (event) => {
        this.options.send(toRuntimeEvent(input, event, this.now()))
      })

      this.options.send({
        ...baseEvent(input, sequence, this.now()),
        kind: 'settle_attempt',
        result
      })
    } catch (error) {
      this.options.send({
        ...baseEvent(input, sequence, this.now()),
        kind: 'worker_error',
        error: {
          code: 'worker_runtime_error',
          message: error instanceof Error ? error.message : String(error),
          retryable: true
        }
      })
    } finally {
      const active = this.activeAttempts.get(input.attemptId)
      this.activeAttempts.delete(input.attemptId)
      await active?.handle?.dispose()
    }
  }

  private cancelAttempt(command: Extract<WorkerHostCommand, { kind: 'cancel_attempt' }>): void {
    const active = this.activeAttempts.get(command.attemptId)
    active?.abortController.abort(command.reason)

    this.options.send({
      groupId: command.groupId,
      taskId: command.taskId,
      attemptId: command.attemptId,
      parentRunId: command.parentRunId,
      correlationId: command.correlationId,
      sequence: command.sequence,
      timestamp: this.now(),
      kind: 'cancel_ack',
      reason: command.reason
    })
  }
}

const baseEvent = (input: StartWorkerAttemptInput, sequence: number, timestamp: string) => ({
  groupId: input.groupId,
  taskId: input.taskId,
  attemptId: input.attemptId,
  parentRunId: input.parentRunId,
  correlationId: input.correlationId,
  sequence,
  timestamp
})

const toRuntimeEvent = (
  input: StartWorkerAttemptInput,
  event: unknown,
  timestamp: string
): WorkerRuntimeEvent => {
  const eventRecord = isRecord(event) ? event : {}
  const runtimeEventId =
    typeof eventRecord.id === 'string'
      ? eventRecord.id
      : `${input.attemptId}:runtime:${Date.now().toString(36)}`

  return {
    ...baseEvent(input, 0, timestamp),
    kind: 'runtime_event',
    runtimeEventId,
    eventType: typeof eventRecord.type === 'string' ? eventRecord.type : 'unknown',
    payload: event
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const getProcessId = (): number | null =>
  typeof process.pid === 'number' ? process.pid : null

const sendToParent = (message: WorkerHostEvent): void => {
  process.send?.(message)
}

if (process.send) {
  const server = new WorkerHostIpcServer({
    send: sendToParent,
    sessionFactory: new WorkerSessionFactoryImpl()
  })

  process.on('message', (message) => {
    void server.handleCommand(message as WorkerHostCommand)
  })
}
