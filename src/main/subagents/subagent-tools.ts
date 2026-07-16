import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type {
  CancelWorkerGroupInput,
  CancelWorkerGroupResult,
  CancelWorkerInput,
  CancelWorkerResult,
  CollectWorkerResultsInput,
  CollectWorkerResultsResult,
  DelegateWorkerTaskInput,
  DelegateWorkersInput,
  DelegateWorkersResult,
  RetryWorkerInput,
  RetryWorkerResult,
  WaitForGroupInput,
  WaitForGroupResult,
  WorkerRuntimeModelConfig,
  WorkerWorkspacePolicy
} from './subagent-types.ts'
import type { SupervisorGroupReport } from './supervisor-reporter.ts'

export type TaskManagerClient = {
  delegateWorkers(input: DelegateWorkersInput): Promise<DelegateWorkersResult>
  waitForGroup(input: WaitForGroupInput): Promise<WaitForGroupResult>
  buildSupervisorReport(input: { groupId: string; afterEventSeq?: number }): SupervisorGroupReport
  collectWorkerResults(input: CollectWorkerResultsInput): CollectWorkerResultsResult
  retryWorker(input: RetryWorkerInput): Promise<RetryWorkerResult>
  cancelWorker(input: CancelWorkerInput): Promise<CancelWorkerResult>
  cancelWorkerGroup(input: CancelWorkerGroupInput): Promise<CancelWorkerGroupResult>
}

export type SubagentToolRuntimeContext = {
  parentConversationId: string
  parentRunId: string | (() => string | null)
  parentMessageId?: string | null
  cwd: string | (() => string)
  parentRuntimeModel?: WorkerRuntimeModelConfig
}

export type CreateSubagentToolsOptions = {
  taskManager: TaskManagerClient
  context: SubagentToolRuntimeContext
}

const workspaceModes = ['readonly', 'scratch', 'worktree'] as const
const managementTools = new Set([
  'delegate_workers',
  'wait_worker_group',
  'inspect_supervisor_report',
  'collect_worker_results',
  'retry_worker',
  'cancel_worker',
  'cancel_worker_group'
])
const readonlyTools = new Set(['read', 'grep', 'find', 'ls'])

