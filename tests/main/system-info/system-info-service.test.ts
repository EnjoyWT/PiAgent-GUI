import test from 'node:test'
import assert from 'node:assert/strict'
import { SystemInfoService } from '../../../src/main/system-info/system-info-service.ts'
import type { SystemCommandRunner } from '../../../src/main/system-info/system-command-runner.ts'

type SystemInfoServiceDeps = NonNullable<ConstructorParameters<typeof SystemInfoService>[0]>
type TestOsAdapter = NonNullable<SystemInfoServiceDeps['os']>

const createFakeOs = (): TestOsAdapter => ({
  platform: () => 'darwin' as NodeJS.Platform,
  type: () => 'Darwin',
  release: () => '24.1.0',
  arch: () => 'arm64' as NodeJS.Architecture,
  hostname: () => 'pi-mac',
  uptime: () => 3661,
  totalmem: () => 16_000,
  freemem: () => 4_000,
  loadavg: () => [1.25, 1.5, 1.75],
  cpus: () => [
    { model: 'Apple M3', speed: 4050, times: { user: 1, nice: 0, sys: 1, idle: 1, irq: 0 } },
    { model: 'Apple M3', speed: 4050, times: { user: 1, nice: 0, sys: 1, idle: 1, irq: 0 } },
    { model: 'Apple M3', speed: 4050, times: { user: 1, nice: 0, sys: 1, idle: 1, irq: 0 } },
    { model: 'Apple M3', speed: 4050, times: { user: 1, nice: 0, sys: 1, idle: 1, irq: 0 } }
  ],
  networkInterfaces: () => ({
    en0: [
      {
        address: '192.168.1.10',
        family: 'IPv4' as const,
        internal: false,
        mac: 'aa:bb:cc:dd:ee:ff',
        netmask: '255.255.255.0',
        cidr: '192.168.1.10/24'
      }
    ],
    lo0: [
      {
        address: '127.0.0.1',
        family: 'IPv4' as const,
        internal: true,
        mac: '00:00:00:00:00:00',
        netmask: '255.0.0.0',
        cidr: '127.0.0.1/8'
      }
    ]
  })
})

const createRunner = (): { runner: SystemCommandRunner; calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    runner: async (command, args) => {
      calls.push([command, ...args].join(' '))
      if (command === 'sw_vers') {
        return {
          stdout: 'ProductName:\t\tmacOS\nProductVersion:\t\t15.1\nBuildVersion:\t\t24B83\n',
          stderr: ''
        }
      }
      if (command === 'df') {
        return {
          stdout:
            'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 1000 400 600 40% /System/Volumes/Data\n',
          stderr: ''
        }
      }
      if (command === 'ps') {
        return {
          stdout: ' 101 25.5 10.0 Safari\n 202 70.0 5.5 Code Helper\n 303 1.0 60.0 Electron\n',
          stderr: ''
        }
      }
      if (command === 'networksetup') {
        return { stdout: 'Current Wi-Fi Network: OfficeWifi\n', stderr: '' }
      }
      if (command === 'pmset') {
        return {
          stdout:
            "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234567)\t82%; discharging; 4:12 remaining present: true\n",
          stderr: ''
        }
      }
      throw new Error(`unexpected command ${command}`)
    }
  }
}

test('SystemInfoService builds a structured overview without exposing raw shell output', async () => {
  const { runner, calls } = createRunner()
  const service = new SystemInfoService({ os: createFakeOs(), commandRunner: runner })

  const overview = await service.getOverview()

  assert.equal(overview.os.productName, 'macOS')
  assert.equal(overview.os.productVersion, '15.1')
  assert.equal(overview.cpu.logicalCores, 4)
  assert.equal(overview.memory.usedBytes, 12_000)
  assert.equal(overview.disk.volumes[0]?.mountedOn, '/System/Volumes/Data')
  assert.equal(overview.network.interfaces[0]?.name, 'en0')
  assert.equal(overview.network.wifi?.ssid, 'OfficeWifi')
  assert.equal(overview.battery?.percent, 82)
  assert.deepEqual(calls, [
    'sw_vers',
    'df -kP',
    'networksetup -getairportnetwork en0',
    'pmset -g batt'
  ])
})

test('SystemInfoService sorts and limits process snapshots', async () => {
  const { runner } = createRunner()
  const service = new SystemInfoService({ os: createFakeOs(), commandRunner: runner })

  const byCpu = await service.getProcesses({ sortBy: 'cpu', limit: 2 })
  const byMemory = await service.getProcesses({ sortBy: 'memory', limit: 2 })

  assert.deepEqual(
    byCpu.processes.map((item) => item.name),
    ['Code Helper', 'Safari']
  )
  assert.deepEqual(
    byMemory.processes.map((item) => item.name),
    ['Electron', 'Safari']
  )
  assert.deepEqual(Object.keys(byCpu.processes[0] ?? {}).sort(), [
    'cpuPercent',
    'memoryPercent',
    'name',
    'pid'
  ])
})
