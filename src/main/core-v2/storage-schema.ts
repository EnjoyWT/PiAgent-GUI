import type Database from 'better-sqlite3'

export const CORE_V2_SCHEMA_VERSION = 11

export function getCoreV2SchemaVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

export function setCoreV2SchemaVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`)
}

export function migrateCoreV2Schema(db: Database.Database): void {
  db.pragma('foreign_keys = ON')

  const migrate = db.transaction(() => {
    const currentVersion = getCoreV2SchemaVersion(db)

    if (currentVersion === 0) {
      initCoreV2Schema(db)
      initCoreV2ProjectionSchema(db)
      initAgentRunProjectionSchema(db)
      initScheduledTasksSchema(db)
      initConversationSearchFtsSchema(db)
      setCoreV2SchemaVersion(db, CORE_V2_SCHEMA_VERSION)
      return
    }

    if (currentVersion < 2) {
      initCoreV2ProjectionSchema(db)
    }

    if (currentVersion < 3) {
      initScheduledTasksSchema(db)
    }

    if (currentVersion < 4) {
      migrateScheduledTaskSchemaV4(db)
    }

    if (currentVersion < 5) {
      migrateConversationWindowProjectionSchemaV5(db)
    }

    if (currentVersion < 6) {
      migrateImRuntimeSchemaV6(db)
    }

    if (currentVersion < 7) {
      migrateAgentRunProjectionSchemaV7(db)
    }

    if (currentVersion < 8) {
      migrateDoctorTerminologySchemaV8(db)
    }

    if (currentVersion < 9) {
      migrateThreadPlanStateSchemaV9(db)
    }

    if (currentVersion < 10) {
      migrateThreadPlanStateClosedSchemaV10(db)
    }

    if (currentVersion < 11) {
      migrateConversationSearchFtsSchemaV11(db)
    }

    setCoreV2SchemaVersion(db, CORE_V2_SCHEMA_VERSION)
  })

  migrate()
}

export function initCoreV2Schema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      default_execution_policy_json TEXT NOT NULL,
      enabled_transport_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agent_profile_id TEXT NOT NULL,
      workspace_id TEXT,
      title TEXT,
      status TEXT NOT NULL,
      active_binding_id TEXT,
      last_run_id TEXT,
      execution_override_json TEXT,
      desktop_visibility_mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_profile_created
      ON conversations(agent_profile_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_workspace_updated
      ON conversations(workspace_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS conversation_bindings (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      transport_id TEXT NOT NULL,
      transport_account_id TEXT NOT NULL,
      external_chat_id TEXT NOT NULL,
      external_thread_id TEXT,
      external_user_id TEXT,
      channel_kind TEXT NOT NULL,
      routing_key TEXT NOT NULL UNIQUE,
      session_scope TEXT,
      shared_multi_user INTEGER NOT NULL DEFAULT 0,
      person_id TEXT,
      tenant_id TEXT,
      last_external_message_id TEXT,
      last_inbound_trace_id TEXT,
      readonly_in_desktop INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bindings_conversation
      ON conversation_bindings(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_bindings_transport_account_chat
      ON conversation_bindings(transport_id, transport_account_id, external_chat_id);
    CREATE INDEX IF NOT EXISTS idx_bindings_person
      ON conversation_bindings(person_id);
    CREATE INDEX IF NOT EXISTS idx_bindings_trace
      ON conversation_bindings(last_inbound_trace_id);

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      binding_id TEXT,
      external_message_id TEXT,
      role TEXT NOT NULL,
      direction TEXT NOT NULL,
      text TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (binding_id) REFERENCES conversation_bindings(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
      ON conversation_messages(conversation_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS agent_instances (
      id TEXT PRIMARY KEY,
      agent_profile_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      effective_execution_policy_json TEXT NOT NULL,
      runtime_generation INTEGER NOT NULL DEFAULT 1,
      loaded_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      last_reload_reason TEXT,
      FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_instances_conversation_status
      ON agent_instances(conversation_id, status);

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      instance_id TEXT,
      trigger_kind TEXT NOT NULL,
      requested_execution_policy_json TEXT NOT NULL,
      effective_execution_snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (instance_id) REFERENCES agent_instances(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_conversation_started
      ON agent_runs(conversation_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_trace
      ON agent_runs(trace_id);

    CREATE TABLE IF NOT EXISTS thread_plan_states (
      thread_id TEXT PRIMARY KEY,
      conversation_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      active_run_id TEXT,
      source_tool_call_id TEXT,
      items_json TEXT NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (active_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_thread_plan_states_conversation
      ON thread_plan_states(conversation_id);

    CREATE TABLE IF NOT EXISTS interaction_checkpoints (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      run_id TEXT,
      kind TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      expected_binding_id TEXT,
      expected_person_id TEXT,
      accepted_reply_modes_json TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL,
      FOREIGN KEY (expected_binding_id) REFERENCES conversation_bindings(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS delivery_records (
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
      doctor_trace_id TEXT,
      last_error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (binding_id) REFERENCES conversation_bindings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_delivery_conversation_created
      ON delivery_records(conversation_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS person_identities (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS im_external_identities (
      id TEXT PRIMARY KEY,
      person_id TEXT,
      transport_id TEXT NOT NULL,
      transport_account_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT '',
      external_user_id TEXT NOT NULL,
      external_display_name TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES person_identities(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_im_external_identity_unique
      ON im_external_identities(transport_id, transport_account_id, tenant_id, external_user_id);
    CREATE INDEX IF NOT EXISTS idx_im_external_identity_person
      ON im_external_identities(person_id);

    CREATE TABLE IF NOT EXISTS im_inbound_events (
      id TEXT PRIMARY KEY,
      im_trace_id TEXT NOT NULL UNIQUE,
      dedupe_key TEXT NOT NULL UNIQUE,
      transport_id TEXT NOT NULL,
      transport_account_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      binding_id TEXT NOT NULL,
      person_id TEXT,
      session_scope TEXT,
      routing_key TEXT NOT NULL,
      message_type TEXT NOT NULL,
      status TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      error TEXT,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (binding_id) REFERENCES conversation_bindings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_im_inbound_events_transport_received
      ON im_inbound_events(transport_id, transport_account_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_im_inbound_events_conversation_received
      ON im_inbound_events(conversation_id, received_at DESC);

    CREATE TABLE IF NOT EXISTS event_log (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      causation_id TEXT,
      parent_event_id TEXT,
      sequence INTEGER NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_event_log_sequence
      ON event_log(sequence);
    CREATE INDEX IF NOT EXISTS idx_event_log_trace
      ON event_log(trace_id, sequence ASC);
    CREATE INDEX IF NOT EXISTS idx_event_log_aggregate
      ON event_log(aggregate_type, aggregate_id, sequence ASC);
  `)
}

