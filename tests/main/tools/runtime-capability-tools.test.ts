import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createCapabilityActivateTool,
  createCapabilitySearchTool
} from '../../../src/main/tools/runtime-capability-tools.ts'

const catalog = [
  {
    name: 'read', label: 'Read', description: 'Read workspace files', source: 'builtin', builtin: true,
    parameterKeys: ['path'], parameters: { type: 'object' }, overriddenSources: [], toolsets: ['coding'], scopes: ['local'], status: 'active'
  },
  {
    name: 'webSearchTool', label: 'Web search', description: 'Search the web', source: 'framework', builtin: true,
    parameterKeys: ['query'], parameters: { type: 'object' }, overriddenSources: [], toolsets: ['web'], scopes: ['local'], status: 'discoverable'
  },
  {
    name: 'computerUseTool', label: 'Computer use', description: 'Control the computer', source: 'framework', builtin: true,
    parameterKeys: ['action'], parameters: { type: 'object' }, overriddenSources: [], toolsets: ['computer_use'], scopes: ['local'], status: 'blocked', blockedReason: 'Unavailable'
  }
] as any

test('capabilitySearch returns discoverable matches without parameter schemas', async () => {
  const tool = createCapabilitySearchTool({ getCatalog: () => catalog })
  const result = await tool.execute('id', { query: 'search web' } as any, undefined, undefined, {} as any)
  const capabilities = (result.details as any).capabilities
  assert.equal(capabilities[0].name, 'webSearchTool')
  assert.equal('parameters' in capabilities[0], false)
})

test('capabilitySearch does not return blocked capabilities', async () => {
  const tool = createCapabilitySearchTool({ getCatalog: () => catalog })
  const result = await tool.execute('id', { query: 'computer' } as any, undefined, undefined, {} as any)
  assert.deepEqual((result.details as any).capabilities, [])
})

test('capabilityActivate returns rejected names without changing active names', async () => {
  const tool = createCapabilityActivateTool({
    activate: (names) => ({ activated: [], rejected: names.map((name) => ({ name, reason: 'Unavailable' })) })
  })
  const result = await tool.execute('id', { names: ['computerUseTool'] } as any, undefined, undefined, {} as any)
  assert.deepEqual((result.details as any).activated, [])
  assert.match((result.details as any).rejected[0].reason, /Unavailable/)
})
