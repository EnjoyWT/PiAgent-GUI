import type { AgentInstance, AgentRun } from '../core-v2/domain.ts'
import { AgentInstanceManager } from './agent-instance-manager.ts'

export type RunScheduleDecision =
  | {
      action: 'start'
      run: AgentRun
      instance: AgentInstance
    }
  | {
      action: 'queued'
      run: AgentRun
      queueLength: number
    }

export type RunSchedulerDeps = {
  instanceManager: AgentInstanceManager
}

export type StopConversationScheduleResult = {
  stoppedActiveRun: boolean
  queueLength: number
}

export type ResetConversationScheduleResult = StopConversationScheduleResult & {
  clearedQueueLength: number
}

export class RunScheduler {
  private readonly instanceManager: AgentInstanceManager
  private readonly queueByConversationId = new Map<string, AgentRun[]>()

  constructor(deps: RunSchedulerDeps) {
    this.instanceManager = deps.instanceManager
  }

  schedule(run: AgentRun): RunScheduleDecision {
    const instance = this.instanceManager.get(run.conversationId)
    if (instance && (instance.status === 'running' || instance.status === 'waiting_interaction')) {
      const queue = this.queueByConversationId.get(run.conversationId) ?? []
      queue.push(run)
      this.queueByConversationId.set(run.conversationId, queue)
      return {
        action: 'queued',
        run,
        queueLength: queue.length
      }
    }

    const nextInstance = this.instanceManager.acquire({ conversationId: run.conversationId })
    const runningInstance = this.instanceManager.updateStatus(
      nextInstance.conversationId,
      'running'
    )
    return {
      action: 'start',
      run,
      instance: runningInstance
    }
  }

  completeActiveRun(conversationId: string): RunScheduleDecision | null {
    this.instanceManager.updateStatus(conversationId, 'idle')
    const queue = this.queueByConversationId.get(conversationId) ?? []
    const nextRun = queue.shift() ?? null
    if (queue.length > 0) this.queueByConversationId.set(conversationId, queue)
    else this.queueByConversationId.delete(conversationId)
    if (!nextRun) return null
    return this.schedule(nextRun)
  }

  listQueuedRuns(conversationId?: string): AgentRun[] {
    if (conversationId) return [...(this.queueByConversationId.get(conversationId) ?? [])]
    return [...this.queueByConversationId.values()].flat()
  }

  stopConversation(conversationId: string): StopConversationScheduleResult {
    const instance = this.instanceManager.get(conversationId)
    const stoppedActiveRun =
      instance?.status === 'running' ||
      instance?.status === 'waiting_interaction' ||
      instance?.status === 'draining'
    if (stoppedActiveRun) this.instanceManager.dispose(conversationId)
    return {
      stoppedActiveRun,
      queueLength: this.listQueuedRuns(conversationId).length
    }
  }

  resetConversation(conversationId: string): ResetConversationScheduleResult {
    const stopResult = this.stopConversation(conversationId)
    const clearedQueueLength = this.listQueuedRuns(conversationId).length
    this.queueByConversationId.delete(conversationId)
    return {
      ...stopResult,
      clearedQueueLength,
      queueLength: 0
    }
  }
}
