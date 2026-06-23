import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  CORE_V2_SCHEMA_VERSION,
  getCoreV2SchemaVersion,
  migrateCoreV2Schema
} from '../../../src/main/core-v2/storage-schema.ts'

const listColumnNames = (db: Database.Database, tableName: string): string[] =>
  (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
    (column) => column.name
  )

test('migrateCoreV2Schema creates required core and scheduled task tables', (t) => {
  const db = new Database(':memory:')
  t.after(() => db.close())
  migrateCoreV2Schema(db)

  const tables = (
    db
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name)

  assert.equal(getCoreV2SchemaVersion(db), CORE_V2_SCHEMA_VERSION)
  assert.deepEqual(tables, [
    'agent_instances',
    'agent_profiles',
    'agent_run_projections',
    'agent_runs',
    'conversation_bindings',
    'conversation_message_search_fts',
    'conversation_message_search_fts_config',
    'conversation_message_search_fts_content',
    'conversation_message_search_fts_data',
    'conversation_message_search_fts_docsize',
    'conversation_message_search_fts_idx',
    'conversation_messages',
    'conversation_window_projection',
    'conversations',
    'delivery_records',
    'event_log',
    'im_external_identities',
    'im_inbound_events',
    'interaction_checkpoints',
    'person_identities',
    'scheduled_task_runs',
    'scheduled_tasks',
    'thread_plan_states'
  ])

  assert.deepEqual(
    [
      'session_scope',
      'shared_multi_user',
      'person_id',
      'tenant_id',
      'last_external_message_id',
      'last_inbound_trace_id'
    ].every((column) => listColumnNames(db, 'conversation_bindings').includes(column)),
    true
  )
  assert.deepEqual(
    ['expected_binding_id', 'expected_person_id', 'accepted_reply_modes_json', 'expires_at'].every(
      (column) => listColumnNames(db, 'interaction_checkpoints').includes(column)
    ),
    true
  )
  assert.deepEqual(
    [
      'transport_delivery_mode',
      'reply_context_json',
      'degrade_mode',
      'external_message_id',
      'doctor_trace_id',
      'last_error',
      'attempt_count'
    ].every((column) => listColumnNames(db, 'delivery_records').includes(column)),
    true
  )
  assert.deepEqual(
    [
      'im_trace_id',
      'dedupe_key',
      'transport_id',
      'transport_account_id',
      'conversation_id',
      'binding_id',
      'person_id',
      'session_scope',
      'routing_key',
      'message_type',
      'status',
      'envelope_json',
      'error',
      'received_at',
      'created_at',
      'updated_at'
    ].every((column) => listColumnNames(db, 'im_inbound_events').includes(column)),
    true
  )
  assert.equal(listColumnNames(db, 'thread_plan_states').includes('closed'), true)
})

test('migrateCoreV2Schema backfills doctor trace ids for pre-doctor delivery records', (t) => {
  const db = new Database(':memory:')
  t.after(() => db.close())

  db.exec(`
    CREATE TABLE delivery_records (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      binding_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      transport_delivery_mode TEXT,
      reply_context_json TEXT,
      degrade_mode TEXT,
      external_message_id TEXT,
      diagnostic_trace_id TEXT,
      last_error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  db.prepare(
    `
      INSERT INTO delivery_records (
        id,
        conversation_id,
        binding_id,
        mode,
        payload_json,
        status,
        diagnostic_trace_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    'delivery-1',
    'conversation-1',
    'binding-1',
    'reply',
    '{}',
    'requested',
    'legacy-trace-1',
    '2026-04-30T00:00:00.000Z',
    '2026-04-30T00:00:00.000Z'
  )
  db.pragma('user_version = 7')

  migrateCoreV2Schema(db)

  assert.equal(getCoreV2SchemaVersion(db), CORE_V2_SCHEMA_VERSION)
  assert.equal(listColumnNames(db, 'delivery_records').includes('doctor_trace_id'), true)
  const row = db
    .prepare(`SELECT doctor_trace_id FROM delivery_records WHERE id = ?`)
    .get('delivery-1') as { doctor_trace_id: string | null }
  assert.equal(row.doctor_trace_id, 'legacy-trace-1')
})

test('migrateCoreV2Schema v11 backfills conversation search fts on legacy message tables', (t) => {
  const db = new Database(':memory:')
  t.after(() => db.close())

  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      agent_profile_id TEXT NOT NULL,
      workspace_id TEXT,
      title TEXT,
      status TEXT NOT NULL,
      last_run_id TEXT,
      execution_override_json TEXT,
      desktop_visibility_mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE conversation_bindings (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      transport_id TEXT NOT NULL,
      transport_account_id TEXT NOT NULL,
      external_chat_id TEXT NOT NULL,
      external_thread_id TEXT,
      external_user_id TEXT,
      channel_kind TEXT NOT NULL,
      routing_key TEXT NOT NULL UNIQUE,
      readonly_in_desktop INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      direction TEXT NOT NULL,
      text TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );

    INSERT INTO conversations (
      id, agent_profile_id, workspace_id, title, status,
      desktop_visibility_mode, created_at, updated_at
    ) VALUES (
      'conversation-1', 'profile-1', '/tmp/workspace', 'Legacy chat', 'active',
      'visible', '2026-05-30T00:00:00.000Z', '2026-05-30T00:00:00.000Z'
    );

    INSERT INTO conversation_bindings (
      id, conversation_id, transport_id, transport_account_id, external_chat_id,
      channel_kind, routing_key, created_at, updated_at
    ) VALUES (
      'binding-1', 'conversation-1', 'local', 'default', 'thread-legacy',
      'local', 'local:default:thread-legacy', '2026-05-30T00:00:00.000Z', '2026-05-30T00:00:00.000Z'
    );

    INSERT INTO conversation_messages (
      id, conversation_id, role, direction, text, created_at
    ) VALUES (
      'message-1', 'conversation-1', 'user', 'inbound', 'hello legacy', '2026-05-30T00:00:01.000Z'
    );
  `)
  db.pragma('user_version = 10')

  migrateCoreV2Schema(db)

  assert.equal(getCoreV2SchemaVersion(db), CORE_V2_SCHEMA_VERSION)
  assert.equal(listColumnNames(db, 'conversation_messages').includes('binding_id'), true)

  const ftsRow = db
    .prepare(
      `
        SELECT message_id, thread_id, text
        FROM conversation_message_search_fts
        WHERE message_id = ?
      `
    )
    .get('message-1') as { message_id: string; thread_id: string; text: string }

  assert.equal(ftsRow.message_id, 'message-1')
  assert.equal(ftsRow.thread_id, 'thread-legacy')
  assert.equal(ftsRow.text, 'hello legacy')
})
