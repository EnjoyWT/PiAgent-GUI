import Database from 'better-sqlite3'

type DeleteCommand = {
  coreDbPath: string
  contextDbPath: string
}

const EVENT_BATCH_SIZE = 100
const WORKER_BUSY_TIMEOUT_MS = 100
const WORKER_BUSY_RETRY_DELAY_MS = 25
const WORKER_BUSY_RETRY_LIMIT = 240
const TRANSIENT_RUNTIME_EVENT_TYPES = [
  'agentMessageDelta',
  'agentMessageThinkingDelta',
  'agentToolCallProgress'
] as const

const now = (): string => new Date().toISOString()

const isSqliteBusy = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'SQLITE_BUSY'
  )

const wait = (delayMs: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs))

const retryWhenBusy = async <T>(operation: () => T): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation()
    } catch (error) {
      if (!isSqliteBusy(error) || attempt >= WORKER_BUSY_RETRY_LIMIT) throw error
      await wait(WORKER_BUSY_RETRY_DELAY_MS)
    }
  }
}

const deleteContext = (db: Database.Database, threadId: string): void => {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM context_entries WHERE thread_id = ?').run(threadId)
    db.prepare('DELETE FROM context_compactions WHERE thread_id = ?').run(threadId)
    db.prepare('DELETE FROM context_engine_state WHERE thread_id = ?').run(threadId)
    db.prepare('DELETE FROM thread_context_heads WHERE thread_id = ?').run(threadId)
  })
  tx()
}

const deleteEventBatch = (db: Database.Database, conversationId: string): number => {
  const result = db
    .prepare(
      `
        DELETE FROM event_log
        WHERE rowid IN (
          SELECT event_log.rowid
          FROM event_log
          LEFT JOIN agent_runs ON event_log.aggregate_type = 'agent_run'
            AND event_log.aggregate_id = agent_runs.id
          WHERE (event_log.aggregate_type = 'conversation' AND event_log.aggregate_id = ?)
             OR agent_runs.conversation_id = ?
          LIMIT ?
        )
      `
    )
    .run(conversationId, conversationId, EVENT_BATCH_SIZE)
  return result.changes
}

const deleteTransientRuntimeEventBatch = (db: Database.Database): number => {
  const result = db
    .prepare(
      `
        DELETE FROM event_log
        WHERE rowid IN (
          SELECT rowid
          FROM event_log
          WHERE event_type IN (${TRANSIENT_RUNTIME_EVENT_TYPES.map(() => '?').join(', ')})
          LIMIT ?
        )
      `
    )
    .run(...TRANSIENT_RUNTIME_EVENT_TYPES, EVENT_BATCH_SIZE)
  return result.changes
}

export const runThreadDeletionWorker = async ({
  coreDbPath,
  contextDbPath
}: DeleteCommand): Promise<boolean> => {
  const coreDb = new Database(coreDbPath)
  const contextDb = new Database(contextDbPath)
  let activeConversationId: string | null = null
  coreDb.pragma('foreign_keys = ON')
  coreDb.pragma(`busy_timeout = ${WORKER_BUSY_TIMEOUT_MS}`)
  contextDb.pragma(`busy_timeout = ${WORKER_BUSY_TIMEOUT_MS}`)

  try {
    const job = (await retryWhenBusy(() =>
      coreDb
        .prepare(
          `
            SELECT conversation_id, thread_id
            FROM thread_deletion_jobs
            WHERE status IN ('queued', 'running', 'failed')
            ORDER BY created_at ASC
            LIMIT 1
          `
        )
        .get()
    )) as { conversation_id: string; thread_id: string } | undefined
    if (!job) {
      let deletedAny = false
      while ((await retryWhenBusy(() => deleteTransientRuntimeEventBatch(coreDb))) > 0) {
        deletedAny = true
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      return deletedAny
    }
    activeConversationId = job.conversation_id

    await retryWhenBusy(() =>
      coreDb
        .prepare(
          `UPDATE thread_deletion_jobs SET status = 'running', last_error = NULL, updated_at = ? WHERE conversation_id = ?`
        )
        .run(now(), job.conversation_id)
    )

    while ((await retryWhenBusy(() => deleteEventBatch(coreDb, job.conversation_id))) > 0) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    await retryWhenBusy(() => deleteContext(contextDb, job.thread_id))

    await retryWhenBusy(() => {
      const tx = coreDb.transaction(() => {
        coreDb.prepare(`DELETE FROM conversations WHERE id = ?`).run(job.conversation_id)
      })
      tx()
    })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      if (activeConversationId) {
        coreDb
          .prepare(
            `UPDATE thread_deletion_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE conversation_id = ?`
          )
          .run(message, now(), activeConversationId)
      }
    } catch {
      // Preserve the original cleanup error for the parent process.
    }
    throw error
  } finally {
    contextDb.close()
    coreDb.close()
  }
}

if (process.send) {
  process.on('message', (message: unknown) => {
    void runThreadDeletionWorker(message as DeleteCommand)
      .then((processed) => process.send?.({ kind: processed ? 'done' : 'idle' }))
      .catch((error) =>
        process.send?.({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      )
  })
}
