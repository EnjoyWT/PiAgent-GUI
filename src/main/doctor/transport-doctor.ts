import type { DoctorDomain } from './doctor-domain.ts'
import type {
  DoctorComponentResult,
  DoctorDomainSummary,
  DoctorStatus,
  DoctorDomainInfo,
  TransportAccountStatus
} from './doctor-types.ts'
import { deriveConversationSourceKind } from '../core-v2/domain.ts'
import type { ConversationSourceKind } from '../core-v2/domain.ts'
import type { TransportHost, TransportHostStatus } from '../transport/transport-host.ts'

type TransportDoctorMetadata = {
  transportId: string
  conversationSourceKind: ConversationSourceKind
  pluginSourceKind: TransportHostStatus['sourceKind']
  version: string
  accountStatuses: TransportAccountStatus[]
}

export type TransportDoctorOptions = {
  domainId?: string
  displayName?: string
  sourceKind?: ConversationSourceKind | 'all'
}

export class TransportDoctor implements DoctorDomain {
  readonly info: DoctorDomainInfo
  private readonly transportHost: TransportHost
  private readonly sourceKind: ConversationSourceKind | 'all'
  private readonly summaryLabel: string

  constructor(transportHost: TransportHost, options: TransportDoctorOptions = {}) {
    this.transportHost = transportHost
    this.sourceKind = options.sourceKind ?? 'all'
    this.info = {
      domainId: options.domainId ?? 'transport',
      displayName: options.displayName ?? 'Transport'
    }
    this.summaryLabel = this.sourceKind === 'im' ? 'IM transport' : 'transport'
  }

  async listComponents(): Promise<DoctorComponentResult[]> {
    return this.listFilteredStatuses().map((status) => this.buildComponentResult(status))
  }

  async getComponentStatus(componentId: string): Promise<DoctorComponentResult> {
    const status = this.listFilteredStatuses().find(
      (item) => item.pluginId === String(componentId ?? '').trim()
    )
    if (!status) throw new Error(`Transport component not found: ${componentId}`)
    return this.buildComponentResult(status)
  }

  async getSummary(): Promise<DoctorDomainSummary> {
    const components = await this.listComponents()
    if (components.length === 0) {
      return {
        domain: this.info.domainId,
        status: 'unknown',
        summary: `No ${this.summaryLabel} doctor data is available.`,
        componentCount: 0,
        healthyCount: 0,
        degradedCount: 0,
        unavailableCount: 0,
        unknownCount: 0
      }
    }

    const counts: Record<DoctorStatus, number> = {
      healthy: 0,
      degraded: 0,
      unavailable: 0,
      unknown: 0
    }
    for (const component of components) counts[component.status] += 1

    const status: DoctorStatus =
      counts.unavailable === components.length
        ? 'unavailable'
        : counts.healthy === components.length
          ? 'healthy'
          : counts.degraded > 0 || counts.unavailable > 0
            ? 'degraded'
            : 'unknown'

    return {
      domain: this.info.domainId,
      status,
      summary: `${components.length} ${this.summaryLabel}(s): ${counts.healthy} healthy, ${counts.degraded} degraded, ${counts.unavailable} unavailable`,
      componentCount: components.length,
      healthyCount: counts.healthy,
      degradedCount: counts.degraded,
      unavailableCount: counts.unavailable,
      unknownCount: counts.unknown
    }
  }

  private listFilteredStatuses(): TransportHostStatus[] {
    const statuses = this.transportHost.listStatuses()
    if (this.sourceKind === 'all') return statuses
    return statuses.filter(
      (status) => deriveConversationSourceKind(status.pluginId) === this.sourceKind
    )
  }

