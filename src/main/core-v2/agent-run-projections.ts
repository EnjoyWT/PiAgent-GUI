import type { AgentToolCallProjection, AgentTurnProjection } from '../../shared/agent-runtime.ts'

export type TransportSetupQrModelNotificationStatus = Extract<
  NonNullable<NonNullable<AgentToolCallProjection['accountSetupQr']>['status']>,
  'completed' | 'expired' | 'cancelled' | 'failed'
>

export type AgentRunProjectionPayload = {
  runId: string
  projectionText: string
  projectionTurns: unknown[]
  updatedAt: string
}

export type UpdateAgentRunProjectionTransportSetupQrInput = {
  sessionId: string
  status: NonNullable<NonNullable<AgentToolCallProjection['accountSetupQr']>['status']>
  transportId?: string | null
  accountId?: string | null
  methodId?: string | null
  imageUrl?: string | null
  qrText?: string | null
  expiresAt?: string | null
  updatedAt?: string | number | Date | null
}

export type ClaimAgentRunProjectionTransportSetupQrModelNotificationInput = {
  sessionId: string
  status: TransportSetupQrModelNotificationStatus
  transportId?: string | null
  accountId?: string | null
  methodId?: string | null
  updatedAt?: string | number | Date | null
}

export type ClaimedAgentRunProjectionTransportSetupQrModelNotification = {
  runId: string
  conversationId: string
  sessionId: string
  status: TransportSetupQrModelNotificationStatus
  transportId?: string | null
  accountId?: string | null
  methodId?: string | null
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

export const normalizeProjectionTurns = (
  value: unknown[] | string | null | undefined
): unknown[] => {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

const cloneProjectionTurns = (turns: unknown[]): unknown[] => {
  try {
    return JSON.parse(JSON.stringify(turns)) as unknown[]
  } catch {
    return []
  }
}

const matchesTransportSetupQr = (
  qr: Record<string, unknown>,
  input:
    | UpdateAgentRunProjectionTransportSetupQrInput
    | ClaimAgentRunProjectionTransportSetupQrModelNotificationInput
): boolean => {
  if (asString(qr.sessionId).trim() !== input.sessionId.trim()) return false
  if (input.transportId && asString(qr.transportId).trim() !== input.transportId.trim()) {
    return false
  }
  if (input.accountId && asString(qr.accountId).trim() !== input.accountId.trim()) return false
  if (input.methodId && asString(qr.methodId).trim() !== input.methodId.trim()) return false
  return true
}

export const updateTransportSetupQrInProjectionTurns = (
  value: unknown[] | string | null | undefined,
  input: UpdateAgentRunProjectionTransportSetupQrInput
): { changed: boolean; projectionTurns: unknown[] } => {
  const sessionId = input.sessionId.trim()
  if (!sessionId) return { changed: false, projectionTurns: normalizeProjectionTurns(value) }

  const projectionTurns = cloneProjectionTurns(normalizeProjectionTurns(value))
  let changed = false

  for (const turnValue of projectionTurns) {
    const turn = asRecord(turnValue) as
      | (Partial<AgentTurnProjection> & Record<string, unknown>)
      | null
    const toolCalls = Array.isArray(turn?.toolCalls) ? turn.toolCalls : []
    for (const toolValue of toolCalls) {
      const tool = asRecord(toolValue)
      const qr = asRecord(tool?.accountSetupQr)
      if (!tool || !qr || !matchesTransportSetupQr(qr, input)) continue

      tool.accountSetupQr = {
        ...qr,
        status: input.status,
        imageUrl: input.imageUrl?.trim() || asString(qr.imageUrl),
        qrText: input.qrText?.trim() || asString(qr.qrText) || undefined,
        expiresAt: input.expiresAt?.trim() || asString(qr.expiresAt) || undefined
      }
      changed = true
    }
  }

  return { changed, projectionTurns }
}

const getModelNotifiedStatuses = (qr: Record<string, unknown>): string[] => {
  const statuses = qr.modelNotifiedStatuses
  if (!Array.isArray(statuses)) return []
  return statuses
    .map((status) => asString(status).trim())
    .filter((status) => status.length > 0)
}

export const claimTransportSetupQrModelNotificationInProjectionTurns = (
  value: unknown[] | string | null | undefined,
  input: ClaimAgentRunProjectionTransportSetupQrModelNotificationInput
): { changed: boolean; projectionTurns: unknown[] } => {
  const sessionId = input.sessionId.trim()
  if (!sessionId) return { changed: false, projectionTurns: normalizeProjectionTurns(value) }

  const projectionTurns = cloneProjectionTurns(normalizeProjectionTurns(value))
  let changed = false

  for (const turnValue of projectionTurns) {
    const turn = asRecord(turnValue) as
      | (Partial<AgentTurnProjection> & Record<string, unknown>)
      | null
    const toolCalls = Array.isArray(turn?.toolCalls) ? turn.toolCalls : []
    for (const toolValue of toolCalls) {
      const tool = asRecord(toolValue)
      const qr = asRecord(tool?.accountSetupQr)
      if (!tool || !qr || !matchesTransportSetupQr(qr, input)) continue

      const notifiedStatuses = getModelNotifiedStatuses(qr)
      if (notifiedStatuses.includes(input.status)) continue

      tool.accountSetupQr = {
        ...qr,
        modelNotifiedStatuses: [...notifiedStatuses, input.status]
      }
      changed = true
    }
  }

  return { changed, projectionTurns }
}
