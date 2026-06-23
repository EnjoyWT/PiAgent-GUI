---
name: chat-queue-debug
description: Debug swallowed queued chat messages, missing user messages in thread history, and mismatches between runtime events, agent_runs, and conversation_messages in PiAgent. Use when a queued item becomes submitted then disappears, the UI shows no user message, or the model response looks detached from the visible conversation.
allowed-tools:
  - Bash
  - Read
---

# Chat Queue Debug

Use this skill when PiAgent chat history and runtime behavior disagree.

Target symptom examples:

- A queued item becomes unavailable, then disappears.
- The conversation flow has no matching user message.
- The model replied, but the triggering user turn is missing from UI history.
- `conversation_messages`, `agent_runs`, and `event_log` disagree for one local desktop thread.

Default DB path on macOS:

```bash
DB="$HOME/Library/Application Support/piagent/core-v2.db"
```

## Fast Path

1. Resolve the local thread to its `conversation_id`.
2. Compare persisted `conversation_messages` with runtime-consumed user `message_start` events.
3. Inspect the suspect run's `agentRunFinished` payload and `agent_runs.projection_turns_json`.
4. Map the mismatch to the responsible layer.

## 1. Locate the Thread

Prefer workspace-first lookup so you do not debug the wrong local desktop thread.

```bash
sqlite3 "$DB" ".headers on" ".mode column" \
  "SELECT b.external_chat_id AS thread_id,
          c.id AS conversation_id,
          c.workspace_id,
          c.title,
          c.created_at,
          c.updated_at
   FROM conversation_bindings b
   JOIN conversations c ON c.id = b.conversation_id
   WHERE b.transport_id = 'desktop-chat'
     AND c.workspace_id = '/path/to/workspace'
     AND c.desktop_visibility_mode != 'hidden'
   ORDER BY datetime(c.created_at) DESC;"
```

If the title may differ slightly, search fuzzily:

```bash
sqlite3 "$DB" ".headers on" ".mode column" \
  "SELECT b.external_chat_id AS thread_id,
          c.id AS conversation_id,
          c.workspace_id,
          c.title,
          c.created_at
   FROM conversation_bindings b
   JOIN conversations c ON c.id = b.conversation_id
   WHERE b.transport_id = 'desktop-chat'
     AND c.workspace_id = '/path/to/workspace'
     AND c.title LIKE '%工具列表%'
     AND c.desktop_visibility_mode != 'hidden'
   ORDER BY datetime(c.created_at) DESC;"
```

## 2. Run the Mismatch Checker First

This repository already contains a purpose-built checker:

```bash
node scripts/queue-history-check/verify-consumed-user-messages.mjs \
  --workspace /path/to/workspace
```

Interpretation:

- `OK` means consumed user messages and persisted user chat rows match.
- `MISSING` means runtime consumed at least one user message that never reached `conversation_messages`.
- The reported `run=<id>` is the first run to inspect next.

## 3. Inspect Persisted Chat History

```bash
THREAD_ID="<thread-id>"
CONVERSATION_ID="$(sqlite3 "$DB" \
  "SELECT conversation_id
   FROM conversation_bindings
   WHERE transport_id = 'desktop-chat'
     AND external_chat_id = '$THREAD_ID'
   LIMIT 1;")"

sqlite3 "$DB" ".headers on" ".mode column" \
  "SELECT COALESCE(external_message_id, id) AS message_id,
          role,
          json_extract(payload_json, '$.localThread.messageKind') AS message_kind,
          json_extract(payload_json, '$.localThread.includeInAgentContext') AS include_in_agent_context,
          json_extract(payload_json, '$.localThread.agentRunId') AS agent_run_id,
          created_at,
          substr(replace(COALESCE(text, ''), char(10), ' '), 1, 120) AS content_preview
   FROM conversation_messages
   WHERE conversation_id = '$CONVERSATION_ID'
   ORDER BY datetime(created_at) ASC, COALESCE(external_message_id, id) ASC;"
```

This tells you what the UI can actually recover on reload.

Important:

- Thread window reconstruction reads `core-v2.conversation_messages`, `core-v2.agent_runs`, and `core-v2.event_log`.
- If a user turn is missing from `conversation_messages`, the UI cannot recover it from ordinary reload alone.

Relevant code:

- [src/main/core-v2/local-thread-host.ts](<piagent-repo>/src/main/core-v2/local-thread-host.ts)
- [src/main/core-v2/local-thread-read-model.ts](<piagent-repo>/src/main/core-v2/local-thread-read-model.ts)

## 4. Inspect Runs

```bash
sqlite3 "$DB" ".headers on" ".mode column" \
  "SELECT id, status, length(projection_text) AS text_len, started_at, ended_at,
          substr(projection_text, 1, 120) AS text_preview
   FROM agent_runs
   WHERE conversation_id = '$CONVERSATION_ID'
   ORDER BY datetime(started_at) ASC;"
```

For a suspect run:

```bash
RUN_ID="<run-id>"

sqlite3 "$DB" ".mode line" \
  "SELECT id, status, projection_text, projection_turns_json
   FROM agent_runs
   WHERE id = '$RUN_ID';"
```

Use this to verify whether the model actually produced a follow-up turn even when UI history looks incomplete.

## 5. Inspect Runtime Event Chronology

All normalized runtime events are persisted in `event_log`.