  private buildComponentResult(status: TransportHostStatus): DoctorComponentResult {
    const accountStatuses = this.transportHost.getAccountStatuses(status.pluginId)
    const doctorStatus = this.resolveStatus(status.state, accountStatuses)
    const stage = this.resolveStage(status.state, accountStatuses)
    const connectedCount = accountStatuses.filter((item) => item.state === 'connected').length
    const problematicAccounts = accountStatuses.filter(
      (item) => item.state === 'retrying' || item.state === 'fatal'
    )
    const retryingCount = accountStatuses.filter((item) => item.state === 'retrying').length
    const fatalCount = accountStatuses.filter((item) => item.state === 'fatal').length
    const connectingCount = accountStatuses.filter((item) => item.state === 'connecting').length
    const disconnectedCount = accountStatuses.filter((item) => item.state === 'disconnected').length

    return {
      domain: this.info.domainId,
      componentId: status.pluginId,
      displayName: status.displayName,
      status: doctorStatus,
      stage,
      summary: this.buildSummary(doctorStatus, {
        stage,
        connectedCount,
        retryingCount,
        fatalCount,
        connectingCount,
        disconnectedCount
      }),
      error: status.error ?? problematicAccounts[0]?.error ?? null,
      lastCheckedAt: this.resolveLastCheckedAt(accountStatuses),
      metadata: {
        transportId: status.pluginId,
        conversationSourceKind: deriveConversationSourceKind(status.pluginId),
        pluginSourceKind: status.sourceKind,
        version: status.version,
        accountStatuses
      } satisfies TransportDoctorMetadata
    }
  }

  private resolveStage(
    pluginState: TransportHostStatus['state'],
    accountStatuses: TransportAccountStatus[]
  ): string {
    if (pluginState === 'failed') return 'activation_failed'
    if (pluginState === 'discovered') return 'discovered'
    if (pluginState === 'deactivated') return 'deactivated'

    const hasConnected = accountStatuses.some((item) => item.state === 'connected')
    const hasRetrying = accountStatuses.some((item) => item.state === 'retrying')
    const hasFatal = accountStatuses.some((item) => item.state === 'fatal')
    const hasConnecting = accountStatuses.some((item) => item.state === 'connecting')
    const hasDisconnected = accountStatuses.some((item) => item.state === 'disconnected')

    if (hasConnected) return 'connected'
    if (hasRetrying) return 'retrying'
    if (hasFatal) return 'fatal'
    if (hasConnecting) return 'connecting'
    if (hasDisconnected) return 'disconnected'
    return 'activated'
  }

  private resolveStatus(
    pluginState: TransportHostStatus['state'],
    accountStatuses: TransportAccountStatus[]
  ): DoctorStatus {
    if (pluginState === 'failed' || pluginState === 'discovered' || pluginState === 'deactivated') {
      return 'unavailable'
    }
    if (accountStatuses.length === 0) return 'unknown'

    const hasConnected = accountStatuses.some((item) => item.state === 'connected')
    const hasRetrying = accountStatuses.some((item) => item.state === 'retrying')
    const hasFatal = accountStatuses.some((item) => item.state === 'fatal')
    const hasConnecting = accountStatuses.some((item) => item.state === 'connecting')
    const hasDisconnected = accountStatuses.some((item) => item.state === 'disconnected')

    if (hasConnected && (hasRetrying || hasFatal || hasConnecting || hasDisconnected)) {
      return 'degraded'
    }
    if (hasConnected) return 'healthy'
    if (hasRetrying || hasConnecting) return 'degraded'
    if (hasFatal || hasDisconnected) return 'unavailable'
    return 'unavailable'
  }

  private buildSummary(
    status: DoctorStatus,
    details: {
      stage: string
      connectedCount: number
      retryingCount: number
      fatalCount: number
      connectingCount: number
      disconnectedCount: number
    }
  ): string {
    if (status === 'healthy') return `${details.connectedCount} account(s) connected`
    if (status === 'degraded') {
      if (details.connectedCount > 0) {
        const impactedCount =
          details.retryingCount +
          details.fatalCount +
          details.connectingCount +
          details.disconnectedCount
        return `Partially available: ${details.connectedCount} connected, ${impactedCount} impacted`
      }
      if (details.stage === 'retrying') return 'Transport is retrying connection'
      if (details.stage === 'connecting') return 'Transport is connecting'
      return `Transport degraded (stage: ${details.stage})`
    }
    if (status === 'unavailable') return `Plugin unavailable (stage: ${details.stage})`
    return 'Plugin activated, no account status available'
  }

  private resolveLastCheckedAt(accountStatuses: TransportAccountStatus[]): string | null {
    const timestamps = accountStatuses
      .flatMap((status) => [
        status.updatedAt,
        status.lastAttemptAt,
        status.lastSuccessAt,
        status.lastFailureAt
      ])
      .filter((value): value is string => Boolean(value))
      .map((value) => Date.parse(value))
      .filter((value) => Number.isFinite(value))

    if (timestamps.length === 0) return null
    return new Date(Math.max(...timestamps)).toISOString()
  }
}
