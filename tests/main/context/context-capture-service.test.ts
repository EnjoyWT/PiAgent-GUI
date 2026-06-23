import test from 'node:test'
import assert from 'node:assert/strict'
import { ContextStore } from '../../../src/main/context/context-store.ts'
import { ContextCaptureService } from '../../../src/main/context/context-capture-service.ts'
import { createContextTestDb, insertThread } from './test-helpers.ts'
import type { AgentRunProjection } from '../../../src/shared/agent-runtime.ts'

test('ContextCaptureService captures consumed user message and finalized run summaries', async () => {
  const db = createContextTestDb()
  insertThread(db, 'thread-1')
  const store = new ContextStore(db)
  const capture = new ContextCaptureService(store)

  await capture.captureConsumedUserMessage({
    message: {
      id: 'msg-1',
      thread_id: 'thread-1',
      role: 'user',
      message_kind: 'chat',
      include_in_agent_context: 1,
      content: 'Fix the failing tests',
      content_json: null,
      agent_run_id: 'run-1',
      submission_id: 'sub-1',
      agent_entry_id: null,
      agent_turn_id: null,
      tool_call_id: null,
      step_index: null,
      runtime_sequence: 1,
      created_at: '2026-04-16 10:00:00.000'
    }
  })

  const run: AgentRunProjection = {
    threadId: 'thread-1',
    agentRunId: 'run-1',
    status: 'done',
    startedAt: 1,
    endedAt: 2,
    turns: [],
    messages: [],
    toolCalls: [
      {
        toolCallId: 'tool-1',
        agentTurnId: 'turn-1',
        name: 'bash',
        kind: 'tool',
        invocation: 'direct',
        status: 'done',
        summary: 'pytest failed in tests/main/context',
        startedAt: 1,
        endedAt: 1.5,
        origin: 'runtime'
      }
    ],
    text: 'I found the failure and will patch it next.',
    termination: {
      kind: 'success',
      at: 2
    }
  }

  await capture.captureFinalizedRun({ threadId: 'thread-1', run })

  const entries = store.listEntries('thread-1')
  assert.equal(entries.length, 3)
  assert.deepEqual(
    entries.map((entry) => entry.semanticKind),
    ['user_message', 'tool_result_summary', 'assistant_message']
  )
})
