import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
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
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.ts')) {
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

const { registerMcpCliModule } = await import('../../../src/main/cli/modules/mcp-cli-module.ts')

class TestCliRegistry {
  private readonly handlers = new Map<string, any>()

  register(moduleName: string, actionName: string, handler: any): void {
    this.handlers.set(`${moduleName}:${actionName}`, handler)
  }

  async execute(request: any): Promise<any> {
    return await this.handlers.get(`${request.module}:${request.action}`)(request)
  }
}

type TestServer = {
  id: string
  name: string
  description: string | null
  transport_type: 'stdio' | 'sse' | 'http'
  command: string | null
  args: string | null
  env: string | null
  url: string | null
  headers: string | null
  enabled: number
  created_at: string
}

const createHarness = (): {
  registry: TestCliRegistry
  servers: Map<string, TestServer>
  workspaceBindings: Map<string, boolean>
} => {
  const registry = new TestCliRegistry()
  const servers = new Map<string, TestServer>()
  const workspaceBindings = new Map<string, boolean>()

  registerMcpCliModule(registry as any, {
    listMcpServers: () => Array.from(servers.values()),
    upsertMcpServer: (server) => {
      servers.set(server.id, {
        id: server.id,
        name: server.name,
        description: server.description ?? null,
        transport_type: server.transport_type ?? 'stdio',
        command: server.command ?? null,
        args: server.args ?? null,
        env: server.env ?? null,
        url: server.url ?? null,
        headers: server.headers ?? null,
        enabled: server.enabled === false ? 0 : 1,
        created_at: '2026-05-25 00:00:00'
      })
    },
    deleteMcpServer: (id) => {
      servers.delete(id)
      for (const key of Array.from(workspaceBindings.keys())) {
        if (key.endsWith(`:${id}`)) workspaceBindings.delete(key)
      }
    },
    listWorkspaceMcpServerBindings: (workspacePath) =>
      Array.from(workspaceBindings.entries())
        .filter(([key]) => key.startsWith(`${workspacePath}:`))
        .map(([key, enabled]) => ({
          workspace_path: workspacePath,
          server_id: key.slice(workspacePath.length + 1),
          enabled: enabled ? 1 : 0,
          updated_at: '2026-05-25 00:00:00'
        })),
    setWorkspaceMcpServerEnabled: (workspacePath, serverId, enabled) => {
      workspaceBindings.set(`${workspacePath}:${serverId}`, enabled)
    }
  })

  return { registry, servers, workspaceBindings }
}

test('mcp presets lists built-in server presets', async () => {
  const { registry } = createHarness()

  const result = await registry.execute({
    module: 'mcp',
    action: 'presets',
    flags: { json: true }
  })

  assert.equal(result.ok, true)
  assert.equal(result.exitCode, 0)
  assert.deepEqual(
    result.data.presets.map((preset: { id: string }) => preset.id),
    ['playwright', 'filesystem', 'context7', 'github-remote', 'memory', 'git']
  )
})

test('mcp install-preset installs and enables a preset for the workspace', async () => {
  const { registry, servers, workspaceBindings } = createHarness()

  const result = await registry.execute({
    module: 'mcp',
    action: 'install-preset',
    args: ['playwright'],
    flags: { workspace: '/repo/piagent', json: true }
  })

  assert.equal(result.ok, true)
  assert.equal(servers.get('playwright')?.command, 'npx')
  assert.equal(servers.get('playwright')?.args, JSON.stringify(['-y', '@playwright/mcp@latest']))
  assert.equal(workspaceBindings.get('/repo/piagent:playwright'), true)
  assert.equal(result.data.workspaceEnabled, true)
})

test('mcp add creates a custom remote server and enables it for the workspace', async () => {
  const { registry, servers, workspaceBindings } = createHarness()

  const result = await registry.execute({
    module: 'mcp',
    action: 'add',
    args: ['context7-team'],
    flags: {
      name: 'Context7 Team',
      transport: 'http',
      url: 'https://mcp.context7.com/mcp',
      headers: 'CONTEXT7_API_KEY: test-token',
      workspace: '/repo/piagent',
      json: true
    }
  })

  assert.equal(result.ok, true)
  assert.equal(servers.get('context7-team')?.transport_type, 'http')
  assert.equal(servers.get('context7-team')?.url, 'https://mcp.context7.com/mcp')
  assert.equal(servers.get('context7-team')?.headers, 'CONTEXT7_API_KEY: test-token')
  assert.equal(workspaceBindings.get('/repo/piagent:context7-team'), true)
})

test('mcp list marks which installed servers are enabled for a workspace', async () => {
  const { registry } = createHarness()

  await registry.execute({
    module: 'mcp',
    action: 'install-preset',
    args: ['memory'],
    flags: { workspace: '/repo/piagent' }
  })
  await registry.execute({
    module: 'mcp',
    action: 'install-preset',
    args: ['playwright']
  })

  const result = await registry.execute({
    module: 'mcp',
    action: 'list',
    flags: { workspace: '/repo/piagent', json: true }
  })

  assert.equal(result.ok, true)
  assert.deepEqual(
    result.data.servers.map((server: { id: string; enabledForWorkspace: boolean }) => ({
      id: server.id,
      enabledForWorkspace: server.enabledForWorkspace
    })),
    [
      { id: 'memory', enabledForWorkspace: true },
      { id: 'playwright', enabledForWorkspace: false }
    ]
  )
})

test('mcp enable requires a workspace path', async () => {
  const { registry } = createHarness()

  const result = await registry.execute({
    module: 'mcp',
    action: 'enable',
    args: ['playwright']
  })

  assert.equal(result.ok, false)
  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /Missing --workspace/)
})
