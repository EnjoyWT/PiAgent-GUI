import type { DoctorDomain } from './doctor-domain.ts'
import type {
  DoctorComponentResult,
  DoctorDomainSummary,
  DoctorStatus,
  DoctorDomainInfo
} from './doctor-types.ts'
import type { ImDoctorPlane, ImDoctorTrace } from '../im/im-doctor-plane.ts'
import type { ImDoctorStatus } from '../im/im-doctor-types.ts'

const mapTraceStatus = (status: ImDoctorStatus): DoctorStatus => {
  if (status === 'pass') return 'healthy'
  if (status === 'warn') return 'degraded'
  return 'unavailable'
}

export class ImRuntimeDoctor implements DoctorDomain {
  readonly info: DoctorDomainInfo = {
    domainId: 'im-runtime',
    displayName: 'IM Runtime'
  }

  private readonly plane: ImDoctorPlane

  constructor(plane: ImDoctorPlane) {
    this.plane = plane
  }

  async listComponents(): Promise<DoctorComponentResult[]> {
    return this.plane.listRecentTraces().map((trace) => this.buildComponent(trace))
  }

  async getComponentStatus(componentId: string): Promise<DoctorComponentResult> {
    const normalized = String(componentId ?? '').trim()
    const imTraceId = normalized.startsWith('trace:')
      ? normalized.slice('trace:'.length)
      : normalized
    const trace = this.plane.getTrace(imTraceId)
    if (!trace) throw new Error(`IM runtime doctor component not found: ${componentId}`)
    return this.buildComponent(trace)
  }

  async getSummary(): Promise<DoctorDomainSummary> {
    const components = await this.listComponents()
    if (components.length === 0) {
      return {
        domain: this.info.domainId,
        status: 'unknown',
        summary: 'No IM runtime traces are currently available.',
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
      counts.unavailable > 0
        ? 'degraded'
        : counts.degraded > 0
          ? 'degraded'
          : counts.healthy === components.length
            ? 'healthy'
            : 'unknown'

    return {
      domain: this.info.domainId,
      status,
      summary: `${components.length} IM runtime trace(s): ${counts.healthy} healthy, ${counts.degraded} degraded, ${counts.unavailable} unavailable`,
      componentCount: components.length,
      healthyCount: counts.healthy,
      degradedCount: counts.degraded,
      unavailableCount: counts.unavailable,
      unknownCount: counts.unknown
    }
  }

  private buildComponent(trace: ImDoctorTrace): DoctorComponentResult {
    const lastStep = trace.steps[trace.steps.length - 1]
    return {
      domain: this.info.domainId,
      componentId: trace.componentId,
      displayName: `IM Trace ${trace.imTraceId}`,
      status: mapTraceStatus(trace.status),
      stage: lastStep?.step ?? null,
      summary: trace.lastMessage,
      error: trace.status === 'fail' ? trace.lastMessage : null,
      lastCheckedAt: trace.updatedAt,
      metadata: {
        imTraceId: trace.imTraceId,
        status: trace.status,
        startedAt: trace.startedAt,
        updatedAt: trace.updatedAt,
        steps: trace.steps
      }
    }
  }
}
