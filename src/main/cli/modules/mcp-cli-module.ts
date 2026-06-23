import path from 'node:path'
import { createCliFailureResult } from '../cli-errors'
import type { CliExecuteRequest, CliExecuteResult } from '../cli-types'
import type { CliRegistry } from '../cli-registry'
import {
  deleteMcpServer,
  listMcpServers,
  listWorkspaceMcpServerBindings,
  setWorkspaceMcpServerEnabled,
  upsertMcpServer,
  type McpServerRow,
  type WorkspaceMcpServerRow
} from '../../db/config-db'

type McpTransportType = 'stdio' | 'sse' | 'http'

type McpServerUpsertInput = {
  id: string
  name: string
  description?: string | null
  transport_type?: McpTransportType
  command?: string | null
  args?: string | null
  env?: string | null
  url?: string | null
  headers?: string | null
  enabled?: boolean
}

export type McpCliDependencies = {
  listMcpServers: () => McpServerRow[]
  upsertMcpServer: (server: McpServerUpsertInput) => void
  deleteMcpServer: (id: string) => void
  listWorkspaceMcpServerBindings: (workspacePath: string) => WorkspaceMcpServerRow[]
  setWorkspaceMcpServerEnabled: (workspacePath: string, serverId: string, enabled: boolean) => void
}

type McpPreset = {
  id: string
  name: string
  description: string
  requiresWorkspacePath?: boolean
  build: (context: { id: string; workspacePath?: string; request: CliExecuteRequest }) => McpServerUpsertInput
}

const defaultDependencies: McpCliDependencies = {
  listMcpServers,
  upsertMcpServer,
  deleteMcpServer,
  listWorkspaceMcpServerBindings,
  setWorkspaceMcpServerEnabled
}

const parseStringFlag = (request: CliExecuteRequest, key: string): string | undefined => {
  const value = request.flags?.[key]
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

const parseBooleanFlag = (request: CliExecuteRequest, key: string): boolean => {
  const value = request.flags?.[key]
  return value === true || value === 'true' || value === 1
}

const normalizeJsonText = (value?: string): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return JSON.stringify(JSON.parse(trimmed))
  } catch {
    return trimmed
  }
}

const normalizeArgs = (args: string[]): string => JSON.stringify(args)

const asJsonResult = (data: unknown): CliExecuteResult => ({
  ok: true,
  exitCode: 0,
  stdout: JSON.stringify(data, null, 2),
  stderr: '',
  data
})

const resolveWorkspacePath = (request: CliExecuteRequest): string | undefined => {
  const workspace = parseStringFlag(request, 'workspace')
  if (!workspace) return undefined
  return path.resolve(request.cwd ?? process.cwd(), workspace)
}

const requireWorkspacePath = (request: CliExecuteRequest): string | CliExecuteResult => {
  const workspacePath = resolveWorkspacePath(request)
  if (!workspacePath) return createCliFailureResult(2, 'Missing --workspace <path>')
  return workspacePath
}

const presetDefinitions: McpPreset[] = [
  {
    id: 'playwright',
    name: 'Playwright MCP',
    description: 'Browser automation and UI QA using Playwright accessibility snapshots.',
    build: ({ id }) => ({
      id,
      name: 'Playwright MCP',
      description: 'Browser automation and UI QA using Playwright accessibility snapshots.',
      transport_type: 'stdio',
      command: 'npx',
      args: normalizeArgs(['-y', '@playwright/mcp@latest']),
      enabled: true
    })
  },
  {
    id: 'filesystem',
    name: 'Filesystem MCP',
    description: 'Scoped local filesystem access for one workspace path.',
    requiresWorkspacePath: true,
    build: ({ id, workspacePath }) => ({
      id,
      name: 'Filesystem MCP',
      description: `Filesystem access scoped to ${workspacePath}`,
      transport_type: 'stdio',
      command: 'npx',
      args: normalizeArgs(['-y', '@modelcontextprotocol/server-filesystem', workspacePath ?? '.']),
      enabled: true
    })
  },
  {
    id: 'context7',
    name: 'Context7 MCP',
    description: 'Current library documentation and code examples.',
    build: ({ id, request }) => {
      const apiKey = parseStringFlag(request, 'api-key')
      return {
        id,
        name: 'Context7 MCP',
        description: 'Current library documentation and code examples.',
        transport_type: 'http',
        url: 'https://mcp.context7.com/mcp',
        headers: apiKey ? `CONTEXT7_API_KEY: ${apiKey}` : null,
        enabled: true
      }
    }
  },
  {
    id: 'github-remote',
    name: 'GitHub Remote MCP',
    description: 'GitHub-hosted MCP endpoint for issues, pull requests, and repository APIs.',
    build: ({ id, request }) => {
      const token = parseStringFlag(request, 'token')
      return {
        id,
        name: 'GitHub Remote MCP',
        description: 'GitHub-hosted MCP endpoint for issues, pull requests, and repository APIs.',
        transport_type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: token ? `Authorization: Bearer ${token}` : null,
        enabled: true
      }
    }
  },
  {
    id: 'memory',
    name: 'Memory MCP',
    description: 'MCP reference memory server.',
    build: ({ id }) => ({
      id,
      name: 'Memory MCP',
      description: 'MCP reference memory server.',
      transport_type: 'stdio',
      command: 'npx',
      args: normalizeArgs(['-y', '@modelcontextprotocol/server-memory']),
      enabled: true
    })
  },
  {
    id: 'git',
    name: 'Git MCP',
    description: 'Git repository operations scoped to one workspace path.',
    requiresWorkspacePath: true,
    build: ({ id, workspacePath }) => ({
      id,
      name: 'Git MCP',
      description: `Git operations scoped to ${workspacePath}`,
      transport_type: 'stdio',
      command: 'uvx',
      args: normalizeArgs(['mcp-server-git', '--repository', workspacePath ?? '.']),
      enabled: true
    })
  }
]

