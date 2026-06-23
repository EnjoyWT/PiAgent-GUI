import type { DoctorDomain } from '../doctor/doctor-domain.ts'
import type {
  DoctorComponentResult,
  DoctorDomainSummary,
  DoctorStatus,
  DoctorDomainInfo
} from '../doctor/doctor-types.ts'
import { getComputerUseService, type ComputerUseService } from './computer-use-service.ts'

export class ComputerUseDoctor implements DoctorDomain {
  readonly info: DoctorDomainInfo = {
    domainId: 'computer_use',
    displayName: 'Computer Use'
  }

  private readonly service: ComputerUseService

  constructor(service: ComputerUseService = getComputerUseService()) {
    this.service = service
  }

  async listComponents(): Promise<DoctorComponentResult[]> {
    const doctor = await this.service.doctor()
    return [
      {
        domain: this.info.domainId,
        componentId: 'helper_binary',
        displayName: 'Native Helper',
        status: doctor.helper.available ? 'healthy' : 'unavailable',
        stage: doctor.stage,
        summary: doctor.helper.available
          ? `Native helper found at ${doctor.helper.path}`
          : 'Native Computer Use helper is not installed yet.',
        metadata: { helper: doctor.helper }
      },
      {
        domain: this.info.domainId,
        componentId: 'accessibility_permission',
        displayName: 'Accessibility Permission',
        status: doctor.permissions.accessibility === 'granted' ? 'healthy' : 'unavailable',
        stage: doctor.permissions.accessibility,
        summary: `Accessibility permission is ${doctor.permissions.accessibility}.`,
        metadata:
          doctor.permissions.accessibility === 'granted'
            ? undefined
            : {
                remediation: {
                  tool: 'computerUseTool',
                  params: { action: 'request_permissions' },
                  settingsUrl:
                    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
                }
              }
      },
      {
        domain: this.info.domainId,
        componentId: 'screen_recording_permission',
        displayName: 'Screen Recording Permission',
        status: doctor.permissions.screenRecording === 'granted' ? 'healthy' : 'unavailable',
        stage: doctor.permissions.screenRecording,
        summary: `Screen Recording permission is ${doctor.permissions.screenRecording}.`,
        metadata:
          doctor.permissions.screenRecording === 'granted'
            ? undefined
            : {
                remediation: {
                  tool: 'computerUseTool',
                  params: { action: 'request_permissions' },
                  settingsUrl:
                    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
                  note: 'Screen Recording prompts are only shown by an explicit capture access request and may not reappear after denial.'
                }
              }
      },
      {
        domain: this.info.domainId,
        componentId: 'background_click_capability',
        displayName: 'Background Click Capability',
        status: doctor.capabilities.backgroundClick ? 'healthy' : 'unavailable',
        stage: doctor.capabilities.backgroundClick ? 'ready' : 'not_ready',
        summary: doctor.capabilities.backgroundClick
          ? 'Background click prerequisites are satisfied.'
          : 'Background click requires macOS, native helper, and Accessibility permission.'
      }
    ]
  }

  async getComponentStatus(componentId: string): Promise<DoctorComponentResult> {
    const normalized = String(componentId ?? '').trim()
    const component = (await this.listComponents()).find((item) => item.componentId === normalized)
    if (!component) throw new Error(`Computer Use doctor component not found: ${componentId}`)
    return component
  }

  async getSummary(): Promise<DoctorDomainSummary> {
    const components = await this.listComponents()
    const counts: Record<DoctorStatus, number> = {
      healthy: 0,
      degraded: 0,
      unavailable: 0,
      unknown: 0
    }
    for (const component of components) counts[component.status] += 1
    const status: DoctorStatus =
      counts.healthy === components.length
        ? 'healthy'
        : counts.healthy > 0
          ? 'degraded'
          : counts.unavailable > 0
            ? 'unavailable'
            : 'unknown'

    return {
      domain: this.info.domainId,
      status,
      summary: `${components.length} Computer Use component(s): ${counts.healthy} healthy, ${counts.unavailable} unavailable`,
      componentCount: components.length,
      healthyCount: counts.healthy,
      degradedCount: counts.degraded,
      unavailableCount: counts.unavailable,
      unknownCount: counts.unknown
    }
  }
}
