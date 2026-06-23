import test from 'node:test'
import assert from 'node:assert/strict'
import { createSystemDoctorTool } from '../../../src/main/tools/system-doctor-tool.ts'

const getFirstText = (
  result: Awaited<ReturnType<ReturnType<typeof createSystemDoctorTool>['execute']>>
) => {
  const first = result.content[0]
  return first?.type === 'text' ? first.text : ''
}

test('system doctor lists domains with ids and display names', async () => {
  const tool = createSystemDoctorTool({
    doctorService: {
      listDomains: () => [
        { domainId: 'transport', displayName: 'Transport' },
        { domainId: 'im-transport', displayName: 'IM Transport' },
        { domainId: 'provider', displayName: 'Provider Config' }
      ]
    } as any
  })

  const result = await tool.execute(
    'call-1',
    { action: 'list_domains' } as any,
    undefined,
    undefined,
    {} as any
  )

  assert.match(getFirstText(result), /transport \(Transport\)/)
  assert.match(getFirstText(result), /im-transport \(IM Transport\)/)
  assert.match(getFirstText(result), /provider \(Provider Config\)/)
})

test('system doctor resolves im aliases to the filtered IM transport domain', async () => {
  const calls: string[] = []
  const tool = createSystemDoctorTool({
    doctorService: {
      listDomains: () => [],
      listComponents: async (_domain: string) => [],
      getComponentStatus: async (_domain: string, _componentId: string) => ({
        domain: 'im-transport',
        componentId: 'feishu',
        displayName: 'Feishu',
        status: 'healthy',
        stage: 'connected',
        summary: '1 account connected',
        error: null,
        lastCheckedAt: null
      }),
      getDomainSummary: async (domain: string) => {
        calls.push(domain)
        return {
          domain,
          status: 'healthy',
          summary: '1 IM transport(s): 1 healthy, 0 degraded, 0 unavailable',
          componentCount: 1,
          healthyCount: 1,
          degradedCount: 0,
          unavailableCount: 0,
          unknownCount: 0
        }
      }
    } as any
  })

  const result = await tool.execute(
    'call-2',
    {
      action: 'get_domain_summary',
      domain: 'im'
    } as any,
    undefined,
    undefined,
    {} as any
  )

  assert.deepEqual(calls, ['im-transport'])
  assert.equal((result.details as any).domain, 'im-transport')
})

test('system doctor resolves computer use aliases to the computer_use domain', async () => {
  const calls: string[] = []
  const tool = createSystemDoctorTool({
    doctorService: {
      listDomains: () => [],
      listComponents: async (_domain: string) => [],
      getComponentStatus: async (_domain: string, _componentId: string) => ({
        domain: 'computer_use',
        componentId: 'helper_binary',
        displayName: 'Native Helper',
        status: 'unavailable',
        stage: 'typescript-shell',
        summary: 'Native Computer Use helper is not installed yet.',
        error: null,
        lastCheckedAt: null
      }),
      getDomainSummary: async (domain: string) => {
        calls.push(domain)
        return {
          domain,
          status: 'unavailable',
          summary: '4 Computer Use component(s): 0 healthy, 4 unavailable',
          componentCount: 4,
          healthyCount: 0,
          degradedCount: 0,
          unavailableCount: 4,
          unknownCount: 0
        }
      }
    } as any
  })

  const result = await tool.execute(
    'call-3',
    {
      action: 'get_domain_summary',
      domain: 'desktop'
    } as any,
    undefined,
    undefined,
    {} as any
  )

  assert.deepEqual(calls, ['computer_use'])
  assert.equal((result.details as any).domain, 'computer_use')
})

test('system doctor resolves IM runtime aliases to the im-runtime domain', async () => {
  const calls: string[] = []
  const tool = createSystemDoctorTool({
    doctorService: {
      listDomains: () => [],
      listComponents: async (_domain: string) => [],
      getComponentStatus: async (_domain: string, _componentId: string) => ({
        domain: 'im-runtime',
        componentId: 'trace:trace-a',
        displayName: 'IM Trace trace-a',
        status: 'healthy',
        stage: 'run_decided',
        summary: 'run scheduled',
        error: null,
        lastCheckedAt: null
      }),
      getDomainSummary: async (domain: string) => {
        calls.push(domain)
        return {
          domain,
          status: 'healthy',
          summary: '1 IM runtime trace(s): 1 healthy, 0 degraded, 0 unavailable',
          componentCount: 1,
          healthyCount: 1,
          degradedCount: 0,
          unavailableCount: 0,
          unknownCount: 0
        }
      }
    } as any
  })

  const result = await tool.execute(
    'call-4',
    {
      action: 'get_domain_summary',
      domain: 'im_runtime'
    } as any,
    undefined,
    undefined,
    {} as any
  )

  assert.deepEqual(calls, ['im-runtime'])
  assert.equal((result.details as any).domain, 'im-runtime')
})
