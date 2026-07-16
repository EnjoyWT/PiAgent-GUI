import test from 'node:test'
import assert from 'node:assert/strict'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { createComputerSystemInfoTool } from '../../../src/main/tools/computer-system-info-tool.ts'

type ComputerSystemInfoToolOptions = NonNullable<Parameters<typeof createComputerSystemInfoTool>[0]>
type ComputerSystemInfoService = NonNullable<ComputerSystemInfoToolOptions['service']>

const notUsed = async (): Promise<never> => {
  throw new Error('should not execute')
}

const createService = (
  overrides: Partial<ComputerSystemInfoService>
): ComputerSystemInfoService => ({
  getOverview: notUsed,
  getOs: notUsed,
  getCpu: notUsed,
  getMemory: notUsed,
  getDisk: notUsed,
  getProcesses: notUsed as ComputerSystemInfoService['getProcesses'],
  getNetwork: notUsed,
  getBattery: notUsed,
  checkPort: notUsed as ComputerSystemInfoService['checkPort'],
  ...overrides
})

const executeTool = async (
  tool: ToolDefinition,
  toolCallId: string,
  params: Record<string, unknown>
): ReturnType<ToolDefinition['execute']> =>
  await tool.execute(toolCallId, params, undefined, undefined, {} as never)

test('computerSystemInfoTool defaults to a local computer overview', async () => {
  const overview: Awaited<ReturnType<ComputerSystemInfoService['getOverview']>> = {
    generatedAt: '2026-04-30T12:00:00.000Z',
    os: {
      platform: 'darwin',
      type: 'Darwin',
      release: '24.1.0',
      arch: 'arm64',
      hostname: 'pi-mac',
      uptimeSeconds: 3600,
      productName: 'macOS',
      productVersion: '15.1'
    },
    cpu: { model: 'Apple M3', logicalCores: 4, speedMHz: 4050, loadAverage: [1.1, 1.2, 1.3] },
    memory: { totalBytes: 16_000, freeBytes: 4_000, usedBytes: 12_000, usedPercent: 75 },
    disk: {
      generatedAt: '2026-04-30T12:00:00.000Z',
      volumes: [
        {
          filesystem: '/dev/disk3s1',
          mountedOn: '/',
          totalBytes: 1000,
          usedBytes: 400,
          availableBytes: 600,
          usedPercent: 40
        }
      ]
    },
    network: {
      generatedAt: '2026-04-30T12:00:00.000Z',
      interfaces: [{ name: 'en0', address: '192.168.1.10', family: 'IPv4', internal: false }]
    },
    battery: {
      generatedAt: '2026-04-30T12:00:00.000Z',
      percent: 82,
      state: 'discharging',
      rawSummary: '82%; discharging'
    }
  }
  const tool = createComputerSystemInfoTool({
    service: createService({
      getOverview: async () => overview
    })
  })

  const result = await executeTool(tool, 'status-1', {})

  assert.match(result.content[0]?.type === 'text' ? result.content[0].text : '', /macOS 15\.1/)
  const details = result.details as { action: 'overview'; result: typeof overview }
  assert.equal(details.action, 'overview')
  assert.equal(details.result.memory.usedPercent, 75)
})

test('computerSystemInfoTool passes process query options to the service', async () => {
  const calls: unknown[] = []
  const processes: Awaited<ReturnType<ComputerSystemInfoService['getProcesses']>> = {
    generatedAt: '2026-04-30T12:00:00.000Z',
    sortBy: 'memory',
    limit: 3,
    processes: [{ pid: 101, name: 'Electron', cpuPercent: 3.2, memoryPercent: 20.5 }]
  }
  const tool = createComputerSystemInfoTool({
    service: createService({
      async getProcesses(options) {
        calls.push(options)
        return processes
      }
    })
  })

  const result = await executeTool(tool, 'status-2', {
    action: 'processes',
    sortBy: 'memory',
    limit: 3
  })

  assert.deepEqual(calls, [{ sortBy: 'memory', limit: 3 }])
  assert.match(result.content[0]?.type === 'text' ? result.content[0].text : '', /Electron/)
})

test('computerSystemInfoTool validates port checks before calling the service', async () => {
  const tool = createComputerSystemInfoTool({
    service: createService({
      async checkPort() {
        throw new Error('should not execute')
      }
    })
  })

  await assert.rejects(
    () =>
      executeTool(tool, 'status-3', {
        action: 'check_port',
        port: 70000
      }),
    /port must be between 1 and 65535/
  )
})