const getPreset = (id: string): McpPreset | undefined =>
  presetDefinitions.find((preset) => preset.id === id)

const summarizePreset = (preset: McpPreset): Record<string, unknown> => ({
  id: preset.id,
  name: preset.name,
  description: preset.description,
  requiresWorkspacePath: Boolean(preset.requiresWorkspacePath)
})

const withWorkspaceState = (
  servers: McpServerRow[],
  bindings: WorkspaceMcpServerRow[]
): Array<McpServerRow & { enabledForWorkspace?: boolean }> => {
  const enabledById = new Map(bindings.map((binding) => [binding.server_id, binding.enabled === 1]))
  return servers
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((server) => ({
      ...server,
      enabledForWorkspace: enabledById.get(server.id) ?? false
    }))
}

const formatServerLine = (server: McpServerRow & { enabledForWorkspace?: boolean }): string => {
  const globalState = server.enabled === 1 ? 'global=on' : 'global=off'
  const workspaceState =
    typeof server.enabledForWorkspace === 'boolean'
      ? ` workspace=${server.enabledForWorkspace ? 'on' : 'off'}`
      : ''
  const target =
    server.transport_type === 'stdio'
      ? `${server.command ?? ''} ${server.args ?? ''}`.trim()
      : (server.url ?? '')
  return `- ${server.id} (${server.transport_type}, ${globalState}${workspaceState}) ${target}`
}

const listHandler =
  (deps: McpCliDependencies) =>
  (request: CliExecuteRequest): CliExecuteResult => {
    const workspacePath = resolveWorkspacePath(request)
    const servers = workspacePath
      ? withWorkspaceState(deps.listMcpServers(), deps.listWorkspaceMcpServerBindings(workspacePath))
      : deps.listMcpServers().slice().sort((a, b) => a.id.localeCompare(b.id))
    const data = {
      workspacePath,
      servers
    }
    if (parseBooleanFlag(request, 'json')) return asJsonResult(data)
    if (servers.length === 0) {
      return {
        ok: true,
        exitCode: 0,
        stdout: 'No MCP servers configured.',
        stderr: '',
        data
      }
    }
    return {
      ok: true,
      exitCode: 0,
      stdout: [`Configured MCP servers${workspacePath ? ` for ${workspacePath}` : ''}:`, ...servers.map(formatServerLine)].join('\n'),
      stderr: '',
      data
    }
  }

const presetsHandler = (request: CliExecuteRequest): CliExecuteResult => {
  const data = {
    presets: presetDefinitions.map(summarizePreset)
  }
  if (parseBooleanFlag(request, 'json')) return asJsonResult(data)
  return {
    ok: true,
    exitCode: 0,
    stdout: [
      'Available MCP presets:',
      ...presetDefinitions.map(
        (preset) =>
          `- ${preset.id}: ${preset.description}${preset.requiresWorkspacePath ? ' (requires --workspace)' : ''}`
      )
    ].join('\n'),
    stderr: '',
    data
  }
}

const installPresetHandler =
  (deps: McpCliDependencies) =>
  (request: CliExecuteRequest): CliExecuteResult => {
    const presetId = request.args?.[0]?.trim()
    if (!presetId) return createCliFailureResult(2, 'Missing MCP preset id')
    const preset = getPreset(presetId)
    if (!preset) return createCliFailureResult(2, `Unknown MCP preset: ${presetId}`)

    const workspacePath = resolveWorkspacePath(request)
    if (preset.requiresWorkspacePath && !workspacePath) {
      return createCliFailureResult(2, `Preset "${preset.id}" requires --workspace <path>`)
    }

    const id = parseStringFlag(request, 'id') ?? preset.id
    const server = preset.build({ id, workspacePath, request })
    deps.upsertMcpServer(server)
    if (workspacePath) deps.setWorkspaceMcpServerEnabled(workspacePath, server.id, true)

    const data = {
      preset: preset.id,
      server,
      workspacePath,
      workspaceEnabled: Boolean(workspacePath)
    }
    if (parseBooleanFlag(request, 'json')) return asJsonResult(data)

    return {
      ok: true,
      exitCode: 0,
      stdout: [
        `Installed MCP preset "${preset.id}" as "${server.id}".`,
        workspacePath ? `Enabled for workspace: ${workspacePath}` : 'Workspace enablement: skipped'
      ].join('\n'),
      stderr: '',
      data
    }
  }

