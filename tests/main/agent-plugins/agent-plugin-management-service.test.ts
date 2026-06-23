import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentPluginManagementService } from '../../../src/main/agent-plugins/agent-plugin-management-service.ts'
import { AgentPluginStateService } from '../../../src/main/agent-plugins/agent-plugin-state-service.ts'

const writeJson = (filePath: string, value: unknown): void => {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

const createAgentPlugin = (root: string): string => {
  const pluginRoot = path.join(root, 'agent-pack')
  mkdirSync(path.join(pluginRoot, 'skills'), { recursive: true })
  mkdirSync(path.join(pluginRoot, 'extensions'), { recursive: true })
  mkdirSync(path.join(pluginRoot, 'tools'), { recursive: true })
  writeJson(path.join(pluginRoot, '.piagent-agent-plugin', 'plugin.json'), {
    id: 'agent-pack',
    domain: 'agent-plugin',
    apiVersion: '1',
    version: '0.1.0',
    displayName: 'Agent Pack',
    components: {
      skills: './skills',
      mcpServers: './.mcp.json',
      extensions: './extensions/index.js',
      tools: './tools/index.mjs'
    }
  })
  writeJson(path.join(pluginRoot, '.mcp.json'), {
    mcpServers: {}
  })
  writeFileSync(
    path.join(pluginRoot, 'extensions', 'index.js'),
    'export default function () {}\n',
    'utf8'
  )
  writeFileSync(path.join(pluginRoot, 'tools', 'index.mjs'), 'export const tools = []\n', 'utf8')
  return pluginRoot
}

test('agent plugin management lists component state without mixing IM transport plugins', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-agent-plugin-mgmt-'))

  try {
    const pluginsDir = path.join(tempRoot, 'plugins')
    const agentPluginRoot = createAgentPlugin(pluginsDir)
    writeJson(path.join(pluginsDir, 'feishu', '.piagent-plugin', 'plugin.json'), {
      id: 'feishu',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Feishu Transport',
      entry: './dist/index.mjs'
    })

    const stateService = new AgentPluginStateService(new Database(':memory:'))
    const service = new AgentPluginManagementService({
      pluginDirectories: [pluginsDir],
      stateService
    })

    const listed = service.listInstalled()

    assert.deepEqual(
      listed.plugins.map((plugin) => plugin.pluginId),
      ['agent-pack']
    )
    assert.equal(
      listed.diagnostics.some((item) => item.code === 'routed-to-im-transport'),
      true
    )
    assert.deepEqual(
      listed.plugins[0].components.map((component) => ({
        type: component.type,
        id: component.id,
        enabled: component.enabled,
        path: path.relative(agentPluginRoot, component.path ?? '')
      })),
      [
        { type: 'skills', id: './skills', enabled: true, path: 'skills' },
        { type: 'mcpServers', id: './.mcp.json', enabled: false, path: '.mcp.json' },
        {
          type: 'extensions',
          id: './extensions/index.js',
          enabled: false,
          path: 'extensions/index.js'
        },
        { type: 'tools', id: './tools/index.mjs', enabled: false, path: 'tools/index.mjs' }
      ]
    )

    service.setComponentEnabled({
      pluginId: 'agent-pack',
      componentType: 'mcpServers',
      componentId: './.mcp.json',
      enabled: true
    })
    assert.equal(
      service
        .listInstalled()
        .plugins[0].components.find((component) => component.type === 'mcpServers')?.enabled,
      true
    )
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('agent plugin management installs native agent plugin packages only', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-agent-plugin-install-'))

  try {
    const sourceRoot = path.join(tempRoot, 'source')
    const pluginsDir = path.join(tempRoot, 'installed')
    const sourcePlugin = createAgentPlugin(sourceRoot)

    const service = new AgentPluginManagementService({
      pluginDirectories: [pluginsDir],
      stateService: new AgentPluginStateService(new Database(':memory:'))
    })
    const installed = service.install({
      sourcePath: sourcePlugin,
      pluginsDir
    })

    assert.equal(installed.manifest.id, 'agent-pack')
    assert.equal(installed.targetDir, path.join(pluginsDir, 'agent-pack'))
    assert.ok(existsSync(path.join(installed.targetDir, '.piagent-agent-plugin', 'plugin.json')))

    const transportRoot = path.join(sourceRoot, 'transport')
    writeJson(path.join(transportRoot, '.piagent-plugin', 'plugin.json'), {
      id: 'feishu',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Feishu Transport',
      entry: './dist/index.mjs'
    })

    assert.throws(
      () =>
        service.install({
          sourcePath: transportRoot,
          pluginsDir
        }),
      /not an agent plugin/
    )
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
