import type { AgentPluginDiagnostic } from '../main/agent-plugins/agent-plugin-discovery.ts'
import type {
  AgentPluginCompatibilitySource,
  AgentPluginManifest
} from '../main/agent-plugins/agent-plugin-manifest.ts'
import type { AgentPluginComponentType } from '../main/agent-plugins/agent-plugin-state-service.ts'

export type AgentPluginComponentSummary = {
  type: AgentPluginComponentType
  id: string
  path: string | null
  enabled: boolean
  supported: boolean
}

export type InstalledAgentPlugin = {
  pluginId: string
  displayName: string
  version: string
  description: string | null
  compatibilitySource: AgentPluginCompatibilitySource
  enabled: boolean
  manifestPath: string
  pluginRootDir: string
  manifest: AgentPluginManifest
  components: AgentPluginComponentSummary[]
}

export type ListInstalledAgentPluginsResult = {
  plugins: InstalledAgentPlugin[]
  diagnostics: AgentPluginDiagnostic[]
}

export type SetAgentPluginEnabledInput = {
  pluginId: string
  enabled: boolean
}

export type SetAgentPluginComponentEnabledInput = {
  pluginId: string
  componentType: AgentPluginComponentType
  componentId: string
  enabled: boolean
}

export type InstallAgentPluginInput = {
  sourcePath: string
  pluginsDir?: string
  force?: boolean
}

export type InstallAgentPluginResult = {
  manifest: AgentPluginManifest
  sourceDir: string
  targetDir: string
  manifestPath: string
  replaced: boolean
}
