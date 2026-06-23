import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskValidationResult,
  UpdateScheduledTaskInput
} from '../../shared/scheduled-tasks.ts'
import type { RuntimeSurfaceToolContext } from '../runtime-host/runtime-surface/runtime-surface-types.ts'
import type { ScheduledTaskService } from '../scheduled-tasks/scheduled-task-service.ts'

type CreateScheduledTaskToolOptions = {
  context: RuntimeSurfaceToolContext
  scheduledTaskService: ScheduledTaskService
}

type ScheduledTaskToolAction =
  | 'list_tasks'
  | 'get_task'
  | 'create_task'
  | 'update_task'
  | 'pause_task'
  | 'resume_task'
  | 'delete_task'
  | 'run_task_now'
  | 'list_task_runs'
  | 'validate_task'

type ScheduledTaskToolDetails =
  | {
      ok: true
      action: ScheduledTaskToolAction
      task?: ReturnType<typeof sanitizeTask>
      tasks?: Array<ReturnType<typeof sanitizeTask>>
      runs?: Array<ReturnType<typeof sanitizeRun>>
      deleted?: { success: true; taskId: string }
      validation?: ReturnType<typeof sanitizeValidation>
    }
  | {
      ok: false
      action: ScheduledTaskToolAction | 'unknown'
      error: {
        code:
          | 'INVALID_ARGUMENT'
          | 'NOT_FOUND'
          | 'VALIDATION_ERROR'
          | 'UNSUPPORTED_ACTION'
          | 'INTERNAL_ERROR'
        message: string
        fieldErrors?: Array<{ path: string; message: string }>
      }
    }

const taskInputSchema = Type.Object(
  {
    name: Type.Optional(Type.String()),
    prompt: Type.Optional(Type.String()),
    schedule: Type.Optional(
      Type.String({
        description:
          'Human-friendly schedule text. Examples: "30m", "every 1h", "0 9 * * *", or "2026-04-24T09:00:00.000Z".'
      })
    ),
    description: Type.Optional(Type.String()),
    executionMode: Type.Optional(Type.String({ enum: ['main_thread', 'isolated_thread'] })),
    targetConversationId: Type.Optional(Type.String()),
    targetThreadId: Type.Optional(Type.String()),
    workspacePath: Type.Optional(Type.String()),
    modelProviderId: Type.Optional(Type.String()),
    modelId: Type.Optional(Type.String())
  },
  { additionalProperties: false }
)

const optionsSchema = Type.Object(
  {
    includeDisabled: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
  },
  { additionalProperties: false }
)

const ACTION_ALIASES: Record<string, ScheduledTaskToolAction> = {
  list: 'list_tasks',
  get: 'get_task',
  create: 'create_task',
  update: 'update_task',
  pause: 'pause_task',
  resume: 'resume_task',
  delete: 'delete_task',
  run_now: 'run_task_now',
  list_runs: 'list_task_runs',
  validate: 'validate_task'
}

const sanitizeTask = (task: ScheduledTask) => ({
  id: task.id,
  name: task.name,
  description: task.description,
  prompt: task.prompt,
  status: task.status,
  enabled: task.enabled,
  scheduleKind: task.scheduleKind,
  schedule: task.schedule,
  scheduleText: task.scheduleDisplay,
  nextRunAt: task.nextRunAt,
  executionMode: task.executionMode,
  targetConversationId: task.targetConversationId,
  targetThreadId: task.targetThreadId,
  workspacePath: task.workspacePath,
  triggerExecutionOverride: task.triggerExecutionOverride ?? null,
  lastRunAt: task.lastRunAt,
  lastRunStatus: task.lastRunStatus,
  lastErrorText: task.lastErrorText,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt
})

const sanitizeRun = (run: ScheduledTaskRun) => ({
  id: run.id,
  taskId: run.taskId,
  status: run.status,
  scheduledFor: run.scheduledFor,
  startedAt: run.startedAt,
  endedAt: run.endedAt,
  agentRunId: run.agentRunId,
  errorText: run.errorText,
  resultSummary: run.resultSummary,
  deliveryStatus: run.deliveryStatus,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt
})

const normalizeFieldErrors = (
  fieldErrors: Array<{ path: string; message: string }> | undefined
): Array<{ path: string; message: string }> | undefined =>
  fieldErrors?.map((item) => ({
    ...item,
    path: item.path.replace(/^payload\./, 'task.')
  }))