```bash
sqlite3 "$DB" ".headers on" ".mode column" \
  "SELECT event_type, aggregate_type, aggregate_id, sequence, created_at,
          substr(replace(payload_json, char(10), ' '), 1, 160) AS payload_preview
   FROM event_log
   WHERE (aggregate_type = 'conversation' AND aggregate_id = '$CONVERSATION_ID')
      OR (aggregate_type = 'agent_run'
          AND aggregate_id IN (SELECT id FROM agent_runs WHERE conversation_id = '$CONVERSATION_ID'))
      OR json_extract(payload_json, '$.runtime.conversationId') = '$CONVERSATION_ID'
      OR json_extract(payload_json, '$.localThread.threadId') = '$THREAD_ID'
   ORDER BY sequence ASC
   LIMIT 120;"
```

For the suspect run:

```bash
sqlite3 "$DB" ".headers on" ".mode column" \
  "SELECT event_type, sequence, created_at,
          substr(replace(payload_json, char(10), ' '), 1, 180) AS payload
   FROM event_log
   WHERE aggregate_id = '$RUN_ID'
      OR json_extract(payload_json, '$.runtime.coreAgentRunId') = '$RUN_ID'
      OR json_extract(payload_json, '$.localThread.agentRunId') = '$RUN_ID'
   ORDER BY sequence ASC;"
```

If needed, inspect the final aggregated payload:

```bash
sqlite3 "$DB" ".mode line" \
  "SELECT payload_json
   FROM event_log
   WHERE event_type = 'agentRunFinished'
     AND (
       aggregate_id = '$RUN_ID'
       OR json_extract(payload_json, '$.runtime.coreAgentRunId') = '$RUN_ID'
       OR json_extract(payload_json, '$.localThread.agentRunId') = '$RUN_ID'
     )
   ORDER BY sequence DESC
   LIMIT 1;"
```

## 6. Root Cause Mapping

### Case A: `agent.message.started` for a user exists, but no persisted user message row

Likely meaning:

- Runtime consumed the message.
- The consumed user message was not upserted into `conversation_messages`.
- The assistant may still respond, making the reply appear detached.

Primary code path:

- Runtime consumed-message persistence:
  [src/main/runtime/runtime-event-store.ts](<piagent-repo>/src/main/runtime/runtime-event-store.ts)
- Local desktop message upsert:
  [src/main/core-v2/local-thread-host.ts](<piagent-repo>/src/main/core-v2/local-thread-host.ts)

### Case B: No user `agent.message.started` event exists for the disappeared queue item

Likely meaning:

- The message never entered runtime.
- Check queue state and dispatch branch selection.
- Suspect `runtimeState` / `activeRunId` / `streaming` misclassification or prompt submission failure.

Primary code paths:

- Queue and local dispatch orchestration:
  [src/renderer/src/App.vue](<piagent-repo>/src/renderer/src/App.vue)
- Local message gateway submission:
  [src/main/transport/embedded-gateway.ts](<piagent-repo>/src/main/transport/embedded-gateway.ts)

### Case C: User row exists, no assistant run or assistant output follows

Likely meaning:

- Prompt dispatch failed before runtime produced a run.
- Or the run aborted/failed before generating visible output.

Check:

- `agent_runs`
- `agentRunFailed` / `agentRunAborted`
- renderer fallback assistant error rows in `conversation_messages`

### Case D: Queue item disappears, runtime queue is empty, no events were appended

Likely meaning:

- Frontend queue state mutated locally without a matching runtime consume.
- Check `syncRuntimeQueue`, `removeRuntimeQueueItemByText`, and local queue action handling.

## 7. Minimal Reporting Format

When you finish, report using this structure:

```text
Thread: <thread-id> (<title>)
Symptom: <one line>
Observed:
- persisted user rows: <n>
- runtime user message_start events: <n>
- suspect run: <run-id>
- missing text: "<text>"
Root cause:
- <consumed-message persistence gap / runtime never consumed / dispatch failure / other>
Evidence:
- <1-3 concrete rows or event facts>
```

## 8. Useful One-Liners

Latest visible messages in one local desktop thread:

```bash
sqlite3 "$DB" \
  "SELECT role || ' | ' || created_at || ' | ' || replace(substr(COALESCE(text, ''),1,80), char(10), ' ')
   FROM conversation_messages
   WHERE conversation_id = '$CONVERSATION_ID'
   ORDER BY datetime(created_at) ASC, COALESCE(external_message_id, id) ASC;"
```

Event counts by type:

```bash
sqlite3 "$DB" ".headers on" ".mode column" \
  "SELECT event_type, COUNT(*) AS c
   FROM event_log
   WHERE (aggregate_type = 'conversation' AND aggregate_id = '$CONVERSATION_ID')
      OR (aggregate_type = 'agent_run'
          AND aggregate_id IN (SELECT id FROM agent_runs WHERE conversation_id = '$CONVERSATION_ID'))
   GROUP BY event_type
   ORDER BY c DESC;"
```

Latest event timestamp:

```bash
sqlite3 "$DB" \
  "SELECT max(created_at)
   FROM event_log
   WHERE (aggregate_type = 'conversation' AND aggregate_id = '$CONVERSATION_ID')
      OR (aggregate_type = 'agent_run'
          AND aggregate_id IN (SELECT id FROM agent_runs WHERE conversation_id = '$CONVERSATION_ID'));"
```
