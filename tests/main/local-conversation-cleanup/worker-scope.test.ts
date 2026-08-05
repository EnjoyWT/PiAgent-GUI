import test from 'node:test'
import assert from 'node:assert/strict'
import { clearLocalConversationData } from '../../../src/main/local-conversation-cleanup/worker-entry.ts'

test('clears only desktop-chat conversations', () => {
  const statements: string[] = []
  const db = { prepare: (sql: string) => ({ run: () => statements.push(sql), all: () => [] }), exec: (sql: string) => statements.push(sql) } as any
  clearLocalConversationData(db, db)
  assert.equal(statements.some((sql) => sql.includes("transport_id = 'desktop-chat'")), true)
  assert.equal(statements.some((sql) => sql.includes('scheduled_tasks')), false)
})
