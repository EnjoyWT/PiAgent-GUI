import Database from 'better-sqlite3'

export const clearLocalConversationData = (
  coreDb: Pick<Database.Database, 'prepare' | 'exec'>,
  contextDb: Pick<Database.Database, 'prepare' | 'exec'>
): void => {
  const localConversationIds = `
    SELECT DISTINCT b.conversation_id
    FROM conversation_bindings b
    WHERE b.transport_id = 'desktop-chat'
  `
  const localThreadIds = `
    SELECT DISTINCT b.external_chat_id
    FROM conversation_bindings b
    WHERE b.transport_id = 'desktop-chat'
  `

  coreDb.prepare(`
    DELETE FROM event_log
    WHERE (aggregate_type = 'conversation' AND aggregate_id IN (${localConversationIds}))
       OR (aggregate_type = 'agent_run' AND aggregate_id IN (
         SELECT id FROM agent_runs WHERE conversation_id IN (${localConversationIds})
       ))
  `).run()
  coreDb.prepare(`DELETE FROM conversations WHERE id IN (${localConversationIds})`).run()

  for (const table of [
    'context_entries',
    'context_compactions',
    'context_engine_state',
    'thread_context_heads'
  ]) {
    contextDb.prepare(`DELETE FROM ${table} WHERE thread_id IN (${localThreadIds})`).run()
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
    clearLocalConversationData(coreDb, contextDb)
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
