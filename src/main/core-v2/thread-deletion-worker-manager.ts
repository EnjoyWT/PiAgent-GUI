import { fork, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { getDefaultCoreV2DbPath } from './sqlite-db.ts'

let worker: ChildProcess | null = null
const workersStoppedForForegroundWrite = new WeakSet<ChildProcess>()

const contextDbPath = (): string => join(app.getPath('userData'), 'context.db')
const entryPath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), 'thread-deletion-worker-entry.js')

export const kickThreadDeletionWorker = (): void => {
  if (worker) return
  const child = fork(entryPath())
  worker = child
  let processedJob = false
  child.once('error', (error) => {
    console.error('[thread-deletion] worker failed to start', error)
  })
  child.once('message', (message: unknown) => {
    processedJob = Boolean(
      typeof message === 'object' && message && 'kind' in message && message.kind === 'done'
    )
    if (typeof message === 'object' && message && 'kind' in message && message.kind === 'error') {
      console.error('[thread-deletion] worker failed', message)
    }
    child.kill()
  })
  child.once('exit', () => {
    if (worker === child) worker = null
    // A completed job may leave another queued job behind.
    if (processedJob && !workersStoppedForForegroundWrite.has(child)) {
      setImmediate(kickThreadDeletionWorker)
    }
  })
  child.send({ coreDbPath: getDefaultCoreV2DbPath(), contextDbPath: contextDbPath() })
}

export const stopThreadDeletionWorker = async (): Promise<void> => {
  const child = worker
  if (!child || child.exitCode !== null || child.killed) return
  workersStoppedForForegroundWrite.add(child)
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    child.kill()
  })
}