export const createSubagentTools = ({
  taskManager,
  context
}: CreateSubagentToolsOptions): ToolDefinition[] => [
  {
    name: 'delegate_workers',
    label: 'Delegate Workers',
    description:
      'Delegate one or more bounded investigation tasks to isolated worker agents. Parent identity, cwd, and run context are supplied by the runtime, not by tool parameters.',
    parameters: Type.Object({
      optionalRequestId: Type.Optional(Type.String()),
      waitStrategy: Type.Optional(
        Type.String({
          enum: ['none', 'all', 'all_settled', 'first_success', 'first_completed', 'quorum']
        })
      ),
      tasks: Type.Array(
        Type.Object({
          label: Type.Optional(Type.String()),
          instruction: Type.String(),
          workspaceMode: Type.Optional(Type.String({ enum: workspaceModes })),
          toolAllowlist: Type.Optional(Type.Array(Type.String())),
          timeoutMs: Type.Optional(Type.Number())
        }),
        { minItems: 1 }
      )
    }),
    execute: async (toolCallId, params) => {
      const input = normalizeDelegateWorkersParams(params)
      const parentRunId = resolveString(context.parentRunId)
      if (!parentRunId) throw new Error('delegate_workers requires an active parent run.')
      if (!context.parentRuntimeModel) {
        throw new Error('delegate_workers requires an active runtime model.')
      }
      const result = await taskManager.delegateWorkers({
        parentConversationId: context.parentConversationId,
        parentRunId,
        parentMessageId: context.parentMessageId ?? null,
        parentToolCallId: toolCallId,
        optionalRequestId: input.optionalRequestId,
        cwd: resolveString(context.cwd),
        runtimeModel: cloneRuntimeModelConfig(context.parentRuntimeModel),
        waitStrategy: input.waitStrategy,
        tasks: input.tasks
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: `Delegated ${result.tasks.length} worker ${result.tasks.length === 1 ? 'task' : 'tasks'} in group ${result.groupId}.`
          }
        ],
        details: result
      }
    }
  },
  {
    name: 'wait_worker_group',
    label: 'Wait Worker Group',
    description: 'Wait for a delegated worker group to settle, or return timeout while preserving worker state.',
    parameters: Type.Object({
      groupId: Type.String(),
      timeoutMs: Type.Optional(Type.Number())
    }),
    execute: async (_toolCallId, params) => {
      const input = normalizeWaitForGroupParams(params)
      const result = await taskManager.waitForGroup(input)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Worker group ${input.groupId} wait status: ${result.waitStatus}.`
          }
        ],
        details: result
      }
    }
  },
  {
    name: 'inspect_supervisor_report',
    label: 'Inspect Supervisor Report',
    description:
      'Return a deterministic snapshot and event delta for a delegated worker group. Use afterEventSeq to resume from a previous report cursor.',
    parameters: Type.Object({
      groupId: Type.String(),
      afterEventSeq: Type.Optional(Type.Number())
    }),
    execute: async (_toolCallId, params) => {
      const input = normalizeSupervisorReportParams(params)
      const result = taskManager.buildSupervisorReport(input)

      return {
        content: [
          {
            type: 'text' as const,
            text: result.markdown
          }
        ],
        details: result
      }
    }
  },
  {
    name: 'collect_worker_results',
    label: 'Collect Worker Results',
    description: 'Collect completed result envelopes for a delegated worker group.',
    parameters: Type.Object({
      groupId: Type.String()
    }),
    execute: async (_toolCallId, params) => {
      const input = normalizeGroupIdParams(params, 'collect_worker_results')
      const result = taskManager.collectWorkerResults(input)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Collected ${result.completedResults.length} worker ${result.completedResults.length === 1 ? 'result' : 'results'} from group ${result.groupId}.`
          }
        ],
        details: result
      }
    }
  },
  {
    name: 'retry_worker',
    label: 'Retry Worker',
    description: 'Retry a failed, blocked, timed out, canceled, or interrupted worker task by creating a new attempt.',
    parameters: Type.Object({
      taskId: Type.String()
    }),
    execute: async (_toolCallId, params) => {
      const result = await taskManager.retryWorker(normalizeTaskIdParams(params, 'retry_worker'))
      return {
        content: [
          {
            type: 'text' as const,
            text: `Retried worker task ${result.taskId} as attempt ${result.attemptId}.`
          }
        ],
        details: result
      }
    }
  },
  {
    name: 'cancel_worker',
    label: 'Cancel Worker',
    description: 'Request cancellation for a single worker task.',
    parameters: Type.Object({
      taskId: Type.String(),
      reason: Type.Optional(Type.String())
    }),
    execute: async (_toolCallId, params) => {
      const result = await taskManager.cancelWorker(normalizeCancelWorkerParams(params))
      return {
        content: [
          {
            type: 'text' as const,
            text: `Worker task ${result.taskId} status: ${result.status}.`
          }
        ],
        details: result
      }
    }
  },
  {
    name: 'cancel_worker_group',
    label: 'Cancel Worker Group',
    description: 'Request cancellation for all active or queued tasks in a worker group.',
    parameters: Type.Object({
      groupId: Type.String(),
      reason: Type.Optional(Type.String())
    }),
    execute: async (_toolCallId, params) => {
      const result = await taskManager.cancelWorkerGroup(normalizeCancelWorkerGroupParams(params))
      return {
        content: [
          {
            type: 'text' as const,
            text: `Worker group ${result.groupId} status: ${result.groupStatus}.`
          }
        ],
        details: result
      }
    }
  }
]

const normalizeDelegateWorkersParams = (
  params: unknown
): Pick<DelegateWorkersInput, 'optionalRequestId' | 'waitStrategy' | 'tasks'> => {
  const raw = isRecord(params) ? params : {}
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : []
  const tasks = rawTasks.map(normalizeTask).filter((task): task is DelegateWorkerTaskInput => Boolean(task))
  if (tasks.length === 0) {
    throw new Error('delegate_workers requires at least one task.')
  }

  return {
    optionalRequestId: typeof raw.optionalRequestId === 'string' ? raw.optionalRequestId : null,
    waitStrategy: isWaitStrategy(raw.waitStrategy) ? raw.waitStrategy : 'all_settled',
    tasks
  }
}

