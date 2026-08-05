import { fork } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { getDefaultCoreV2DbPath } from '../core-v2/sqlite-db.ts'

let cleanupPromise: Promise<{ cleared: true }> | null = null

export const cleanupLocalConversations = (): Promise<{ cleared: true }> => {
  if (cleanupPromise) return cleanupPromise
  const entryPath = join(dirname(fileURLToPath(import.meta.url)), 'worker-entry.js')
  cleanupPromise = new Promise<{ cleared: true }>((resolve, reject) => {
    const worker = fork(entryPath)
    worker.once('error', reject)
    worker.once('message', (message: unknown) => {
      worker.kill()
      if (typeof message === 'object' && message && 'kind' in message && message.kind === 'done') {
        resolve({ cleared: true })
        return
      }
      reject(new Error(typeof message === 'object' && message && 'message' in message ? String(message.message) : '本地会话清理失败'))
    })
    worker.send({
      coreDbPath: getDefaultCoreV2DbPath(),
      contextDbPath: join(app.getPath('userData'), 'context.db')
    })
  }).finally(() => {
    cleanupPromise = null
  })
  return cleanupPromise
}