const sanitizeValidation = (validation: ScheduledTaskValidationResult) =>
  validation.ok
    ? {
        ok: true as const,
        message: '定时任务配置校验通过。',
        taskPreview: {
          name: validation.task.name,
          description: validation.task.description,
          prompt: validation.task.prompt,
          scheduleKind: validation.task.scheduleKind,
          schedule: validation.task.schedule,
          scheduleText: validation.task.scheduleDisplay,
          nextRunAt: validation.task.nextRunAt,
          executionMode: validation.task.executionMode,
          targetConversationId: validation.task.targetConversationId,
          targetThreadId: validation.task.targetThreadId,
          workspacePath: validation.task.workspacePath,
          status: validation.task.status,
          enabled: validation.task.enabled
        }
      }
    : {
        ok: false as const,
        message: validation.message,
        fieldErrors: normalizeFieldErrors(validation.fieldErrors)
      }

const resolveAction = (value: unknown): ScheduledTaskToolAction | null => {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  if (normalized in ACTION_ALIASES) return ACTION_ALIASES[normalized]
  if (
    normalized === 'list_tasks' ||
    normalized === 'get_task' ||
    normalized === 'create_task' ||
    normalized === 'update_task' ||
    normalized === 'pause_task' ||
    normalized === 'resume_task' ||
    normalized === 'delete_task' ||
    normalized === 'run_task_now' ||
    normalized === 'list_task_runs' ||
    normalized === 'validate_task'
  ) {
    return normalized
  }
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeTaskInput = (
  value: unknown,
  context: RuntimeSurfaceToolContext,
  options?: { defaultTargets?: boolean }
): Partial<CreateScheduledTaskInput> => {
  const input = isRecord(value) ? value : {}
  const output: Partial<CreateScheduledTaskInput> = {}

  if ('name' in input) output.name = String(input.name ?? '').trim()
  if ('prompt' in input) output.prompt = String(input.prompt ?? '').trim()
  if ('schedule' in input) output.schedule = String(input.schedule ?? '').trim()
  if ('description' in input) {
    output.description =
      typeof input.description === 'string' ? input.description.trim() || null : null
  }
  if ('executionMode' in input) {
    output.executionMode =
      input.executionMode === 'isolated_thread' ? 'isolated_thread' : 'main_thread'
  }
  if ('workspacePath' in input) {
    output.workspacePath =
      typeof input.workspacePath === 'string' ? input.workspacePath.trim() || null : null
  }
  if ('targetConversationId' in input) {
    output.targetConversationId =
      typeof input.targetConversationId === 'string'
        ? input.targetConversationId.trim() || null
        : null
  } else if (options?.defaultTargets) {
    output.targetConversationId = context.conversationId || null
  }
  if ('targetThreadId' in input) {
    output.targetThreadId =
      typeof input.targetThreadId === 'string' ? input.targetThreadId.trim() || null : null
  } else if (options?.defaultTargets) {
    output.targetThreadId = context.interactionThreadId || null
  }
  if ('modelProviderId' in input && 'modelId' in input) {
    const providerId = String(input.modelProviderId ?? '').trim()
    const modelId = String(input.modelId ?? '').trim()
    if (providerId && modelId) {
      output.triggerExecutionOverride = { model: { providerId, modelId } }
    }
  }

  return output
}

const normalizeLookupText = (value: string): string => value.trim().toLowerCase()

const resolveTaskReference = async (
  scheduledTaskService: ScheduledTaskService,
  rawTaskId: string,
  context: RuntimeSurfaceToolContext
): Promise<ScheduledTask | null> => {
  const lookup = String(rawTaskId ?? '').trim()
  if (!lookup) return null

  const exact = await scheduledTaskService.getTask(lookup)
  if (exact) return exact

  const tasks = await scheduledTaskService.listTasks({ includeDisabled: true })
  const normalizedLookup = normalizeLookupText(lookup)
  const scoped = tasks.filter(
    (task) =>
      task.targetThreadId === context.interactionThreadId ||
      task.targetConversationId === context.conversationId
  )
  const pools = [scoped, tasks]
  for (const pool of pools) {
    const byName = pool.filter((task) => normalizeLookupText(task.name) === normalizedLookup)
    if (byName.length === 1) return byName[0]
  }
  for (const pool of pools) {
    const byName = pool.filter((task) => normalizeLookupText(task.name).includes(normalizedLookup))
    if (byName.length === 1) return byName[0]
  }
  return null
}

const formatTaskListText = (tasks: Array<ReturnType<typeof sanitizeTask>>): string => {
  if (tasks.length === 0) return '当前没有定时任务。'

  return [
    `已返回 ${tasks.length} 个定时任务：`,
    ...tasks.map((task) => {
      const schedule = task.scheduleText || task.scheduleKind
      const nextRunAt = task.nextRunAt ?? 'none'
      const lastRunStatus = task.lastRunStatus ?? 'none'
      const targetThreadId = task.targetThreadId ?? 'none'
      return `- taskId=${task.id}; name=${task.name}; status=${task.status}; enabled=${task.enabled}; schedule=${schedule}; nextRunAt=${nextRunAt}; targetThreadId=${targetThreadId}; lastRunStatus=${lastRunStatus}`
    })
  ].join('\n')
}

const successResult = (
  action: ScheduledTaskToolAction,
  text: string,
  extra: Omit<Extract<ScheduledTaskToolDetails, { ok: true }>, 'ok' | 'action'>
) => ({
  content: [{ type: 'text' as const, text }],
  details: {
    ok: true as const,
    action,
    ...extra
  }
})

const errorResult = (
  action: ScheduledTaskToolAction | 'unknown',
  code: Extract<Extract<ScheduledTaskToolDetails, { ok: false }>['error']['code'], string>,
  message: string,
  fieldErrors?: Array<{ path: string; message: string }>
) => ({
  content: [{ type: 'text' as const, text: message }],
  details: {
    ok: false as const,
    action,
    error: {
      code,
      message,
      ...(fieldErrors?.length ? { fieldErrors: normalizeFieldErrors(fieldErrors) } : {})
    }
  }
})

export const createScheduledTaskTool = ({
  context,
  scheduledTaskService
}: CreateScheduledTaskToolOptions): ToolDefinition => ({
  name: 'scheduledTaskTool',
  label: 'Scheduled Task Tool',
  description:
    'Single canonical tool for PiAgent scheduled automation. Use it for reminders, recurring follow-up, reports, and future automation. Prefer action names like `create_task`, `update_task`, and `run_task_now`. Put mutable task fields inside `task`. Use `validate_task` before writes when requirements are ambiguous.',
  parameters: Type.Object(
    {
      action: Type.String({
        enum: [
          'list_tasks',
          'get_task',
          'create_task',
          'update_task',
          'pause_task',
          'resume_task',
          'delete_task',
          'run_task_now',
          'list_task_runs',
          'validate_task'
        ]
      }),
      taskId: Type.Optional(Type.String()),
      task: Type.Optional(taskInputSchema),
      options: Type.Optional(optionsSchema)
    },
    { additionalProperties: false }
  ),
  execute: async (_toolCallId, params) => {
    const input = isRecord(params) ? params : {}
    const action = resolveAction(input.action)
    if (!action) {
      return errorResult(
        'unknown',
        'UNSUPPORTED_ACTION',
        `Unsupported action: ${String(input.action ?? '').trim() || '(empty)'}`
      )
    }

    const taskId = String(input.taskId ?? '').trim()
    const options = isRecord(input.options) ? input.options : {}

    try {
      if (action === 'list_tasks') {
        const tasks = await scheduledTaskService.listTasks({
          includeDisabled: 'includeDisabled' in options ? Boolean(options.includeDisabled) : true
        })
        const sanitizedTasks = tasks.map(sanitizeTask)
        return successResult(action, formatTaskListText(sanitizedTasks), { tasks: sanitizedTasks })
      }

      if (action === 'get_task') {
        if (!taskId) {
          return errorResult(action, 'INVALID_ARGUMENT', 'taskId is required for get_task')
        }
        const task = await resolveTaskReference(scheduledTaskService, taskId, context)
        if (!task) return errorResult(action, 'NOT_FOUND', `Task not found: ${taskId}`)
        return successResult(action, `已返回任务 ${task.name}。`, { task: sanitizeTask(task) })
      }

      if (action === 'list_task_runs') {
        if (!taskId) {
          return errorResult(action, 'INVALID_ARGUMENT', 'taskId is required for list_task_runs')
        }
        const task = await resolveTaskReference(scheduledTaskService, taskId, context)
        if (!task) return errorResult(action, 'NOT_FOUND', `Task not found: ${taskId}`)
        const runs = await scheduledTaskService.listRuns(
          task.id,
          typeof options.limit === 'number' ? options.limit : 20
        )
        return successResult(
          action,
          runs.length === 0
            ? `任务 ${task.name} 还没有运行历史。`
            : `已返回任务 ${task.name} 的 ${runs.length} 条运行记录。`,
          {
            task: sanitizeTask(task),
            runs: runs.map(sanitizeRun)
          }
        )
      }

      if (action === 'pause_task') {
        if (!taskId) {
          return errorResult(action, 'INVALID_ARGUMENT', 'taskId is required for pause_task')
        }
        const existing = await resolveTaskReference(scheduledTaskService, taskId, context)
        if (!existing) return errorResult(action, 'NOT_FOUND', `Task not found: ${taskId}`)
        const task = await scheduledTaskService.pauseTask(existing.id)
        return successResult(action, `已暂停任务 ${task.name}。`, { task: sanitizeTask(task) })
      }

      if (action === 'resume_task') {
        if (!taskId) {
          return errorResult(action, 'INVALID_ARGUMENT', 'taskId is required for resume_task')
        }
        const existing = await resolveTaskReference(scheduledTaskService, taskId, context)
        if (!existing) return errorResult(action, 'NOT_FOUND', `Task not found: ${taskId}`)
        const task = await scheduledTaskService.resumeTask(existing.id)
        return successResult(action, `已恢复任务 ${task.name}。`, { task: sanitizeTask(task) })
      }

      if (action === 'delete_task') {
        if (!taskId) {
          return errorResult(action, 'INVALID_ARGUMENT', 'taskId is required for delete_task')
        }
        const task = await resolveTaskReference(scheduledTaskService, taskId, context)
        if (!task) return errorResult(action, 'NOT_FOUND', `Task not found: ${taskId}`)
        await scheduledTaskService.deleteTask(task.id)
        return successResult(action, `已删除任务 ${task.name}。`, {
          deleted: { success: true, taskId: task.id }
        })
      }

      if (action === 'run_task_now') {
        if (!taskId) {
          return errorResult(action, 'INVALID_ARGUMENT', 'taskId is required for run_task_now')
        }
        const existing = await resolveTaskReference(scheduledTaskService, taskId, context)
        if (!existing) return errorResult(action, 'NOT_FOUND', `Task not found: ${taskId}`)
        const task = await scheduledTaskService.triggerTaskNow(existing.id)
        return successResult(action, `任务 ${task.name} 已安排立即运行。`, {
          task: sanitizeTask(task)
        })
      }

      const taskInput = normalizeTaskInput(input.task, context, {
        defaultTargets: action === 'create_task' || (action === 'validate_task' && !taskId)
      })

      if (action === 'validate_task') {
        const candidate = taskId
          ? await buildUpdateCandidate(scheduledTaskService, taskId, taskInput)
          : (taskInput as CreateScheduledTaskInput)
        if (!candidate) return errorResult(action, 'NOT_FOUND', `Task not found: ${taskId}`)
        const validation = await scheduledTaskService.validate(candidate)
        const sanitizedValidation = sanitizeValidation(validation)
        return successResult(action, sanitizedValidation.message, {
          validation: sanitizedValidation
        })
      }

      if (action === 'create_task') {
        if (!isRecord(input.task)) {
          return errorResult(action, 'INVALID_ARGUMENT', 'task object is required for create_task')
        }
        const validation = await scheduledTaskService.validate(
          taskInput as CreateScheduledTaskInput
        )
        if (!validation.ok) {
          return errorResult(action, 'VALIDATION_ERROR', validation.message, validation.fieldErrors)
        }
        const task = await scheduledTaskService.createTask(taskInput as CreateScheduledTaskInput)
        return successResult(action, `已创建定时任务 ${task.name}。`, { task: sanitizeTask(task) })
      }

      if (!taskId) {
        return errorResult(action, 'INVALID_ARGUMENT', 'taskId is required for update_task')
      }
      if (!isRecord(input.task)) {
        return errorResult(action, 'INVALID_ARGUMENT', 'task object is required for update_task')
      }

      const candidate = await buildUpdateCandidate(scheduledTaskService, taskId, taskInput)
      if (!candidate) return errorResult(action, 'NOT_FOUND', `Task not found: ${taskId}`)
      const validation = await scheduledTaskService.validate(candidate)
      if (!validation.ok) {
        return errorResult(action, 'VALIDATION_ERROR', validation.message, validation.fieldErrors)
      }
      const task = await scheduledTaskService.updateTask(candidate)
      return successResult(action, `已更新定时任务 ${task.name}。`, { task: sanitizeTask(task) })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Scheduled task tool failed unexpectedly.'
      if (/unknown scheduled task|task not found/i.test(message)) {
        return errorResult(action, 'NOT_FOUND', message)
      }
      return errorResult(action, 'INTERNAL_ERROR', message)
    }
  }
})

const buildUpdateCandidate = async (
  scheduledTaskService: ScheduledTaskService,
  taskId: string,
  taskInput: Partial<CreateScheduledTaskInput>
): Promise<UpdateScheduledTaskInput | null> => {
  const existing = await scheduledTaskService.getTask(taskId)
  if (!existing) return null
  return {
    id: taskId,
    name: taskInput.name ?? existing.name,
    prompt: taskInput.prompt ?? existing.prompt,
    schedule: taskInput.schedule ?? existing.schedule,
    description: taskInput.description === undefined ? existing.description : taskInput.description,
    executionMode: taskInput.executionMode ?? existing.executionMode,
    targetConversationId:
      taskInput.targetConversationId === undefined
        ? existing.targetConversationId
        : taskInput.targetConversationId,
    targetThreadId:
      taskInput.targetThreadId === undefined ? existing.targetThreadId : taskInput.targetThreadId,
    workspacePath:
      taskInput.workspacePath === undefined ? existing.workspacePath : taskInput.workspacePath,
    triggerExecutionOverride:
      taskInput.triggerExecutionOverride === undefined
        ? existing.triggerExecutionOverride
        : taskInput.triggerExecutionOverride
  }
}
