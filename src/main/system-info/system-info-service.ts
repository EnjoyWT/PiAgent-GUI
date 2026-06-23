import os from 'node:os'
import {
  runSystemCommand,
  type SystemCommandResult,
  type SystemCommandRunner
} from './system-command-runner.ts'
import type {
  SystemBatteryInfo,
  SystemCpuInfo,
  SystemDiskInfo,
  SystemDiskVolume,
  SystemMemoryInfo,
  SystemNetworkAddress,
  SystemNetworkInfo,
  SystemOsInfo,
  SystemOverview,
  SystemPortInfo,
  SystemProcessInfo,
  SystemProcessesInfo,
  SystemProcessSort
} from './system-info-types.ts'

type SystemOsAdapter = Pick<
  typeof os,
  | 'platform'
  | 'type'
  | 'release'
  | 'arch'
  | 'hostname'
  | 'uptime'
  | 'totalmem'
  | 'freemem'
  | 'loadavg'
  | 'cpus'
  | 'networkInterfaces'
>

type SystemInfoServiceDeps = {
  os?: SystemOsAdapter
  commandRunner?: SystemCommandRunner
  now?: () => Date
}

const clampLimit = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value as number), 1), 50)
}

const toPercent = (used: number, total: number): number =>
  total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0

const parseKeyValueLines = (stdout: string): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.+)$/)
    if (!match) continue
    result[match[1].trim()] = match[2].trim()
  }
  return result
}

const parseDiskLine = (line: string): SystemDiskVolume | null => {
  const match = line.trim().match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/)
  if (!match) return null
  return {
    filesystem: match[1],
    totalBytes: Number(match[2]) * 1024,
    usedBytes: Number(match[3]) * 1024,
    availableBytes: Number(match[4]) * 1024,
    usedPercent: Number(match[5]),
    mountedOn: match[6]
  }
}

const parseProcessLine = (line: string): SystemProcessInfo | null => {
  const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/)
  if (!match) return null
  return {
    pid: Number(match[1]),
    cpuPercent: Number(match[2]),
    memoryPercent: Number(match[3]),
    name: match[4].trim()
  }
}

const parseBatteryState = (stdout: string): SystemBatteryInfo['state'] => {
  const normalized = stdout.toLowerCase()
  if (normalized.includes('discharging')) return 'discharging'
  if (normalized.includes('charging')) return 'charging'
  if (normalized.includes('charged')) return 'charged'
  return 'unknown'
}

const parseBatteryPercent = (stdout: string): number | null => {
  const match = stdout.match(/(\d+)%/)
  return match ? Number(match[1]) : null
}

const parseWifiSsid = (stdout: string): string | null => {
  const trimmed = stdout.trim()
  const match = trimmed.match(/^Current Wi-Fi Network:\s*(.+)$/)
  if (!match) return null
  const ssid = match[1].trim()
  return ssid && ssid !== 'You are not associated with an AirPort network.' ? ssid : null
}

export class SystemInfoService {
  private readonly os: SystemOsAdapter
  private readonly commandRunner: SystemCommandRunner
  private readonly now: () => Date

  constructor(deps: SystemInfoServiceDeps = {}) {
    this.os = deps.os ?? os
    this.commandRunner = deps.commandRunner ?? runSystemCommand
    this.now = deps.now ?? (() => new Date())
  }

  async getOverview(): Promise<SystemOverview> {
    const osInfo = await this.getOs()
    const cpu = await this.getCpu()
    const memory = await this.getMemory()
    const disk = await this.getDisk()
    const network = await this.getNetwork()
    const battery = await this.getBattery()

    return {
      generatedAt: this.timestamp(),
      os: osInfo,
      cpu,
      memory,
      disk,
      network,
      battery
    }
  }

  async getOs(): Promise<SystemOsInfo> {
    const info: SystemOsInfo = {
      platform: this.os.platform(),
      type: this.os.type(),
      release: this.os.release(),
      arch: this.os.arch() as NodeJS.Architecture,
      hostname: this.os.hostname(),
      uptimeSeconds: Math.trunc(this.os.uptime())
    }

    if (info.platform !== 'darwin') return info

    const swVers = await this.tryCommand('sw_vers', [])
    if (!swVers) return info
    const parsed = parseKeyValueLines(swVers.stdout)
    return {
      ...info,
      productName: parsed.ProductName,
      productVersion: parsed.ProductVersion,
      buildVersion: parsed.BuildVersion
    }
  }

