import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExtensionFactory, ToolDefinition } from '@enjoywt/pi-coding-agent'
import type { AgentToolResult } from '@enjoywt/pi-agent-core'
import { getConfigDb } from '../db/config-db.ts'
import { getDefaultPluginsDir } from '../paths.ts'
import {
  discoverAgentPlugins,
  resolveAgentPluginSkillPaths,
  type AgentPluginDiagnostic,
  type DiscoveredAgentPlugin
} from './agent-plugin-discovery.ts'
import {
  AgentPluginStateService,
  type AgentPluginComponentType
} from './agent-plugin-state-service.ts'

export type PluginMcpServerConfig = {
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
  pluginId: string
  pluginDisplayName: string
}

export type ResolvedAgentPluginResources = {
  skillPaths: string[]
  mcpServers: PluginMcpServerConfig[]
  tools: ToolDefinition[]
  extensionPaths: string[]
  extensionFactories: ExtensionFactory[]
  diagnostics: AgentPluginDiagnostic[]
  signature: string
}

export type ResolveAgentPluginResourcesOptions = {
  pluginDirectories?: string[]
  stateService?: AgentPluginStateService
}

type JsonRecord = Record<string, unknown>

type ToolModule =
  | {
      tools?: unknown
      default?: unknown
      createTools?: (context: {
        plugin: DiscoveredAgentPlugin
      }) => ToolDefinition[] | Promise<ToolDefinition[]>
    }
  | ToolDefinition[]

const isDirectory = (value: string): boolean => {
  try {
    return statSync(value).isDirectory()
  } catch {
    return false
  }
}

const isFileOrDirectory = (value: string): boolean => {
  try {
    const stats = statSync(value)
    return stats.isFile() || stats.isDirectory()
  } catch {
    return false
  }
}

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const sanitizeIdSegment = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'component'

const unique = <T extends string>(values: Iterable<T>): T[] => Array.from(new Set(values))

const readJsonFile = (filePath: string): unknown => JSON.parse(readFileSync(filePath, 'utf8'))

const componentEnabled = (
  stateService: AgentPluginStateService,
  plugin: DiscoveredAgentPlugin,
  componentType: AgentPluginComponentType,
  componentId: string
): boolean => stateService.isComponentEnabled(plugin.manifest.id, componentType, componentId)

const createDefaultStateService = async (): Promise<AgentPluginStateService> =>
  new AgentPluginStateService(getConfigDb())

const stringifyStringArray = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    return JSON.stringify(value.filter((item): item is string => typeof item === 'string'))
  }
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

const stringifyStringRecord = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!isRecord(value)) return null
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]))
  )
}

const stringifyHeaders = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!isRecord(value)) return null
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${String(item)}`)
    .join('\n')
}

const resolvePluginMcpServers = (
  plugin: DiscoveredAgentPlugin,
  componentPath: string
): PluginMcpServerConfig[] => {
  const configPath = path.resolve(plugin.pluginRootDir, componentPath)
  if (!existsSync(configPath)) return []
  const raw = readJsonFile(configPath)
  const servers = isRecord(raw) && isRecord(raw.mcpServers) ? raw.mcpServers : {}
  const pluginSegment = sanitizeIdSegment(plugin.manifest.id)

  return Object.entries(servers)
    .filter((entry): entry is [string, JsonRecord] => isRecord(entry[1]))
    .map(([serverId, server]) => {
      const url = typeof server.url === 'string' && server.url.trim() ? server.url.trim() : null
      const transportType =
        server.transport_type === 'http' || server.type === 'http'
          ? 'http'
          : server.transport_type === 'sse' || server.type === 'sse' || url
            ? 'sse'
            : 'stdio'
      return {
        id: `plugin__${pluginSegment}__${sanitizeIdSegment(serverId)}`,
        name: `${plugin.manifest.displayName} / ${serverId}`,
        description:
          typeof server.description === 'string' && server.description.trim()
            ? server.description.trim()
            : null,
        transport_type: transportType,
        command:
          typeof server.command === 'string' && server.command.trim()
            ? server.command.trim()
            : null,
        args: stringifyStringArray(server.args),
        env: stringifyStringRecord(server.env),
        url,
        headers: stringifyHeaders(server.headers),
        enabled: 1,
        created_at: '',
        pluginId: plugin.manifest.id,
        pluginDisplayName: plugin.manifest.displayName
      } satisfies PluginMcpServerConfig
    })
}

const normalizeToolArray = async (
  module: ToolModule,
  plugin: DiscoveredAgentPlugin
): Promise<ToolDefinition[]> => {
  if (Array.isArray(module)) return module as ToolDefinition[]
  if (typeof module.createTools === 'function') return await module.createTools({ plugin })
  if (Array.isArray(module.tools)) return module.tools as ToolDefinition[]
  if (Array.isArray(module.default)) return module.default as ToolDefinition[]
  if (module.default && isRecord(module.default) && Array.isArray(module.default.tools)) {
    return module.default.tools as ToolDefinition[]
  }
  return []
}

const namespacePluginTool = (
  plugin: DiscoveredAgentPlugin,
  tool: ToolDefinition
): ToolDefinition => {
  const pluginSegment = sanitizeIdSegment(plugin.manifest.id)
  const toolSegment = sanitizeIdSegment(tool.name)
  const runtimeName = `plugin__${pluginSegment}__${toolSegment}`
  const execute: ToolDefinition['execute'] = async (toolCallId, params, signal, onUpdate, ctx) => {
    const result = await tool.execute(toolCallId, params, signal, onUpdate, ctx)
    const baseDetails =
      result.details && typeof result.details === 'object'
        ? (result.details as Record<string, unknown>)
        : {}
    return {
      ...result,
      details: {
        ...baseDetails,
        pluginId: plugin.manifest.id,
        pluginToolName: tool.name
      }
    } as AgentToolResult<Record<string, unknown>>
  }

  return {
    ...tool,
    name: runtimeName,
    label: `${plugin.manifest.displayName} / ${tool.label || tool.name}`,
    execute
  }
}

const resolvePluginTools = async (
  plugin: DiscoveredAgentPlugin,
  componentPath: string
): Promise<ToolDefinition[]> => {
  const toolsPath = path.resolve(plugin.pluginRootDir, componentPath)
  if (!existsSync(toolsPath)) return []
  const module = (await import(pathToFileURL(toolsPath).href)) as ToolModule
  const tools = await normalizeToolArray(module, plugin)
  return tools.map((tool) => namespacePluginTool(plugin, tool))
}

const resolvePluginExtensionPath = (
  plugin: DiscoveredAgentPlugin,
  componentPath: string
): string | null => {
  const extensionPath = path.resolve(plugin.pluginRootDir, componentPath)
  return isFileOrDirectory(extensionPath) ? extensionPath : null
}

const resolvePluginExtensionFactory = async (
  plugin: DiscoveredAgentPlugin,
  extensionPath: string,
  diagnostics: AgentPluginDiagnostic[]
): Promise<ExtensionFactory | null> => {
  try {
    const module = (await import(pathToFileURL(extensionPath).href)) as {
      default?: unknown
    }
    const factory = module.default
    if (typeof factory === 'function') return factory as ExtensionFactory
    diagnostics.push({
      code: 'invalid-component',
      message: `Agent plugin extension does not export a default factory: ${extensionPath}`,
      manifestPath: plugin.manifestPath,
      pluginId: plugin.manifest.id
    })
    return null
  } catch (error) {
    diagnostics.push({
      code: 'invalid-component',
      message: `Failed to load agent plugin extension factory ${extensionPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      manifestPath: plugin.manifestPath,
      pluginId: plugin.manifest.id
    })
    return null
  }
}

