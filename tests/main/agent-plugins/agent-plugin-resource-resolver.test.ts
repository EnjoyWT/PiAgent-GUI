import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolve(repoRoot, 'tests/main/runtime-host/electron-stub.mjs')).href
      }
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:')
        ? fileURLToPath(context.parentURL)
        : ''
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) {
        return nextResolve(`${specifier}.ts`, context)
      }
    }
    return nextResolve(specifier, context)
  }
})

const { AgentPluginStateService } =
  await import('../../../src/main/agent-plugins/agent-plugin-state-service.ts')
const { resolveAgentPluginResources } =
  await import('../../../src/main/agent-plugins/agent-plugin-resource-resolver.ts')

const writeJson = (filePath: string, value: unknown): void => {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

const createAgentPlugin = (root: string): { pluginsDir: string; pluginRoot: string } => {
  const pluginsDir = path.join(root, 'plugins')
  const pluginRoot = path.join(pluginsDir, 'agent-pack')
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
    mcpServers: {
      github: {
        command: 'node',
        args: ['./server.js'],
        env: {
          TOKEN: 'test-token'
        }
      }
    }
  })
  writeFileSync(
    path.join(pluginRoot, 'extensions', 'index.js'),
    'export default function extension(pi) { pi.on("agent_start", () => undefined) }\n',
    'utf8'
  )
  writeFileSync(
    path.join(pluginRoot, 'tools', 'index.mjs'),
    `
      export const tools = [{
        name: 'echo',
        label: 'Echo',
        description: 'Echo input text',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } }
        },
        execute: async (_toolCallId, params) => ({
          content: [{ type: 'text', text: params.text }]
        })
      }]
    `,
    'utf8'
  )

  return { pluginsDir, pluginRoot }
}

test('agent plugin resource resolver respects plugin and component state', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-agent-plugin-resources-'))

  try {
    const { pluginsDir, pluginRoot } = createAgentPlugin(tempRoot)
    const stateService = new AgentPluginStateService(new Database(':memory:'))

    const declarativeOnly = await resolveAgentPluginResources({
      pluginDirectories: [pluginsDir],
      stateService
    })
    assert.deepEqual(declarativeOnly.skillPaths, [path.join(pluginRoot, 'skills')])
    assert.deepEqual(declarativeOnly.mcpServers, [])
    assert.deepEqual(declarativeOnly.tools, [])
    assert.deepEqual(declarativeOnly.extensionPaths, [])

    stateService.setComponentEnabled('agent-pack', 'mcpServers', './.mcp.json', true)
    stateService.setComponentEnabled('agent-pack', 'extensions', './extensions/index.js', true)
    stateService.setComponentEnabled('agent-pack', 'tools', './tools/index.mjs', true)

    const enabled = await resolveAgentPluginResources({
      pluginDirectories: [pluginsDir],
      stateService
    })
    assert.deepEqual(
      enabled.mcpServers.map((server) => ({
        id: server.id,
        name: server.name,
        command: server.command,
        args: server.args,
        env: server.env,
        enabled: server.enabled
      })),
      [
        {
          id: 'plugin__agent_pack__github',
          name: 'Agent Pack / github',
          command: 'node',
          args: JSON.stringify(['./server.js']),
          env: JSON.stringify({ TOKEN: 'test-token' }),
          enabled: 1
        }
      ]
    )
    assert.deepEqual(
      enabled.tools.map((tool) => tool.name),
      ['plugin__agent_pack__echo']
    )
    assert.deepEqual(enabled.extensionPaths, [path.join(pluginRoot, 'extensions', 'index.js')])
    assert.equal(enabled.extensionFactories.length, 1)

    let handledEvent = ''
    await enabled.extensionFactories[0]({
      on: (eventName: string) => {
        handledEvent = eventName
      }
    } as never)
    assert.equal(handledEvent, 'agent_start')

    const toolResult = await enabled.tools[0].execute(
      'call-1',
      { text: 'hello' } as never,
      undefined,
      undefined,
      {} as never
    )
    assert.deepEqual(toolResult.content[0], { type: 'text', text: 'hello' })

    stateService.setPluginEnabled('agent-pack', false)
    const disabled = await resolveAgentPluginResources({
      pluginDirectories: [pluginsDir],
      stateService
    })
    assert.deepEqual(disabled.skillPaths, [])
    assert.deepEqual(disabled.mcpServers, [])
    assert.deepEqual(disabled.tools, [])
    assert.deepEqual(disabled.extensionPaths, [])
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('agent plugin resource resolver loads pi-mono package extension declarations', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-pi-mono-plugin-resources-'))

  try {
    const pluginsDir = path.join(tempRoot, 'plugins')
    const pluginRoot = path.join(pluginsDir, 'pi-review')
    mkdirSync(path.join(pluginRoot, 'extensions'), { recursive: true })
    mkdirSync(path.join(pluginRoot, 'skills'), { recursive: true })
    writeJson(path.join(pluginRoot, 'package.json'), {
      name: 'pi-review',
      version: '0.2.0',
      description: 'Pi native review extension',
      pi: {
        extensions: ['./extensions/index.js'],
        skills: ['./skills']
      }
    })
    writeFileSync(
      path.join(pluginRoot, 'extensions', 'index.js'),
      'export default function extension(pi) { pi.on("tool_call", () => undefined) }\n',
      'utf8'
    )

    const stateService = new AgentPluginStateService(new Database(':memory:'))
    stateService.setComponentEnabled('pi-review', 'extensions', './extensions/index.js', true)

    const resources = await resolveAgentPluginResources({
      pluginDirectories: [pluginsDir],
      stateService
    })

    assert.deepEqual(resources.skillPaths, [path.join(pluginRoot, 'skills')])
    assert.deepEqual(resources.extensionPaths, [path.join(pluginRoot, 'extensions', 'index.js')])
    assert.equal(resources.extensionFactories.length, 1)
    assert.match(resources.signature, /extensions/)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
