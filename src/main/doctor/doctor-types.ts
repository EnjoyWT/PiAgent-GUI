import type { TransportAccountRuntimeState } from '../transport/transport-contract.ts'

export type DoctorStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown'

export type DoctorDomainInfo = {
  domainId: string
  displayName: string
}

export type DoctorComponentResult = {
  domain: string
  componentId: string
  displayName: string
  status: DoctorStatus
  stage?: string | null
  summary: string
  error?: string | null
  lastCheckedAt?: string | null
  metadata?: Record<string, unknown>
}

export type DoctorDomainSummary = {
  domain: string
  status: DoctorStatus
  summary: string
  componentCount: number
  healthyCount: number
  degradedCount: number
  unavailableCount: number
  unknownCount: number
}

export type TransportAccountStatus = {
  transportId: string
  accountId: string
  state: TransportAccountRuntimeState
  error?: string | null
  errorCode?: string | null
  lastAttemptAt?: string | null
  lastSuccessAt?: string | null
  lastFailureAt?: string | null
  updatedAt?: string | null
}
