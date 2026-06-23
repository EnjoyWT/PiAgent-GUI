import { randomUUID } from 'node:crypto'
import type { AgentRun } from '../core-v2/domain.ts'
import { getLocalConversationByThreadIdFromService } from '../core-v2/local-thread-query.ts'
import { getLocalThreadHostService } from '../core-v2/local-thread-host.ts'
import { getCoreV2Service } from '../core-v2/sqlite-db.ts'
import { normalizeCoreTimestamp } from '../core-v2/time.ts'
import type { RunScheduleDecision } from '../runtime-host/run-scheduler.ts'
import { getLocalRuntimeHostService } from '../runtime-host/local-runtime-host.ts'
import type { ScheduledTask, ScheduledTaskRun } from '../../shared/scheduled-tasks.ts'
import { getScheduledTaskService } from './scheduled-task-service.ts'

type ScheduledTaskExecution = {
  task: ScheduledTask
  taskRun: ScheduledTaskRun
  conversationId: string
  threadId: string | null
  run: AgentRun
}

const buildAutomationPrompt = (task: ScheduledTask, taskRun: ScheduledTaskRun): string =>
  [
    '[SYSTEM: You are running as a scheduled automation task. The system manages run history and delivery. Do not create or modify scheduled tasks recursively unless the user explicitly asks for that.]',
    `Task Name: ${task.name}`,
    `Task ID: ${task.id}`,
    `Scheduled For: ${taskRun.scheduledFor}`,
    `Execution Mode: ${task.executionMode}`,
    '',
    task.prompt
  ].join('\n')

export class ScheduledTaskScheduler {
  private readonly owner = `main-${process.pid}-${randomUUID().slice(0, 8)}`
  private readonly service = getScheduledTaskService()
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  async start(intervalMs = 30_000): Promise<void> {
    if (this.timer) return
    try {
      const recovered = this.service.recoverInterruptedRuns()
      if (recovered > 0) {
        console.warn(`[scheduled-tasks] recovered ${recovered} interrupted run(s)`)
      }
    } catch (error) {
      console.error('[scheduled-tasks] recover interrupted runs failed', error)
    }
    this.timer = setInterval(
      () => {
        void this.tick()
      },
      Math.max(5_000, intervalMs)
    )
    await this.tick()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const claims = this.service.claimDueTasks({ owner: this.owner, limit: 12 })
      for (const claim of claims) {
        try {
          const execution = await this.prepareExecution(claim.task, claim.taskRun)
          this.service.markRunQueued({
            runId: claim.taskRun.id,
            agentRunId: execution.run.id,
            conversationId: execution.conversationId,
            threadId: execution.threadId
          })
          const runtimeHost = await getLocalRuntimeHostService()
          const decision = runtimeHost.getRunScheduler().schedule(execution.run)
          this.startScheduledRun(decision)
        } catch (error) {
          this.service.completeRun({
            runId: claim.taskRun.id,
            status: 'failed',
            errorText: error instanceof Error ? error.message : String(error),
            endedAt: normalizeCoreTimestamp()
          })
        }
      }
    } finally {
      this.ticking = false
    }
  }

  private async prepareExecution(
    task: ScheduledTask,
    taskRun: ScheduledTaskRun
  ): Promise<ScheduledTaskExecution> {
    const core = getCoreV2Service()
    let conversationId = task.targetConversationId?.trim() || ''
    let threadId = task.targetThreadId?.trim() || null

    if (!conversationId && threadId) {
      const match = getLocalConversationByThreadIdFromService(core, threadId)
      if (match) conversationId = match.conversation.id
    }

    if (!conversationId && task.executionMode === 'isolated_thread') {
      const workspacePath = task.workspacePath?.trim() || process.cwd()
      const thread = (await getLocalThreadHostService()).createThread({
        workspacePath,
        title: `${task.name} - ${new Date(taskRun.scheduledFor).toLocaleString()}`
      })
      threadId = thread.id
      const match = getLocalConversationByThreadIdFromService(core, thread.id)
      conversationId = match?.conversation.id ?? ''
    }

    if (!conversationId) {
      throw new Error('Scheduled task target conversation is missing.')
    }

    const conversation = core.getConversation(conversationId)
    if (!conversation)
      throw new Error(`Scheduled task target conversation not found: ${conversationId}`)

    const prompt = buildAutomationPrompt(task, taskRun)
    let traceId = ''
    if (threadId) {
      const host = await getLocalThreadHostService()
      const message = host.addMessage(
        threadId,
        'user',
        prompt,
        null,
        {
          version: 1,
          blocks: [{ type: 'text', text: prompt }]
        },
        {
          messageKind: 'automation',
          includeInAgentContext: false,
          createdAt: taskRun.scheduledFor
        }
      )
      traceId = message.id
    } else {
      traceId = `scheduled-task:${task.id}:run:${taskRun.id}`
      core.upsertConversationMessage({
        conversationId,
        bindingId: conversation.activeBindingId ?? null,
        externalMessageId: traceId,
        role: 'user',
        direction: 'internal',
        text: prompt,
        payload: {
          localThread: {
            version: 1,
            messageKind: 'automation',
            includeInAgentContext: false,
            agentRunId: null,
            submissionId: null,
            agentEntryId: null,
            agentTurnId: null,
            toolCallId: null,
            stepIndex: null,
            runtimeSequence: null,
            content: {
              version: 1,
              blocks: [{ type: 'text', text: prompt }]
            }
          },
          scheduledTask: {
            taskId: task.id,
            taskRunId: taskRun.id
          }
        },
        createdAt: taskRun.scheduledFor
      })
    }

    const run = core.requestRun({
      conversationId,
      triggerKind: 'automation',
      traceId,
      triggerExecutionOverride: task.triggerExecutionOverride ?? undefined
    })

    return {
      task,
      taskRun,
      conversationId,
      threadId,
      run
    }
  }

  private startScheduledRun(decision: RunScheduleDecision): void {
    if (decision.action !== 'start') return
    void getLocalRuntimeHostService()
      .then((runtimeHost) =>
        runtimeHost
          .getRunExecutor()
          .start(decision.run)
          .catch((error) => {
            console.error('[scheduled-tasks] run executor failed', error)
          })
          .finally(() => {
            const next = runtimeHost
              .getRunScheduler()
              .completeActiveRun(decision.run.conversationId)
            if (next) this.startScheduledRun(next)
          })
      )
      .catch((error) => {
        console.error('[scheduled-tasks] runtime host unavailable', error)
      })
  }
}

let scheduledTaskSchedulerSingleton: ScheduledTaskScheduler | null = null

export const getScheduledTaskScheduler = (): ScheduledTaskScheduler => {
  if (scheduledTaskSchedulerSingleton) return scheduledTaskSchedulerSingleton
  scheduledTaskSchedulerSingleton = new ScheduledTaskScheduler()
  return scheduledTaskSchedulerSingleton
}