  async getCpu(): Promise<SystemCpuInfo> {
    const cpus = this.os.cpus()
    return {
      model: cpus[0]?.model ?? null,
      logicalCores: cpus.length,
      speedMHz: cpus[0]?.speed ?? null,
      loadAverage: this.os.loadavg().map((value) => Number(value.toFixed(2)))
    }
  }

  async getMemory(): Promise<SystemMemoryInfo> {
    const totalBytes = this.os.totalmem()
    const freeBytes = this.os.freemem()
    const usedBytes = Math.max(totalBytes - freeBytes, 0)
    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent: toPercent(usedBytes, totalBytes)
    }
  }

  async getDisk(): Promise<SystemDiskInfo> {
    const result = await this.commandRunner('df', ['-kP'])
    const volumes = result.stdout
      .split(/\r?\n/)
      .slice(1)
      .map(parseDiskLine)
      .filter((volume): volume is SystemDiskVolume => Boolean(volume))

    return {
      generatedAt: this.timestamp(),
      volumes
    }
  }

  async getProcesses(
    options: {
      sortBy?: SystemProcessSort
      limit?: number
    } = {}
  ): Promise<SystemProcessesInfo> {
    const sortBy = options.sortBy ?? 'cpu'
    const limit = clampLimit(options.limit, 10)
    const result = await this.commandRunner('ps', ['-axo', 'pid=,pcpu=,pmem=,comm='])
    const processes = result.stdout
      .split(/\r?\n/)
      .map(parseProcessLine)
      .filter((process): process is SystemProcessInfo => Boolean(process))
      .sort((left, right) =>
        sortBy === 'memory'
          ? right.memoryPercent - left.memoryPercent
          : right.cpuPercent - left.cpuPercent
      )
      .slice(0, limit)

    return {
      generatedAt: this.timestamp(),
      sortBy,
      limit,
      processes
    }
  }

  async getNetwork(): Promise<SystemNetworkInfo> {
    const interfaces = Object.entries(this.os.networkInterfaces())
      .flatMap(([name, addresses]) =>
        (addresses ?? []).map<SystemNetworkAddress>((address) => ({
          name,
          address: address.address,
          family: String(address.family),
          internal: address.internal
        }))
      )
      .filter((address) => !address.internal)

    const result: SystemNetworkInfo = {
      generatedAt: this.timestamp(),
      interfaces
    }

    if (this.os.platform() === 'darwin') {
      const wifi = await this.tryCommand('networksetup', ['-getairportnetwork', 'en0'])
      result.wifi = {
        device: 'en0',
        ssid: wifi ? parseWifiSsid(wifi.stdout) : null
      }
    }

    return result
  }

  async getBattery(): Promise<SystemBatteryInfo | null> {
    if (this.os.platform() !== 'darwin') return null
    const result = await this.tryCommand('pmset', ['-g', 'batt'])
    if (!result) return null
    return {
      generatedAt: this.timestamp(),
      percent: parseBatteryPercent(result.stdout),
      state: parseBatteryState(result.stdout),
      rawSummary: result.stdout.trim()
    }
  }

  async checkPort(port: number): Promise<SystemPortInfo> {
    const result = await this.tryCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
    const processes =
      result?.stdout
        .split(/\r?\n/)
        .slice(1)
        .map((line) => {
          const columns = line.trim().split(/\s+/)
          const pid = Number(columns[1])
          const name = columns[0]
          if (!Number.isFinite(pid) || !name) return null
          return {
            pid,
            name,
            cpuPercent: 0,
            memoryPercent: 0
          }
        })
        .filter((process): process is SystemProcessInfo => Boolean(process)) ?? []

    return {
      generatedAt: this.timestamp(),
      port,
      listening: processes.length > 0,
      processes
    }
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private async tryCommand(command: string, args: string[]): Promise<SystemCommandResult | null> {
    try {
      return await this.commandRunner(command, args)
    } catch {
      return null
    }
  }
}

let systemInfoServiceSingleton: SystemInfoService | null = null

export const getSystemInfoService = (): SystemInfoService => {
  systemInfoServiceSingleton ??= new SystemInfoService()
  return systemInfoServiceSingleton
}
