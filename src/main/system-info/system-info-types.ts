export type SystemInfoAction =
  | 'overview'
  | 'os'
  | 'cpu'
  | 'memory'
  | 'disk'
  | 'processes'
  | 'network'
  | 'battery'
  | 'check_port'

export type SystemProcessSort = 'cpu' | 'memory'

export type SystemOsInfo = {
  platform: NodeJS.Platform
  type: string
  release: string
  arch: NodeJS.Architecture
  hostname: string
  uptimeSeconds: number
  productName?: string
  productVersion?: string
  buildVersion?: string
}

export type SystemCpuInfo = {
  model: string | null
  logicalCores: number
  speedMHz: number | null
  loadAverage: number[]
}

export type SystemMemoryInfo = {
  totalBytes: number
  freeBytes: number
  usedBytes: number
  usedPercent: number
}

export type SystemDiskVolume = {
  filesystem: string
  mountedOn: string
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usedPercent: number
}

export type SystemDiskInfo = {
  generatedAt: string
  volumes: SystemDiskVolume[]
}

export type SystemProcessInfo = {
  pid: number
  name: string
  cpuPercent: number
  memoryPercent: number
}

export type SystemProcessesInfo = {
  generatedAt: string
  sortBy: SystemProcessSort
  limit: number
  processes: SystemProcessInfo[]
}

export type SystemNetworkAddress = {
  name: string
  address: string
  family: string
  internal: boolean
}

export type SystemNetworkInfo = {
  generatedAt: string
  interfaces: SystemNetworkAddress[]
  wifi?: {
    device: string
    ssid: string | null
  }
}

export type SystemBatteryInfo = {
  generatedAt: string
  percent: number | null
  state: 'charging' | 'discharging' | 'charged' | 'unknown'
  rawSummary: string
}

export type SystemPortInfo = {
  generatedAt: string
  port: number
  listening: boolean
  processes: SystemProcessInfo[]
}

export type SystemOverview = {
  generatedAt: string
  os: SystemOsInfo
  cpu: SystemCpuInfo
  memory: SystemMemoryInfo
  disk: SystemDiskInfo
  network: SystemNetworkInfo
  battery: SystemBatteryInfo | null
}
