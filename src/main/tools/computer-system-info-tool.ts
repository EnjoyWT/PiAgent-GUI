import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import { getSystemInfoService, type SystemInfoService } from '../system-info/system-info-service.ts'
import type {
  SystemInfoAction,
  SystemOverview,
  SystemProcessesInfo,
  SystemProcessSort
} from '../system-info/system-info-types.ts'

type ComputerSystemInfoService = Pick<
  SystemInfoService,
  | 'getOverview'
  | 'getOs'
  | 'getCpu'
  | 'getMemory'
  | 'getDisk'
  | 'getProcesses'
  | 'getNetwork'
  | 'getBattery'
  | 'checkPort'
>

type CreateComputerSystemInfoToolOptions = {
  service?: ComputerSystemInfoService
}

const actionValues: SystemInfoAction[] = [
  'overview',
  'os',
  'cpu',
  'memory',
  'disk',
  'processes',
  'network',
  'battery',
  'check_port'
]

const parametersSchema = Type.Object(
  {
    action: Type.Optional(
      Type.String({
        enum: actionValues,
        description:
          'System information query to run. Use overview for a concise local computer health snapshot.'
      })
    ),
    sortBy: Type.Optional(
      Type.String({
        enum: ['cpu', 'memory'],
        description: 'Process sorting mode for action "processes".'
      })
    ),
    limit: Type.Optional(
      Type.Number({
        description: 'Maximum process count for action "processes". Clamped between 1 and 50.'
      })
    ),
    port: Type.Optional(
      Type.Number({
        description: 'TCP port to inspect for action "check_port".'
      })
    )
  },
  { additionalProperties: false }
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeAction = (value: unknown): SystemInfoAction => {
  const action = String(value ?? 'overview').trim() as SystemInfoAction
  if (!actionValues.includes(action))
    throw new Error(`Unsupported computer status action: ${String(value ?? '')}`)
  return action
}

const normalizeSortBy = (value: unknown): SystemProcessSort | undefined => {
  if (value === undefined) return undefined
  if (value === 'cpu' || value === 'memory') return value
  throw new Error(`Unsupported process sort mode: ${String(value)}`)
}

const normalizeLimit = (value: unknown): number | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('limit must be a number')
  return Math.min(Math.max(Math.trunc(value), 1), 50)
}

const normalizePort = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('port must be between 1 and 65535')
  }
  return value
}

const formatBytes = (value: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

const summarizeOverview = (overview: SystemOverview): string => {
  const osLabel = [overview.os.productName ?? overview.os.type, overview.os.productVersion]
    .filter(Boolean)
    .join(' ')
  const disk = overview.disk.volumes[0]
  const network = overview.network.interfaces[0]
  const parts = [
    `${osLabel || overview.os.platform} ${overview.os.arch}`,
    `${overview.cpu.logicalCores} CPU cores`,
    `${overview.memory.usedPercent}% memory used (${formatBytes(overview.memory.usedBytes)} / ${formatBytes(overview.memory.totalBytes)})`
  ]
  if (disk) parts.push(`${disk.mountedOn} disk ${disk.usedPercent}% used`)
  if (network) parts.push(`${network.name} ${network.address}`)
  if (overview.battery?.percent !== null && overview.battery?.percent !== undefined) {
    parts.push(`battery ${overview.battery.percent}% ${overview.battery.state}`)
  }
  return `Computer system information: ${parts.join(', ')}.`
}

const summarizeProcesses = (info: SystemProcessesInfo): string => {
  if (info.processes.length === 0) return 'No running processes were reported.'
  const rows = info.processes
    .map(
      (process) =>
        `${process.name} (pid ${process.pid}, CPU ${process.cpuPercent}%, memory ${process.memoryPercent}%)`
    )
    .join('; ')
  return `Top processes by ${info.sortBy}: ${rows}.`
}

export const createComputerSystemInfoTool = (
  options: CreateComputerSystemInfoToolOptions = {}
): ToolDefinition => {
  const service = options.service ?? getSystemInfoService()
  return {
    name: 'computerSystemInfoTool',
    label: 'Computer System Info Tool',
    description:
      'Get local computer system information: OS version, CPU, disk usage, memory, running processes, network status, battery, and TCP port checks. Use when users ask about their computer status, system health, disk space, memory pressure, running processes, network connectivity, or what is using a port. This is local-only and does not operate the GUI.',
    parameters: parametersSchema,
    promptSnippet:
      'Use computerSystemInfoTool when the user asks about this computer: OS version, CPU, memory, disk usage, running processes, network status, battery, uptime, or port listeners. Prefer action "overview" for general system health, "processes" for CPU/memory consumers, "disk" for storage, "network" for connectivity details, and "check_port" when a specific TCP port is mentioned. Use systemDoctorTool only for PiAgent subsystem/plugin self-checks.',
    execute: async (_toolCallId, params) => {
      const input = isRecord(params) ? params : {}
      const action = normalizeAction(input.action)

      if (action === 'overview') {
        const result = await service.getOverview()
        return {
          content: [{ type: 'text' as const, text: summarizeOverview(result) }],
          details: { action, result }
        }
      }

      if (action === 'processes') {
        const sortBy = normalizeSortBy(input.sortBy)
        const limit = normalizeLimit(input.limit)
        const processOptions: { sortBy?: SystemProcessSort; limit?: number } = {}
        if (sortBy) processOptions.sortBy = sortBy
        if (limit) processOptions.limit = limit
        const result = await service.getProcesses(processOptions)
        return {
          content: [{ type: 'text' as const, text: summarizeProcesses(result) }],
          details: { action, result }
        }
      }

      if (action === 'check_port') {
        const result = await service.checkPort(normalizePort(input.port))
        return {
          content: [
            {
              type: 'text' as const,
              text: result.listening
                ? `TCP port ${result.port} is listening.`
                : `TCP port ${result.port} is not listening.`
            }
          ],
          details: { action, result }
        }
      }

      const result =
        action === 'os'
          ? await service.getOs()
          : action === 'cpu'
            ? await service.getCpu()
            : action === 'memory'
              ? await service.getMemory()
              : action === 'disk'
                ? await service.getDisk()
                : action === 'network'
                  ? await service.getNetwork()
                  : await service.getBattery()

      return {
        content: [{ type: 'text' as const, text: `Computer status ${action} completed.` }],
        details: { action, result }
      }
    }
  }
}
