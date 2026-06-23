import { existsSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { getDefaultPluginsDir } from '../paths.ts'
import {
  installPluginPackageFromLocalPath,
  type PluginPackageManifestCandidate,
  type PluginPackageManifestKind
} from '../plugin-packages/package-management-service.ts'
import type {
  AgentPluginComponentSummary,
  InstallAgentPluginInput,
  InstallAgentPluginResult,
  InstalledAgentPlugin,
  ListInstalledAgentPluginsResult,
  SetAgentPluginComponentEnabledInput,
  SetAgentPluginEnabledInput
} from '../../shared/agent-plugins.ts'
import { discoverAgentPlugins, type DiscoveredAgentPlugin } from './agent-plugin-discovery.ts'
import {
  parseClaudeAgentPluginManifest,
  parseCodexAgentPluginManifest,
  parsePiMonoAgentPluginManifest,
  parsePiAgentAgentPluginManifest,
  readManifestId,
  type AgentPluginManifest
} from './agent-plugin-manifest.ts'
import {
  AgentPluginStateService,
  type AgentPluginComponentType
} from './agent-plugin-state-service.ts'

const AGENT_PLUGIN_MANIFEST_CANDIDATES: PluginPackageManifestCandidate[] = [
  { kind: 'piagent-agent', relativePath: path.join('.piagent-agent-plugin', 'plugin.json') },
  { kind: 'piagent', relativePath: path.join('.piagent-plugin', 'plugin.json') },
  { kind: 'claude', relativePath: path.join('.claude-plugin', 'plugin.json') },
  { kind: 'codex', relativePath: path.join('.codex-plugin', 'plugin.json') },
  { kind: 'pi-mono', relativePath: 'package.json' }
]

const SUPPORTED_COMPONENT_TYPES = new Set<AgentPluginComponentType>([
  'skills',
  'mcpServers',
  'extensions',
  'tools'
])

export type AgentPluginManagementServiceOptions = {
  pluginDirectories?: string[]
  stateService?: AgentPluginStateService
}

const isFileOrDirectory = (value: string): boolean => {
  try {
    return statSync(value).isFile() || statSync(value).isDirectory()
  } catch {
    return false
  }
}

const parseManifestForInstall = (
  kind: PluginPackageManifestKind,
  raw: unknown
): AgentPluginManifest => {
  if (kind === 'piagent-agent') return parsePiAgentAgentPluginManifest(raw)
  if (kind === 'claude') return parseClaudeAgentPluginManifest(raw)
  if (kind === 'codex') return parseCodexAgentPluginManifest(raw)
  if (kind === 'pi-mono') return parsePiMonoAgentPluginManifest(raw)

  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  if (record && (record as Record<string, unknown>).domain === 'agent-plugin') {
    return parsePiAgentAgentPluginManifest(raw)
  }
  throw new Error('PiAgent package is not an agent plugin')
}

const readInstallPackageId = (kind: PluginPackageManifestKind, raw: unknown): string | null => {
  if (kind === 'piagent') {
    const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
    if (record && (record as Record<string, unknown>).kind === 'transport') {
      throw new Error('PiAgent transport package is not an agent plugin')
    }
  }
  return parseManifestForInstall(kind, raw).id ?? readManifestId(raw)
}

const componentPath = (plugin: DiscoveredAgentPlugin, componentId: string): string | null => {
  const resolved = path.resolve(plugin.pluginRootDir, componentId)
  return existsSync(resolved) && isFileOrDirectory(resolved) ? resolved : null
}

const mapComponents = (
  plugin: DiscoveredAgentPlugin,
  stateService: AgentPluginStateService
): AgentPluginComponentSummary[] => {
  const components: AgentPluginComponentSummary[] = []
  for (const componentType of Object.keys(
    plugin.manifest.components
  ) as AgentPluginComponentType[]) {
    for (const componentId of plugin.manifest.components[componentType]) {
      components.push({
        type: componentType,
        id: componentId,
        path: componentPath(plugin, componentId),
        enabled: stateService.isComponentEnabled(plugin.manifest.id, componentType, componentId),
        supported: SUPPORTED_COMPONENT_TYPES.has(componentType)
      })
    }
  }
  return components
}

const mapInstalledPlugin = (
  plugin: DiscoveredAgentPlugin,
  stateService: AgentPluginStateService
): InstalledAgentPlugin => ({
  pluginId: plugin.manifest.id,
  displayName: plugin.manifest.displayName,
  version: plugin.manifest.version,
  description: plugin.manifest.description ?? null,
  compatibilitySource: plugin.manifest.compatibilitySource,
  enabled: stateService.isPluginEnabled(plugin.manifest.id),
  manifestPath: plugin.manifestPath,
  pluginRootDir: plugin.pluginRootDir,
  manifest: plugin.manifest,
  components: mapComponents(plugin, stateService)
})

export class AgentPluginManagementService {
  private readonly pluginDirectories: string[]
  private readonly stateService: AgentPluginStateService

  constructor(options: AgentPluginManagementServiceOptions = {}) {
    this.pluginDirectories = options.pluginDirectories ?? [getDefaultPluginsDir()]
    if (!options.stateService) throw new Error('AgentPluginManagementService requires stateService')
    this.stateService = options.stateService
  }

  listInstalled(): ListInstalledAgentPluginsResult {
    const discovered = discoverAgentPlugins({ directories: this.pluginDirectories })
    return {
      plugins: discovered.plugins.map((plugin) => mapInstalledPlugin(plugin, this.stateService)),
      diagnostics: discovered.diagnostics
    }
  }

  getManifest(pluginId: string): AgentPluginManifest | null {
    return (
      discoverAgentPlugins({ directories: this.pluginDirectories }).plugins.find(
        (plugin) => plugin.manifest.id === pluginId
      )?.manifest ?? null
    )
  }

  setEnabled(input: SetAgentPluginEnabledInput): { pluginId: string; enabled: boolean } {
    return this.stateService.setPluginEnabled(input.pluginId, input.enabled)
  }

  setComponentEnabled(input: SetAgentPluginComponentEnabledInput): {
    pluginId: string
    componentType: AgentPluginComponentType
    componentId: string
    enabled: boolean
  } {
    return this.stateService.setComponentEnabled(
      input.pluginId,
      input.componentType,
      input.componentId,
      input.enabled
    )
  }

  install(input: InstallAgentPluginInput): InstallAgentPluginResult {
    const installed = installPluginPackageFromLocalPath({
      sourcePath: input.sourcePath,
      pluginsDir: input.pluginsDir ?? this.pluginDirectories[0] ?? getDefaultPluginsDir(),
      force: input.force,
      candidates: AGENT_PLUGIN_MANIFEST_CANDIDATES,
      readPackageId: readInstallPackageId
    })
    const manifest = parseManifestForInstall(installed.manifestKind, installed.manifestRaw)
    return {
      manifest,
      sourceDir: installed.sourceDir,
      targetDir: installed.targetDir,
      manifestPath: installed.manifestPath,
      replaced: installed.replaced
    }
  }

  remove(pluginId: string): { success: true } {
    const discovered = discoverAgentPlugins({ directories: this.pluginDirectories })
    const plugin = discovered.plugins.find((item) => item.manifest.id === pluginId)
    if (!plugin) throw new Error(`Agent plugin not found: ${pluginId}`)
    rmSync(plugin.pluginRootDir, { recursive: true, force: true })
    return { success: true }
  }
}
