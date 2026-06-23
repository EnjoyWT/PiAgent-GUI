import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const scriptPath = path.resolve('scripts/queue-history-check/verify-consumed-user-messages.mjs')

const createCoreV2Fixture = (dbPath: string): void => {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      title TEXT,
      desktop_visibility_mode TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE conversation_bindings (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      transport_id TEXT NOT NULL,
      transport_account_id TEXT NOT NULL,
      external_chat_id TEXT NOT NULL,
      channel_kind TEXT NOT NULL,
      routing_key TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      external_message_id TEXT,
      role TEXT NOT NULL,
      text TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL
    );

    CREATE TABLE event_log (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)

  db.prepare(
    `INSERT INTO conversations
      (id, workspace_id, title, desktop_visibility_mode, created_at)
      VALUES (?, ?, ?, ?, ?)`
  ).run('conv-1', '/tmp/piagent-workspace', 'newchat', 'read_write', '2026-04-20T08:00:00.000Z')
  db.prepare(
    `INSERT INTO conversation_bindings
      (id, conversation_id, transport_id, transport_account_id, external_chat_id, channel_kind, routing_key, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'binding-1',
    'conv-1',
    'desktop-chat',
    'desktop',
    'thread-1',
    'dm',
    'desktop-chat:desktop:thread-1:-:dm',
    '2026-04-20T08:00:00.000Z'
  )
  db.prepare(`INSERT INTO agent_runs (id, conversation_id) VALUES (?, ?)`).run('run-1', 'conv-1')
  db.prepare(
    `INSERT INTO event_log
      (id, event_type, sequence, aggregate_type, aggregate_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'evt-user-start',
    'agentMessageStarted',
    1,
    'agent_run',
    'run-1',
    JSON.stringify({
      payload: {
        rawType: 'message_start',
        role: 'user',
        submissionId: 'sub-1',
        message: {
          content: [{ type: 'text', text: 'hello core-v2' }]
        }
      },
      runtime: {
        conversationId: 'conv-1',
        coreAgentRunId: 'run-1'
      }
    }),
    '2026-04-20T08:00:01.000Z'
  )
  db.prepare(
    `INSERT INTO conversation_messages
      (id, conversation_id, external_message_id, role, text, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'message-1',
    'conv-1',
    'message-1',
    'user',
    'hello core-v2',
    JSON.stringify({
      localThread: {
        version: 1,
        agentRunId: 'run-1'
      }
    }),
    '2026-04-20T08:00:01.000Z'
  )

  db.close()
}

test('queue history checker reads consumed user messages from core-v2.db', (t) => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'piagent-queue-history-'))
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }))
  const dbPath = path.join(tmpDir, 'core-v2.db')
  createCoreV2Fixture(dbPath)

  const output = execFileSync(
    process.execPath,
    [scriptPath, '--db', dbPath, '--thread', 'thread-1'],
    {
      encoding: 'utf8'
    }
  )

  assert.match(output, /thread-1/)
  assert.match(output, /user message_start events: 1/)
  assert.match(output, /persisted user messages:\s+1/)
  assert.match(output, /OK: no consumed user messages are missing from history\./)
})
