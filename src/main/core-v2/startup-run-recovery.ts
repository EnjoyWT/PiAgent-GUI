import type { AgentRun, CoreCommandService, CoreQueryService } from './domain.ts'
import { normalizeCoreTimestamp } from './time.ts'

const INTERRUPTED_RUN_STATUSES: AgentRun['status'][] = [
  'requested',
  'running',
  'waiting_interaction'
]

const isInterruptedRunStatus = (status: AgentRun['status']): boolean =>
  INTERRUPTED_RUN_STATUSES.includes(status)

export type StartupRunRecoveryResult = {
  recoveredAt: string
  abortedRunIds: string[]
  cancelledInteractionIds: string[]
}

export const reconcileInterruptedRunsOnStartup = (
  core: CoreCommandService & CoreQueryService,
  options?: { recoveredAt?: string | number | Date | null }
): StartupRunRecoveryResult => {
  const recoveredAt = normalizeCoreTimestamp(options?.recoveredAt)
  const interruptedRuns = core
    .listConversationWindows('all')
    .flatMap((window) => core.listConversationRuns(window.conversationId))
    .filter((run) => isInterruptedRunStatus(run.status))

  const abortedRunIds: string[] = []
  for (const run of interruptedRuns) {
    core.upsertAgentRun({
      id: run.id,
      conversationId: run.conversationId,
      instanceId: run.instanceId ?? null,
      triggerKind: run.triggerKind,
      requestedExecutionPolicy: run.requestedExecutionPolicy,
      effectiveExecutionSnapshot: run.effectiveExecutionSnapshot,
      status: 'aborted',
      traceId: run.traceId,
      startedAt: run.startedAt,
      endedAt: run.endedAt ?? recoveredAt
    })
    abortedRunIds.push(run.id)
  }

  const interruptedRunIds = new Set(abortedRunIds)
  const cancelledInteractionIds: string[] = []
  if (interruptedRunIds.size > 0) {
    for (const interaction of core.listPendingInteractions()) {
      if (!interaction.runId || !interruptedRunIds.has(interaction.runId)) continue
      core.cancelInteraction({
        interactionId: interaction.id,
        cancelledAt: recoveredAt
      })
      cancelledInteractionIds.push(interaction.id)
    }
  }

  return {
    recoveredAt,
    abortedRunIds,
    cancelledInteractionIds
  }
}
