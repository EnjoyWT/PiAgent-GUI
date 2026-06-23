import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import type { IdFactory, WorkerHostClient } from './subagent-types.ts'
import type { SubagentStore } from './subagent-store.ts'
import { SubagentScheduler } from './subagent-scheduler.ts'
import { SubagentTaskManager } from './subagent-task-manager.ts'
import { WorkerHostClientProcess } from './worker-host-client.ts'
import { SqliteSubagentStore } from './sqlite-subagent-store.ts'
import { buildSubagentPanelSetEvent } from './subagent-panel-projection.ts'
import { getCoreV2Db } from '../core-v2/sqlite-db.ts'
import { emitGatewaySubagentPanelEvent } from '../runtime-host/runtime-event-bus.ts'
import type { SubagentPanelEvent } from '../../shared/subagent-panel.ts'

export type CreateSubagentTaskManagerServiceOptions = {
  workerHost?: WorkerHostClient
  workerHostFactory?: (
    onEvent: (event: Parameters<SubagentTaskManager['ingestWorkerEvent']>[0]) => void
  ) => WorkerHostClient
  entryPath?: string
  db?: Database.Database
  store?: SubagentStore
  scheduler?: SubagentScheduler
  now?: () => string
  idFactory?: IdFactory
  emitPanelEvent?: (event: SubagentPanelEvent) => void
}

let singleton: SubagentTaskManager | null = null

export const createSubagentTaskManagerService = (
  options: CreateSubagentTaskManagerServiceOptions = {}
): SubagentTaskManager => {
  const store = options.store ?? new SqliteSubagentStore(options.db ?? getCoreV2Db())
  const scheduler =
    options.scheduler ?? new SubagentScheduler({ globalMaxRunning: 4, perParentRunMaxRunning: 2 })
  let manager: SubagentTaskManager
  const onEvent = (event: Parameters<SubagentTaskManager['ingestWorkerEvent']>[0]) => {
    void manager.ingestWorkerEvent(event)
  }
  const workerHost =
    options.workerHost ??
    options.workerHostFactory?.(onEvent) ??
    new WorkerHostClientProcess({
      entryPath: options.entryPath ?? resolveDefaultWorkerHostEntryPath(),
      onEvent
    })

  manager = new SubagentTaskManager({
    store,
    scheduler,
    workerHost,
    now: options.now,
    idFactory: options.idFactory,
    onGroupChanged: (groupId) => {
      const emitPanelEvent = options.emitPanelEvent ?? emitDefaultPanelEvent
      emitPanelEvent(buildSubagentPanelSetEvent({ store, groupId }))
    }
  })
  return manager
}

export const getSubagentTaskManagerService = (): SubagentTaskManager => {
  singleton ??= createSubagentTaskManagerService()
  return singleton
}

export const resetSubagentTaskManagerServiceForTests = (): void => {
  singleton = null
}

const resolveDefaultWorkerHostEntryPath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), 'worker-host-entry.js')

const emitDefaultPanelEvent = (event: SubagentPanelEvent): void => {
  try {
    emitGatewaySubagentPanelEvent(event)
  } catch (error) {
    console.error('Emit subagent panel event failed', error)
  }
}
