import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'piagent',
  'core-v2.db'
)

const usage = () => {
  console.log(`Usage:
  node scripts/queue-history-check/verify-consumed-user-messages.mjs [options]

Options:
  --db <path>            Override core-v2.db path
  --thread <threadId>    Check a specific thread id
  --workspace <path>     Check latest thread under a workspace path
  --latest               Check latest thread overall
  --limit <n>            Number of latest threads to scan when no thread/workspace is given
`)
}

const parseArgs = (argv) => {
  const args = {
    dbPath: DEFAULT_DB_PATH,
    threadId: '',
    workspacePath: '',
    latest: false,
    limit: 5
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--db') args.dbPath = argv[++i] ?? args.dbPath
    else if (arg === '--thread') args.threadId = argv[++i] ?? ''
    else if (arg === '--workspace') args.workspacePath = argv[++i] ?? ''
    else if (arg === '--latest') args.latest = true
    else if (arg === '--limit') args.limit = Number.parseInt(argv[++i] ?? '5', 10) || 5
    else if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
  }

  return args
}

const normalizeText = (text) =>
  String(text ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
const sqlQuote = (value) => `'${String(value).replace(/'/g, "''")}'`
const asRecord = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

const parseCreatedAtMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

const formatCreatedAt = (value) => {
  const ms = parseCreatedAtMs(value)
  if (ms == null) return String(value ?? 'unknown time')
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

const extractPayload = (payloadJson) => {
  const outer = asRecord(JSON.parse(payloadJson))
  return asRecord(outer?.payload) ?? outer
}

const runSql = (dbPath, sql) => {
  const output = execFileSync('sqlite3', ['-json', dbPath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
  return output ? JSON.parse(output) : []
}

const parseUserMessageStart = (row) => {
  try {
    const payload = extractPayload(row.payload_json)
    if (payload?.rawType && payload.rawType !== 'message_start') return null
    if (payload?.role !== 'user') return null
    const parts = Array.isArray(payload?.message?.content) ? payload.message.content : []
    const text = parts
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
    const normalized = normalizeText(text)
    if (!normalized) return null
    return {
      eventId: row.id,
      agentRunId: row.agent_run_id,
      createdAt: row.created_at,
      text: normalized
    }
  } catch {
    return null
  }
}

const args = parseArgs(process.argv.slice(2))

const resolveThreads = () => {
  const baseSelect = `
    SELECT
      b.external_chat_id AS id,
      c.id AS conversation_id,
      c.title AS title,
      c.workspace_id AS workspace_path,
      c.created_at AS created_at
    FROM conversation_bindings b
    JOIN conversations c ON c.id = b.conversation_id
    WHERE b.transport_id = 'desktop-chat'
      AND COALESCE(c.desktop_visibility_mode, 'read_write') != 'hidden'
  `

  if (args.threadId) {
    return runSql(
      args.dbPath,
      `
        ${baseSelect}
          AND b.external_chat_id = ${sqlQuote(args.threadId)}
        ORDER BY c.created_at DESC, b.external_chat_id DESC
      `
    )
  }

  if (args.workspacePath) {
    return runSql(
      args.dbPath,
      `
        ${baseSelect}
          AND c.workspace_id = ${sqlQuote(args.workspacePath)}
        ORDER BY c.created_at DESC, b.external_chat_id DESC
        LIMIT 1
      `
    )
  }

  if (args.latest) {
    return runSql(
      args.dbPath,
      `
        ${baseSelect}
        ORDER BY c.created_at DESC, b.external_chat_id DESC
        LIMIT 1
      `
    )
  }

  return runSql(
    args.dbPath,
    `
      ${baseSelect}
      ORDER BY c.created_at DESC, b.external_chat_id DESC
      LIMIT ${Math.max(1, args.limit)}
    `
  )
}

const threads = resolveThreads()

if (threads.length === 0) {
  console.error('No matching thread found.')
  process.exit(1)
}

let hasMismatch = false

for (const thread of threads) {
  const eventRows = runSql(
    args.dbPath,
    `
      SELECT
        id,
        COALESCE(
          json_extract(payload_json, '$.localThread.agentRunId'),
          json_extract(payload_json, '$.runtime.coreAgentRunId'),
          CASE WHEN aggregate_type = 'agent_run' THEN aggregate_id ELSE NULL END
        ) AS agent_run_id,
        payload_json,
        created_at
      FROM event_log
      WHERE event_type = 'agentMessageStarted'
        AND (
          (aggregate_type = 'conversation' AND aggregate_id = ${sqlQuote(thread.conversation_id)})
          OR (
            aggregate_type = 'agent_run'
            AND aggregate_id IN (
              SELECT id FROM agent_runs WHERE conversation_id = ${sqlQuote(thread.conversation_id)}
            )
          )
          OR json_extract(payload_json, '$.localThread.threadId') = ${sqlQuote(thread.id)}
          OR json_extract(payload_json, '$.runtime.conversationId') = ${sqlQuote(thread.conversation_id)}
        )
      ORDER BY sequence ASC, created_at ASC
    `
  )
  const messageRows = runSql(
    args.dbPath,
    `
      SELECT
        COALESCE(external_message_id, id) AS id,
        COALESCE(text, '') AS content,
        created_at,
        json_extract(payload_json, '$.localThread.agentRunId') AS agent_run_id
      FROM conversation_messages
      WHERE conversation_id = ${sqlQuote(thread.conversation_id)}
        AND role = 'user'
      ORDER BY created_at ASC, COALESCE(external_message_id, id) ASC
    `
  )

  const userStarts = eventRows.map(parseUserMessageStart).filter(Boolean)
  const persistedCounts = new Map()
  for (const row of messageRows) {
    const key = normalizeText(row.content)
    persistedCounts.set(key, (persistedCounts.get(key) ?? 0) + 1)
  }

  const consumedCounts = new Map()
  const missing = []

  for (const event of userStarts) {
    const nextConsumed = (consumedCounts.get(event.text) ?? 0) + 1
    consumedCounts.set(event.text, nextConsumed)
    const persisted = persistedCounts.get(event.text) ?? 0
    if (nextConsumed > persisted) {
      missing.push(event)
    }
  }

  console.log(`\n=== ${thread.id}  ${thread.title || '(untitled)'}  ${thread.workspace_path} ===`)
  console.log(`user message_start events: ${userStarts.length}`)
  console.log(`persisted user messages:   ${messageRows.length}`)

  if (missing.length === 0) {
    console.log('OK: no consumed user messages are missing from history.')
    continue
  }

  hasMismatch = true
  console.log(
    `MISSING: ${missing.length} consumed user message(s) not found in conversation_messages:`
  )
  for (const item of missing) {
    const localTime = formatCreatedAt(item.createdAt)
    console.log(
      `- [${localTime}] run=${item.agentRunId ?? 'n/a'} text=${JSON.stringify(item.text)}`
    )
  }
}

process.exit(hasMismatch ? 2 : 0)
