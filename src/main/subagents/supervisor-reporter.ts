import type { SubagentStore } from './subagent-store.ts'
import type { SubagentEvent, SubagentTask, SubagentTaskGroup } from './subagent-types.ts'

export type BuildSupervisorReportInput = {
  groupId: string
  afterEventSeq?: number
}

export type SupervisorTaskSnapshot = Pick<
  SubagentTask,
  'id' | 'label' | 'instruction' | 'status' | 'currentAttemptId' | 'resultSummary' | 'error'
>

export type SupervisorGroupReport = {
  groupId: string
  groupStatus: SubagentTaskGroup['status']
  nextCursor: number
  tasks: SupervisorTaskSnapshot[]
  events: SubagentEvent[]
  markdown: string
}

export type SupervisorReporterOptions = {
  store: SubagentStore
}

export class SupervisorReporter {
  constructor(private readonly options: SupervisorReporterOptions) {}

  buildGroupReport(input: BuildSupervisorReportInput): SupervisorGroupReport {
    const group = this.options.store.getGroup(input.groupId)
    if (!group) throw new Error(`Unknown subagent group: ${input.groupId}`)

    const afterEventSeq = Math.max(0, Math.trunc(input.afterEventSeq ?? 0))
    const tasks = this.options.store
      .listTasksByGroup(group.id)
      .map(toTaskSnapshot)
      .sort((left, right) => left.id.localeCompare(right.id))
    const events = this.options.store
      .listEventsByGroup(group.id)
      .filter((event) => event.groupEventSeq > afterEventSeq)
      .sort((left, right) => left.groupEventSeq - right.groupEventSeq)
    const nextCursor =
      events.length > 0
        ? events[events.length - 1]!.groupEventSeq
        : afterEventSeq

    return {
      groupId: group.id,
      groupStatus: group.status,
      nextCursor,
      tasks,
      events,
      markdown: renderMarkdown(group, tasks, events, nextCursor)
    }
  }
}

const toTaskSnapshot = (task: SubagentTask): SupervisorTaskSnapshot => ({
  id: task.id,
  label: task.label ?? null,
  instruction: task.instruction,
  status: task.status,
  currentAttemptId: task.currentAttemptId ?? null,
  resultSummary: task.resultSummary ?? null,
  error: task.error ?? null
})

const renderMarkdown = (
  group: SubagentTaskGroup,
  tasks: SupervisorTaskSnapshot[],
  events: SubagentEvent[],
  nextCursor: number
): string => [
  `# Subagent Group ${group.id}`,
  '',
  `Status: ${group.status}`,
  `Parent run: ${group.parentRunId}`,
  `Next cursor: ${nextCursor}`,
  '',
  '## Tasks',
  ...tasks.map(renderTaskLine),
  '',
  '## Events',
  ...(events.length > 0 ? events.map(renderEventLine) : ['- No new events.'])
].join('\n')

const renderTaskLine = (task: SupervisorTaskSnapshot): string => {
  const label = task.label ? ` ${task.label}` : ''
  const suffix = task.error ? ` error="${task.error}"` : task.resultSummary ? ` summary="${task.resultSummary}"` : ''
  return `- ${task.id}${label}: ${task.status}${suffix}`
}

const renderEventLine = (event: SubagentEvent): string => {
  const summary = summarizePayload(event.payload)
  return `- #${event.groupEventSeq} ${event.kind}${event.taskId ? ` task=${event.taskId}` : ''}: ${summary}`
}

const summarizePayload = (payload: unknown): string => {
  if (isRecord(payload) && typeof payload.summary === 'string') {
    return payload.summary
  }
  if (typeof payload === 'string') {
    return payload
  }
  return JSON.stringify(payload)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
