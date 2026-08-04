import test from 'node:test'
import assert from 'node:assert/strict'
import { ThreadDeletionCoordinator } from '../../../src/main/core-v2/thread-deletion-coordinator.ts'

test('deletion coordinator waits for maintenance worker exit before scheduling a queued delete', async () => {
  const pending = ['thread-1']
  const calls: string[] = []
  const coordinator = new ThreadDeletionCoordinator({
    queueStore: {
      enqueue: (threadId) => pending.push(threadId),
      list: () => [...pending],
      remove: (threadId) => {
        const index = pending.indexOf(threadId)
        if (index >= 0) pending.splice(index, 1)
      }
    },
    stopMaintenanceWorker: async () => {
      calls.push('stop')
    },
    scheduleDeletion: async (threadId) => {
      calls.push(`schedule:${threadId}`)
    },
    kickMaintenanceWorker: () => {
      calls.push('kick')
    }
  })

  await coordinator.processPending()

  assert.deepEqual(calls, ['stop', 'schedule:thread-1', 'kick'])
  assert.deepEqual(pending, [])
})

test('deletion coordinator keeps an intent queued when scheduling fails', async () => {
  const pending = ['thread-1']
  const coordinator = new ThreadDeletionCoordinator({
    queueStore: {
      enqueue: (threadId) => pending.push(threadId),
      list: () => [...pending],
      remove: (threadId) => {
        const index = pending.indexOf(threadId)
        if (index >= 0) pending.splice(index, 1)
      }
    },
    stopMaintenanceWorker: async () => {},
    scheduleDeletion: async () => {
      throw new Error('SQLITE_BUSY')
    },
    kickMaintenanceWorker: () => {}
  })

  await coordinator.processPending()

  assert.deepEqual(pending, ['thread-1'])
})
