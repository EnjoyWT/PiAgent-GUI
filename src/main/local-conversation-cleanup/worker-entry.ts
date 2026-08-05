import Database from 'better-sqlite3'

export const clearLocalConversationData = (
  coreDb: Pick<Database.Database, 'prepare' | 'exec'>,
  contextDb: Pick<Database.Database, 'prepare' | 'exec'>,
  onProgress: (completed: number, total: number) => void = () => undefined
): void => {
  const rows = (coreDb.prepare(`
    SELECT b.conversation_id, MIN(b.external_chat_id) AS external_chat_id
    FROM conversation_bindings b
    WHERE b.transport_id = 'desktop-chat'
    GROUP BY b.conversation_id
  `).all() as Array<{ conversation_id: string; external_chat_id: string }>)
  const total = rows.length
  onProgress(0, total)
  for (const [index, row] of rows.entries()) {
    coreDb.prepare(`DELETE FROM event_log WHERE (aggregate_type = 'conversation' AND aggregate_id = ?) OR (aggregate_type = 'agent_run' AND aggregate_id IN (SELECT id FROM agent_runs WHERE conversation_id = ?))`).run(row.conversation_id, row.conversation_id)
    coreDb.prepare('DELETE FROM conversations WHERE id = ?').run(row.conversation_id)
    for (const table of ['context_entries', 'context_compactions', 'context_engine_state', 'thread_context_heads']) {
      contextDb.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(row.external_chat_id)
    }
    onProgress(index + 1, total)
  }
}

export const runLocalConversationCleanupWorker = (input: {
  coreDbPath: string
  contextDbPath: string
}): void => {
  const coreDb = new Database(input.coreDbPath)
  const contextDb = new Database(input.contextDbPath)
  try {
    coreDb.pragma('foreign_keys = ON')
    coreDb.pragma('busy_timeout = 1000')
    contextDb.pragma('busy_timeout = 1000')
    clearLocalConversationData(coreDb, contextDb, (completed, total) => process.send?.({ kind: 'progress', phase: 'deleting', completed, total }))
    process.send?.({ kind: 'progress', phase: 'compacting' })
    coreDb.pragma('wal_checkpoint(TRUNCATE)')
    contextDb.pragma('wal_checkpoint(TRUNCATE)')
    coreDb.exec('VACUUM')
    contextDb.exec('VACUUM')
  } finally {
    contextDb.close()
    coreDb.close()
  }
}

if (process.send) {
  process.on('message', (message: unknown) => {
    try {
      runLocalConversationCleanupWorker(message as { coreDbPath: string; contextDbPath: string })
      process.send?.({ kind: 'done' })
    } catch (error) {
      process.send?.({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  })
}