export const resolveAgentPluginResources = async (
  options: ResolveAgentPluginResourcesOptions = {}
): Promise<ResolvedAgentPluginResources> => {
  const stateService = options.stateService ?? (await createDefaultStateService())
  const discovery = discoverAgentPlugins({
    directories: options.pluginDirectories ?? [getDefaultPluginsDir()]
  })
  const skillPaths: string[] = []
  const mcpServers: PluginMcpServerConfig[] = []
  const tools: ToolDefinition[] = []
  const extensionPaths: string[] = []
  const extensionFactories: ExtensionFactory[] = []
  const diagnostics = [...discovery.diagnostics]

  for (const plugin of discovery.plugins) {
    if (!stateService.isPluginEnabled(plugin.manifest.id)) continue

    for (const skillPath of plugin.manifest.components.skills) {
      if (componentEnabled(stateService, plugin, 'skills', skillPath)) {
        const resolved = resolveAgentPluginSkillPaths({
          ...plugin,
          manifest: {
            ...plugin.manifest,
            components: {
              ...plugin.manifest.components,
              skills: [skillPath]
            }
          }
        })
        skillPaths.push(...resolved)
      }
    }

    for (const mcpPath of plugin.manifest.components.mcpServers) {
      if (!componentEnabled(stateService, plugin, 'mcpServers', mcpPath)) continue
      mcpServers.push(...resolvePluginMcpServers(plugin, mcpPath))
    }

    for (const extensionPath of plugin.manifest.components.extensions) {
      if (!componentEnabled(stateService, plugin, 'extensions', extensionPath)) continue
      const resolved = resolvePluginExtensionPath(plugin, extensionPath)
      if (resolved) {
        extensionPaths.push(resolved)
        const factory = await resolvePluginExtensionFactory(plugin, resolved, diagnostics)
        if (factory) extensionFactories.push(factory)
      }
    }

    for (const toolPath of plugin.manifest.components.tools) {
      if (!componentEnabled(stateService, plugin, 'tools', toolPath)) continue
      tools.push(...(await resolvePluginTools(plugin, toolPath)))
    }
  }

  const signature = JSON.stringify({
    skillPaths: unique(skillPaths).sort((left, right) => left.localeCompare(right)),
    mcpServers: mcpServers
      .map((server) => server.id)
      .sort((left, right) => left.localeCompare(right)),
    tools: tools.map((tool) => tool.name).sort((left, right) => left.localeCompare(right)),
    extensionPaths: unique(extensionPaths).sort((left, right) => left.localeCompare(right)),
    extensionFactories: extensionFactories.length
  })

  return {
    skillPaths: unique(skillPaths).filter(isDirectory),
    mcpServers,
    tools,
    extensionPaths: unique(extensionPaths),
    extensionFactories,
    diagnostics,
    signature
  }
}
