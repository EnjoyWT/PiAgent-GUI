import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { AgentPluginStateService } from '../../../src/main/agent-plugins/agent-plugin-state-service.ts'

test('agent plugin state keeps plugin enablement separate from component enablement', () => {
  const service = new AgentPluginStateService(new Database(':memory:'))

  assert.equal(service.isPluginEnabled('agent-pack'), true)
  assert.equal(service.isComponentEnabled('agent-pack', 'skills', './skills'), true)
  assert.equal(service.isComponentEnabled('agent-pack', 'mcpServers', './.mcp.json'), false)
  assert.equal(
    service.isComponentEnabled('agent-pack', 'extensions', './extensions/index.js'),
    false
  )
  assert.equal(service.isComponentEnabled('agent-pack', 'tools', './tools/index.mjs'), false)

  assert.deepEqual(service.setComponentEnabled('agent-pack', 'tools', './tools/index.mjs', true), {
    pluginId: 'agent-pack',
    componentType: 'tools',
    componentId: './tools/index.mjs',
    enabled: true
  })
  assert.equal(service.isComponentEnabled('agent-pack', 'tools', './tools/index.mjs'), true)

  assert.deepEqual(service.setPluginEnabled('agent-pack', false), {
    pluginId: 'agent-pack',
    enabled: false
  })
  assert.equal(service.isPluginEnabled('agent-pack'), false)
  assert.equal(service.isComponentEnabled('agent-pack', 'skills', './skills'), false)
  assert.equal(service.isComponentEnabled('agent-pack', 'tools', './tools/index.mjs'), false)
})
