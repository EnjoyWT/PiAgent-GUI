import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type { DoctorService } from '../doctor/doctor-service.ts'

type CreateSystemDoctorToolOptions = {
  doctorService: DoctorService
}

type DoctorToolAction =
  | 'list_domains'
  | 'list_components'
  | 'get_component_status'
  | 'get_domain_summary'

const DOMAIN_ALIASES: Record<string, string> = {
  transport: 'transport',
  im: 'im-transport',
  im_transport: 'im-transport',
  'im-transport': 'im-transport',
  messaging: 'im-transport',
  message: 'im-transport',
  chat: 'im-transport',
  im_runtime: 'im-runtime',
  'im-runtime': 'im-runtime',
  imruntime: 'im-runtime',
  imdoctor: 'im-runtime',
  im_doctor: 'im-runtime',
  computeruse: 'computer_use',
  computer_use: 'computer_use',
  computer: 'computer_use',
  gui: 'computer_use',
  desktop: 'computer_use'
}

const parametersSchema = Type.Object(
  {
    action: Type.String({
      enum: ['list_domains', 'list_components', 'get_component_status', 'get_domain_summary'],
      description:
        'Doctor query to run. Use list_domains first to discover available subsystems. For external IM/chat integration health, inspect domain "im-transport" (aliases: "im", "messaging", "chat"). Use "transport" for all transport infrastructure including local desktop transport.'
    }),
    domain: Type.Optional(
      Type.String({
        description:
          'Doctor domain to inspect. External IM/chat transports live in domain "im-transport". The aliases "im", "messaging", and "chat" also resolve to "im-transport". Domain "transport" includes all transport infrastructure, including local desktop transport.'
      })
    ),
    componentId: Type.Optional(
      Type.String({
        description:
          'Specific component identifier inside the selected domain. For the transport domain this is usually the transport/plugin id, such as telegram or wecom.'
      })
    )
  },
  { additionalProperties: false }
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireString = (value: unknown, field: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}

const normalizeDomain = (value: unknown): string => {
  const normalized = requireString(value, 'domain').toLowerCase()
  return DOMAIN_ALIASES[normalized] ?? normalized
}

export const createSystemDoctorTool = ({
  doctorService
}: CreateSystemDoctorToolOptions): ToolDefinition => ({
  name: 'systemDoctorTool',
  label: 'System Doctor Tool',
  description:
    "Query the host's runtime self-check. Use it when the user asks whether a capability, plugin, integration, or subsystem is connected, available, or broken. External IM/chat transport checks live under domain 'im-transport' (aliases: 'im', 'messaging', 'chat'). All transport infrastructure, including local desktop transport, lives under domain 'transport'. Computer Use checks live under domain 'computer_use'.",
  parameters: parametersSchema,
  execute: async (_toolCallId, params) => {
    const input = isRecord(params) ? params : {}
    const action = String(input.action ?? '').trim() as DoctorToolAction

    if (action === 'list_domains') {
      const domains = doctorService.listDomains()
      return {
        content: [
          {
            type: 'text' as const,
            text:
              domains.length === 0
                ? 'No doctor domains are currently registered.'
                : `Available doctor domains: ${domains.map((domain) => `${domain.domainId} (${domain.displayName})`).join(', ')}.`
          }
        ],
        details: {
          action,
          domains
        }
      }
    }

    if (action === 'list_components') {
      const domain = normalizeDomain(input.domain)
      const components = await doctorService.listComponents(domain)
      return {
        content: [
          {
            type: 'text' as const,
            text:
              components.length === 0
                ? `No doctor components are available in domain ${domain}.`
                : components
                    .map(
                      (component) =>
                        `${component.displayName} (${component.componentId}) - ${component.status}`
                    )
                    .join('\n')
          }
        ],
        details: {
          action,
          domain,
          components
        }
      }
    }

    if (action === 'get_component_status') {
      const domain = normalizeDomain(input.domain)
      const componentId = requireString(input.componentId, 'componentId')
      const component = await doctorService.getComponentStatus(domain, componentId)
      return {
        content: [
          {
            type: 'text' as const,
            text: `${component.displayName} (${component.componentId}): ${component.summary}`
          }
        ],
        details: {
          action,
          domain,
          component
        }
      }
    }

    if (action === 'get_domain_summary') {
      const domain = normalizeDomain(input.domain)
      const summary = await doctorService.getDomainSummary(domain)
      return {
        content: [{ type: 'text' as const, text: summary.summary }],
        details: {
          action,
          domain,
          summary
        }
      }
    }

    throw new Error(`Unknown action: ${String(input.action ?? '')}`)
  }
})