const addHandler =
  (deps: McpCliDependencies) =>
  (request: CliExecuteRequest): CliExecuteResult => {
    const id = request.args?.[0]?.trim()
    if (!id) return createCliFailureResult(2, 'Missing MCP server id')

    const transport = (parseStringFlag(request, 'transport') ?? 'stdio') as McpTransportType
    if (!['stdio', 'sse', 'http'].includes(transport)) {
      return createCliFailureResult(2, 'Invalid --transport. Expected stdio, sse, or http')
    }

    const command = parseStringFlag(request, 'command')
    const url = parseStringFlag(request, 'url')
    if (transport === 'stdio' && !command) {
      return createCliFailureResult(2, 'Missing --command for stdio MCP server')
    }
    if ((transport === 'sse' || transport === 'http') && !url) {
      return createCliFailureResult(2, `Missing --url for ${transport} MCP server`)
    }

    const workspacePath = resolveWorkspacePath(request)
    const server: McpServerUpsertInput = {
      id,
      name: parseStringFlag(request, 'name') ?? id,
      description: parseStringFlag(request, 'description') ?? null,
      transport_type: transport,
      command: transport === 'stdio' ? command : null,
      args: transport === 'stdio' ? normalizeJsonText(parseStringFlag(request, 'args')) : null,
      env: normalizeJsonText(parseStringFlag(request, 'env')),
      url: transport === 'stdio' ? null : url,
      headers: parseStringFlag(request, 'headers') ?? null,
      enabled: !parseBooleanFlag(request, 'disabled')
    }

    deps.upsertMcpServer(server)
    if (workspacePath) deps.setWorkspaceMcpServerEnabled(workspacePath, id, true)

    const data = {
      server,
      workspacePath,
      workspaceEnabled: Boolean(workspacePath)
    }
    if (parseBooleanFlag(request, 'json')) return asJsonResult(data)

    return {
      ok: true,
      exitCode: 0,
      stdout: [
        `Added MCP server "${id}".`,
        workspacePath ? `Enabled for workspace: ${workspacePath}` : 'Workspace enablement: skipped'
      ].join('\n'),
      stderr: '',
      data
    }
  }

const setWorkspaceEnabledHandler =
  (deps: McpCliDependencies, enabled: boolean) =>
  (request: CliExecuteRequest): CliExecuteResult => {
    const id = request.args?.[0]?.trim()
    if (!id) return createCliFailureResult(2, 'Missing MCP server id')
    const workspacePath = requireWorkspacePath(request)
    if (typeof workspacePath !== 'string') return workspacePath

    const exists = deps.listMcpServers().some((server) => server.id === id)
    if (!exists) return createCliFailureResult(2, `Unknown MCP server: ${id}`)

    deps.setWorkspaceMcpServerEnabled(workspacePath, id, enabled)
    const data = {
      serverId: id,
      workspacePath,
      enabled
    }
    if (parseBooleanFlag(request, 'json')) return asJsonResult(data)
    return {
      ok: true,
      exitCode: 0,
      stdout: `${enabled ? 'Enabled' : 'Disabled'} MCP server "${id}" for ${workspacePath}.`,
      stderr: '',
      data
    }
  }

const removeHandler =
  (deps: McpCliDependencies) =>
  (request: CliExecuteRequest): CliExecuteResult => {
    const id = request.args?.[0]?.trim()
    if (!id) return createCliFailureResult(2, 'Missing MCP server id')
    const exists = deps.listMcpServers().some((server) => server.id === id)
    if (!exists) return createCliFailureResult(2, `Unknown MCP server: ${id}`)

    deps.deleteMcpServer(id)
    const data = { serverId: id }
    if (parseBooleanFlag(request, 'json')) return asJsonResult(data)
    return {
      ok: true,
      exitCode: 0,
      stdout: `Removed MCP server "${id}".`,
      stderr: '',
      data
    }
  }

export const registerMcpCliModule = (
  registry: CliRegistry,
  deps: McpCliDependencies = defaultDependencies
): void => {
  registry.register('mcp', 'list', listHandler(deps))
  registry.register('mcp', 'presets', presetsHandler)
  registry.register('mcp', 'install-preset', installPresetHandler(deps))
  registry.register('mcp', 'add', addHandler(deps))
  registry.register('mcp', 'enable', setWorkspaceEnabledHandler(deps, true))
  registry.register('mcp', 'disable', setWorkspaceEnabledHandler(deps, false))
  registry.register('mcp', 'remove', removeHandler(deps))
}
