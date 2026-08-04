import {
  enqueuePendingThreadDeletion,
  listPendingThreadDeletions,
  removePendingThreadDeletion
} from '../db/config-db.ts'
import { getLocalThreadHostService } from './local-thread-host.ts'
import {
  kickThreadDeletionWorker,
  stopThreadDeletionWorker
} from './thread-deletion-worker-manager.ts'
import { ThreadDeletionCoordinator } from './thread-deletion-coordinator.ts'

let retryTimer: NodeJS.Timeout | null = null

const scheduleRetry = (): void => {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void deletionCoordinator.processPending()
  }, 250)
}

const deletionCoordinator = new ThreadDeletionCoordinator({
  queueStore: {
    enqueue: enqueuePendingThreadDeletion,
    list: listPendingThreadDeletions,
    remove: removePendingThreadDeletion
  },
  stopMaintenanceWorker: stopThreadDeletionWorker,
  scheduleDeletion: async (threadId) => {
    const host = await getLocalThreadHostService()
    host.deleteThread(threadId)
  },
  kickMaintenanceWorker: kickThreadDeletionWorker,
  onRetryNeeded: scheduleRetry
})

export const enqueueThreadDeletion = (threadId: string): void => {
  deletionCoordinator.enqueue(threadId)
}

export const resumePendingThreadDeletions = (): void => {
  void deletionCoordinator.processPending().then(() => {
    if (listPendingThreadDeletions().length === 0) kickThreadDeletionWorker()
  })
}