export function initCoreV2ProjectionSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_window_projection (
      conversation_id TEXT PRIMARY KEY,
      agent_profile_id TEXT NOT NULL,
      workspace_id TEXT,
      primary_source_kind TEXT NOT NULL,
      primary_transport_id TEXT,
      primary_transport_account_id TEXT,
      primary_external_label TEXT,
      desktop_visibility_mode TEXT NOT NULL,
      started_at TEXT,
      last_message_at TEXT,
      last_run_status TEXT,
      pending_interaction_kind TEXT,
      unread_count INTEGER NOT NULL DEFAULT 0,
      needs_attention INTEGER NOT NULL DEFAULT 0,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_window_source_updated
      ON conversation_window_projection(primary_source_kind, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversation_window_workspace_updated
      ON conversation_window_projection(workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversation_window_attention
      ON conversation_window_projection(needs_attention, updated_at DESC);
  `)
}

export function initAgentRunProjectionSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_run_projections (
      run_id TEXT PRIMARY KEY,
      projection_text TEXT NOT NULL DEFAULT '',
      projection_turns_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_run_projections_updated
      ON agent_run_projections(updated_at DESC);
  `)
}

export function initScheduledTasksSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      schedule_kind TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      schedule_display TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL,
      next_run_at TEXT,
      execution_mode TEXT NOT NULL,
      target_conversation_id TEXT,
      target_thread_id TEXT,
      workspace_path TEXT,
      prompt TEXT NOT NULL,
      trigger_execution_override_json TEXT,
      delivery_policy_json TEXT NOT NULL,
      concurrency_policy TEXT NOT NULL,
      misfire_policy TEXT NOT NULL,
      retry_policy_json TEXT NOT NULL,
      timeout_policy_json TEXT NOT NULL,
      lease_owner TEXT,
      lease_until TEXT,
      last_run_id TEXT,
      last_run_at TEXT,
      last_run_status TEXT,
      last_error_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (target_conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
      FOREIGN KEY (last_run_id) REFERENCES scheduled_task_runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due
      ON scheduled_tasks(enabled, status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_thread
      ON scheduled_tasks(target_thread_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_conversation
      ON scheduled_tasks(target_conversation_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS scheduled_task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      attempt INTEGER NOT NULL DEFAULT 1,
      agent_run_id TEXT,
      conversation_id TEXT,
      thread_id TEXT,
      lease_owner TEXT,
      error_text TEXT,
      result_summary TEXT,
      delivery_status TEXT,
      delivery_error_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task_created
      ON scheduled_task_runs(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_agent_run
      ON scheduled_task_runs(agent_run_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_status_updated
      ON scheduled_task_runs(status, updated_at DESC);
  `)
}

export function migrateScheduledTaskSchemaV4(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(scheduled_tasks)`).all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'schedule_display')) {
    db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN schedule_display TEXT NOT NULL DEFAULT ''`)
  }
}

export function migrateConversationWindowProjectionSchemaV5(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(conversation_window_projection)`).all() as Array<{
    name: string
  }>
  if (!columns.some((column) => column.name === 'started_at')) {
    db.exec(`ALTER TABLE conversation_window_projection ADD COLUMN started_at TEXT`)
  }

  db.exec(`
    UPDATE conversation_window_projection
    SET started_at = (
      SELECT CASE
        WHEN msg_first IS NULL THEN run_first
        WHEN run_first IS NULL THEN msg_first
        WHEN msg_first <= run_first THEN msg_first
        ELSE run_first
      END
      FROM (
        SELECT
          (
            SELECT MIN(created_at)
            FROM conversation_messages
            WHERE conversation_id = conversation_window_projection.conversation_id
          ) AS msg_first,
          (
            SELECT MIN(started_at)
            FROM agent_runs
            WHERE conversation_id = conversation_window_projection.conversation_id
          ) AS run_first
      )
    )
  `)
}

const hasColumn = (db: Database.Database, tableName: string, columnName: string): boolean =>
  (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).some(
    (column) => column.name === columnName
  )

const hasTable = (db: Database.Database, tableName: string): boolean =>
  Boolean(
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .pluck()
      .get(tableName)
  )

const addColumnIfMissing = (
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void => {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  }
}

export function migrateImRuntimeSchemaV6(db: Database.Database): void {
  addColumnIfMissing(db, 'conversation_bindings', 'session_scope', 'TEXT')
  addColumnIfMissing(db, 'conversation_bindings', 'shared_multi_user', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'conversation_bindings', 'person_id', 'TEXT')
  addColumnIfMissing(db, 'conversation_bindings', 'tenant_id', 'TEXT')
  addColumnIfMissing(db, 'conversation_bindings', 'last_external_message_id', 'TEXT')
  addColumnIfMissing(db, 'conversation_bindings', 'last_inbound_trace_id', 'TEXT')

  addColumnIfMissing(db, 'interaction_checkpoints', 'expected_binding_id', 'TEXT')
  addColumnIfMissing(db, 'interaction_checkpoints', 'expected_person_id', 'TEXT')
  addColumnIfMissing(db, 'interaction_checkpoints', 'accepted_reply_modes_json', 'TEXT')
  addColumnIfMissing(db, 'interaction_checkpoints', 'expires_at', 'TEXT')

  addColumnIfMissing(db, 'delivery_records', 'transport_delivery_mode', 'TEXT')
  addColumnIfMissing(db, 'delivery_records', 'reply_context_json', 'TEXT')
  addColumnIfMissing(db, 'delivery_records', 'degrade_mode', 'TEXT')
  addColumnIfMissing(db, 'delivery_records', 'external_message_id', 'TEXT')
  addColumnIfMissing(db, 'delivery_records', 'doctor_trace_id', 'TEXT')
  addColumnIfMissing(db, 'delivery_records', 'last_error', 'TEXT')
  addColumnIfMissing(db, 'delivery_records', 'attempt_count', 'INTEGER NOT NULL DEFAULT 0')

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bindings_person
      ON conversation_bindings(person_id);
    CREATE INDEX IF NOT EXISTS idx_bindings_trace
      ON conversation_bindings(last_inbound_trace_id);

    CREATE TABLE IF NOT EXISTS person_identities (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS im_external_identities (
      id TEXT PRIMARY KEY,
      person_id TEXT,
      transport_id TEXT NOT NULL,
      transport_account_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT '',
      external_user_id TEXT NOT NULL,
      external_display_name TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (person_id) REFERENCES person_identities(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_im_external_identity_unique
      ON im_external_identities(transport_id, transport_account_id, tenant_id, external_user_id);
    CREATE INDEX IF NOT EXISTS idx_im_external_identity_person
      ON im_external_identities(person_id);

    CREATE TABLE IF NOT EXISTS im_inbound_events (
      id TEXT PRIMARY KEY,
      im_trace_id TEXT NOT NULL UNIQUE,
      dedupe_key TEXT NOT NULL UNIQUE,
      transport_id TEXT NOT NULL,
      transport_account_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      binding_id TEXT NOT NULL,
      person_id TEXT,
      session_scope TEXT,
      routing_key TEXT NOT NULL,
      message_type TEXT NOT NULL,
      status TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      error TEXT,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (binding_id) REFERENCES conversation_bindings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_im_inbound_events_transport_received
      ON im_inbound_events(transport_id, transport_account_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_im_inbound_events_conversation_received
      ON im_inbound_events(conversation_id, received_at DESC);
  `)
}

export function migrateDoctorTerminologySchemaV8(db: Database.Database): void {
  addColumnIfMissing(db, 'delivery_records', 'doctor_trace_id', 'TEXT')

  if (hasColumn(db, 'delivery_records', 'diagnostic_trace_id')) {
    db.exec(`
      UPDATE delivery_records
      SET doctor_trace_id = diagnostic_trace_id
      WHERE doctor_trace_id IS NULL
        AND diagnostic_trace_id IS NOT NULL
    `)
  }
}

export function migrateThreadPlanStateSchemaV9(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_plan_states (
      thread_id TEXT PRIMARY KEY,
      conversation_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      active_run_id TEXT,
      source_tool_call_id TEXT,
      items_json TEXT NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (active_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_thread_plan_states_conversation
      ON thread_plan_states(conversation_id);
  `)
}

export function migrateThreadPlanStateClosedSchemaV10(db: Database.Database): void {
  addColumnIfMissing(db, 'thread_plan_states', 'closed', 'INTEGER NOT NULL DEFAULT 0')
}

/** Prefer message binding, then conversation active binding, then oldest binding in thread. */
const resolveConversationMessageThreadIdSql = (
  messageRef: string,
  conversationRef?: string
): string => {
  const byMessageBinding = `(SELECT external_chat_id FROM conversation_bindings WHERE id = ${messageRef}.binding_id LIMIT 1)`
  const byActiveBinding = conversationRef
    ? `(SELECT external_chat_id FROM conversation_bindings WHERE id = ${conversationRef}.active_binding_id LIMIT 1)`
    : null
  const byConversation = `(SELECT external_chat_id FROM conversation_bindings WHERE conversation_id = ${messageRef}.conversation_id ORDER BY created_at ASC LIMIT 1)`

  return `COALESCE(${[byMessageBinding, byActiveBinding, byConversation, `${messageRef}.conversation_id`].filter(Boolean).join(', ')})`
}

export function migrateConversationMessageBindingColumnsV11(db: Database.Database): void {
  addColumnIfMissing(db, 'conversations', 'active_binding_id', 'TEXT')
  addColumnIfMissing(db, 'conversation_messages', 'binding_id', 'TEXT')
  addColumnIfMissing(db, 'conversation_messages', 'external_message_id', 'TEXT')
}

export function initConversationSearchFtsSchema(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_message_search_fts USING fts5(
      message_id UNINDEXED,
      conversation_id UNINDEXED,
      thread_id UNINDEXED,
      role UNINDEXED,
      title,
      workspace_path UNINDEXED,
      text,
      created_at UNINDEXED,
      tokenize = 'trigram'
    );

    CREATE TRIGGER IF NOT EXISTS trg_conversation_messages_search_ai
    AFTER INSERT ON conversation_messages
    BEGIN
      INSERT INTO conversation_message_search_fts (
        message_id,
        conversation_id,
        thread_id,
        role,
        title,
        workspace_path,
        text,
        created_at
      )
      SELECT
        NEW.id,
        NEW.conversation_id,
        ${resolveConversationMessageThreadIdSql('NEW')},
        NEW.role,
        COALESCE((SELECT title FROM conversations WHERE id = NEW.conversation_id), ''),
        COALESCE((SELECT workspace_id FROM conversations WHERE id = NEW.conversation_id), ''),
        COALESCE(NEW.text, ''),
        NEW.created_at;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_conversation_messages_search_au
    AFTER UPDATE OF binding_id, role, text, created_at ON conversation_messages
    BEGIN
      DELETE FROM conversation_message_search_fts WHERE message_id = OLD.id;
      INSERT INTO conversation_message_search_fts (
        message_id,
        conversation_id,
        thread_id,
        role,
        title,
        workspace_path,
        text,
        created_at
      )
      SELECT
        NEW.id,
        NEW.conversation_id,
        ${resolveConversationMessageThreadIdSql('NEW')},
        NEW.role,
        COALESCE((SELECT title FROM conversations WHERE id = NEW.conversation_id), ''),
        COALESCE((SELECT workspace_id FROM conversations WHERE id = NEW.conversation_id), ''),
        COALESCE(NEW.text, ''),
        NEW.created_at;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_conversation_messages_search_ad
    AFTER DELETE ON conversation_messages
    BEGIN
      DELETE FROM conversation_message_search_fts WHERE message_id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_conversations_search_au
    AFTER UPDATE OF title, workspace_id ON conversations
    BEGIN
      DELETE FROM conversation_message_search_fts WHERE conversation_id = NEW.id;
      INSERT INTO conversation_message_search_fts (
        message_id,
        conversation_id,
        thread_id,
        role,
        title,
        workspace_path,
        text,
        created_at
      )
      SELECT
        conv_msg.id,
        conv_msg.conversation_id,
        ${resolveConversationMessageThreadIdSql('conv_msg', 'conversation')},
        conv_msg.role,
        COALESCE(NEW.title, ''),
        COALESCE(NEW.workspace_id, ''),
        COALESCE(conv_msg.text, ''),
        conv_msg.created_at
      FROM conversation_messages conv_msg
      INNER JOIN conversations conversation
        ON conversation.id = conv_msg.conversation_id
      WHERE conv_msg.conversation_id = NEW.id;
    END;
  `)

  db.exec(`DELETE FROM conversation_message_search_fts`)
  db.exec(`
    INSERT INTO conversation_message_search_fts (
      message_id,
      conversation_id,
      thread_id,
      role,
      title,
      workspace_path,
      text,
      created_at
    )
    SELECT
      conv_msg.id,
      conv_msg.conversation_id,
      ${resolveConversationMessageThreadIdSql('conv_msg', 'conversation')},
      conv_msg.role,
      COALESCE(conversation.title, ''),
      COALESCE(conversation.workspace_id, ''),
      COALESCE(conv_msg.text, ''),
      conv_msg.created_at
    FROM conversation_messages conv_msg
    INNER JOIN conversations conversation
      ON conversation.id = conv_msg.conversation_id;
  `)
}

export function migrateConversationSearchFtsSchemaV11(db: Database.Database): void {
  if (!hasTable(db, 'conversations') || !hasTable(db, 'conversation_messages')) {
    return
  }

  migrateConversationMessageBindingColumnsV11(db)
  initConversationSearchFtsSchema(db)
}

export function migrateAgentRunProjectionSchemaV7(db: Database.Database): void {
  initAgentRunProjectionSchema(db)

  db.exec(`
    INSERT INTO agent_run_projections (
      run_id,
      projection_text,
      projection_turns_json,
      updated_at
    )
    SELECT
      event_log.aggregate_id,
      COALESCE(json_extract(event_log.payload_json, '$.projectionText'), ''),
      COALESCE(json_extract(event_log.payload_json, '$.projectionTurns'), '[]'),
      event_log.created_at
    FROM event_log
    INNER JOIN agent_runs
      ON agent_runs.id = event_log.aggregate_id
    INNER JOIN (
      SELECT aggregate_id, MAX(sequence) AS sequence
      FROM event_log
      WHERE event_type = 'agent.run.upserted'
        AND aggregate_type = 'agent_run'
        AND json_valid(payload_json)
      GROUP BY aggregate_id
    ) latest
      ON latest.aggregate_id = event_log.aggregate_id
      AND latest.sequence = event_log.sequence
    WHERE event_log.event_type = 'agent.run.upserted'
      AND event_log.aggregate_type = 'agent_run'
      AND json_valid(event_log.payload_json)
    ON CONFLICT(run_id) DO UPDATE SET
      projection_text = excluded.projection_text,
      projection_turns_json = excluded.projection_turns_json,
      updated_at = excluded.updated_at;
  `)
}