const normalizeTask = (rawTask: unknown): DelegateWorkerTaskInput | null => {
  if (!isRecord(rawTask)) return null
  const instruction = typeof rawTask.instruction === 'string' ? rawTask.instruction.trim() : ''
  if (!instruction) return null
  const workspaceMode = isWorkspaceMode(rawTask.workspaceMode) ? rawTask.workspaceMode : 'readonly'

  return {
    label: typeof rawTask.label === 'string' ? rawTask.label : null,
    instruction,
    workspaceMode,
    toolAllowlist: filterWorkerTools(
      Array.isArray(rawTask.toolAllowlist)
        ? rawTask.toolAllowlist.filter((tool): tool is string => typeof tool === 'string')
        : ['read', 'grep', 'find', 'ls'],
      workspaceMode
    ),
    timeoutMs: typeof rawTask.timeoutMs === 'number' ? Math.max(1, Math.trunc(rawTask.timeoutMs)) : undefined
  }
}

const normalizeWaitForGroupParams = (params: unknown): WaitForGroupInput => {
  const raw = isRecord(params) ? params : {}
  const groupId = typeof raw.groupId === 'string' ? raw.groupId.trim() : ''
  if (!groupId) throw new Error('wait_worker_group requires groupId.')
  return {
    groupId,
    timeoutMs: typeof raw.timeoutMs === 'number' ? Math.max(0, Math.trunc(raw.timeoutMs)) : 0
  }
}

const normalizeSupervisorReportParams = (
  params: unknown
): { groupId: string; afterEventSeq?: number } => {
  const raw = isRecord(params) ? params : {}
  const groupId = typeof raw.groupId === 'string' ? raw.groupId.trim() : ''
  if (!groupId) throw new Error('inspect_supervisor_report requires groupId.')
  return {
    groupId,
    afterEventSeq:
      typeof raw.afterEventSeq === 'number' ? Math.max(0, Math.trunc(raw.afterEventSeq)) : undefined
  }
}

const normalizeGroupIdParams = (params: unknown, toolName: string): { groupId: string } => {
  const raw = isRecord(params) ? params : {}
  const groupId = typeof raw.groupId === 'string' ? raw.groupId.trim() : ''
  if (!groupId) throw new Error(`${toolName} requires groupId.`)
  return { groupId }
}

const normalizeTaskIdParams = (params: unknown, toolName: string): { taskId: string } => {
  const raw = isRecord(params) ? params : {}
  const taskId = typeof raw.taskId === 'string' ? raw.taskId.trim() : ''
  if (!taskId) throw new Error(`${toolName} requires taskId.`)
  return { taskId }
}

const normalizeCancelWorkerParams = (params: unknown): CancelWorkerInput => ({
  ...normalizeTaskIdParams(params, 'cancel_worker'),
  reason: normalizeReason(params)
})

const normalizeCancelWorkerGroupParams = (params: unknown): CancelWorkerGroupInput => ({
  ...normalizeGroupIdParams(params, 'cancel_worker_group'),
  reason: normalizeReason(params)
})

const normalizeReason = (params: unknown): string => {
  const raw = isRecord(params) ? params : {}
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : ''
  return reason || 'parent requested cancellation'
}

const filterWorkerTools = (
  tools: string[],
  workspaceMode: WorkerWorkspacePolicy['mode']
): string[] => {
  const filtered = tools
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0)
    .filter((tool) => !managementTools.has(tool))
    .filter((tool) => workspaceMode !== 'readonly' || readonlyTools.has(tool))
    .filter((tool) => tool !== 'write' && tool !== 'edit' && tool !== 'bash')

  return [...new Set(filtered)]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const resolveString = (value: string | (() => string | null)): string =>
  typeof value === 'function' ? (value() ?? '') : value

const cloneRuntimeModelConfig = (config: WorkerRuntimeModelConfig): WorkerRuntimeModelConfig => ({
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

const isWorkspaceMode = (value: unknown): value is WorkerWorkspacePolicy['mode'] =>
  value === 'readonly' || value === 'scratch' || value === 'worktree'

const isWaitStrategy = (value: unknown): value is DelegateWorkersInput['waitStrategy'] =>
  value === 'none' ||
  value === 'all' ||
  value === 'all_settled' ||
  value === 'first_success' ||
  value === 'first_completed' ||
  value === 'quorum'
