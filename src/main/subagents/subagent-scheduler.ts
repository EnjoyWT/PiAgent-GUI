export type SubagentSchedulerOptions = {
  globalMaxRunning: number
  perParentRunMaxRunning: number
}

export class SubagentScheduler {
  private readonly globalMaxRunning: number
  private readonly perParentRunMaxRunning: number
  private readonly runningTaskIds = new Set<string>()
  private readonly runningByParentRun = new Map<string, Set<string>>()

  constructor(options: SubagentSchedulerOptions) {
    this.globalMaxRunning = Math.max(1, Math.trunc(options.globalMaxRunning))
    this.perParentRunMaxRunning = Math.max(1, Math.trunc(options.perParentRunMaxRunning))
  }

  tryAcquire(parentRunId: string, taskId: string): boolean {
    if (this.runningTaskIds.has(taskId)) return true
    if (this.runningTaskIds.size >= this.globalMaxRunning) return false
    const parentSet = this.runningByParentRun.get(parentRunId) ?? new Set<string>()
    if (parentSet.size >= this.perParentRunMaxRunning) return false
    parentSet.add(taskId)
    this.runningByParentRun.set(parentRunId, parentSet)
    this.runningTaskIds.add(taskId)
    return true
  }

  release(parentRunId: string, taskId: string): void {
    this.runningTaskIds.delete(taskId)
    const parentSet = this.runningByParentRun.get(parentRunId)
    if (!parentSet) return
    parentSet.delete(taskId)
    if (parentSet.size === 0) this.runningByParentRun.delete(parentRunId)
  }

  getRunningCount(): number {
    return this.runningTaskIds.size
  }
}
