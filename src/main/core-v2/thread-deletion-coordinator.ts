export type ThreadDeletionQueueStore = {
  enqueue(threadId: string): void
  list(): string[]
  remove(threadId: string): void
}

type ThreadDeletionCoordinatorDeps = {
  queueStore: ThreadDeletionQueueStore
  stopMaintenanceWorker: () => Promise<void>
  scheduleDeletion: (threadId: string) => Promise<void>
  kickMaintenanceWorker: () => void
  onRetryNeeded?: () => void
}

export class ThreadDeletionCoordinator {
  private processing = false

  constructor(private readonly deps: ThreadDeletionCoordinatorDeps) {}

  enqueue(threadId: string): void {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) return
    this.deps.queueStore.enqueue(normalizedThreadId)
    void this.processPending()
  }

  async processPending(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      const pending = this.deps.queueStore.list()
      if (pending.length === 0) return

      await this.deps.stopMaintenanceWorker()
      for (const threadId of pending) {
        try {
          await this.deps.scheduleDeletion(threadId)
        } catch (error) {
          console.error('[thread-deletion] scheduling queued delete failed', error)
          this.deps.onRetryNeeded?.()
          return
        }
        this.deps.queueStore.remove(threadId)
      }
      this.deps.kickMaintenanceWorker()
    } finally {
      this.processing = false
    }
  }
}
