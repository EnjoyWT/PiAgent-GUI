import type { SubagentPanelEvent, SubagentPanelWorker } from '../../shared/subagent-panel.ts'
import type { SubagentStore } from './subagent-store.ts'
import type { SubagentEvent } from './subagent-types.ts'

export type BuildSubagentPanelSetEventInput = {
  store: SubagentStore
  groupId: string
}

export const buildSubagentPanelSetEvent = (
  input: BuildSubagentPanelSetEventInput
): Extract<SubagentPanelEvent, { type: 'set' }> => {
  const group = input.store.getGroup(input.groupId)
  if (!group) throw new Error(`Unknown subagent group: ${input.groupId}`)

  const events = input.store.listEventsByGroup(group.id)
  const revision = events.at(-1)?.groupEventSeq ?? 0
  const updatedAt = events.at(-1)?.createdAt ?? group.settledAt ?? group.startedAt ?? group.createdAt
  const latestProgressByTaskId = buildLatestProgressByTaskId(events)
  const tasks = input.store.listTasksByGroup(group.id)

  return {
    type: 'set',
    state: {
      threadId: group.parentConversationId,
      revision,
      updatedAt,
      group: {
        groupId: group.id,
        parentRunId: group.parentRunId,
        parentToolCallId: group.parentToolCallId,
        status: group.status,
        revision,
        createdAt: group.createdAt,
        startedAt: group.startedAt ?? null,
        settledAt: group.settledAt ?? null,
        workers: tasks.map((task): SubagentPanelWorker => {
          const progress = latestProgressByTaskId.get(task.id) ?? null
          return {
            taskId: task.id,
            title: task.label || task.instruction,
            status: task.status,
            attemptId: task.currentAttemptId ?? null,
            retryCount: task.retryCount,
            latestProgress: progress,
            resultSummary: task.resultSummary ?? null,
            error: task.error ?? null,
            startedAt: task.startedAt ?? null,
            settledAt: task.settledAt ?? null
          }
        })
      }
    }
  }
}

const buildLatestProgressByTaskId = (events: SubagentEvent[]): Map<string, string> => {
  const latest = new Map<string, string>()
  for (const event of events) {
    if (event.kind !== 'progress' || !event.taskId) continue
    const summary = readProgressSummary(event.payload)
    if (summary) latest.set(event.taskId, summary)
  }
  return latest
}

const readProgressSummary = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null
  const summary = (payload as { summary?: unknown }).summary
  if (typeof summary !== 'string') return null
  const trimmed = summary.trim()
  return trimmed || null
}

