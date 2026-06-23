export type AgentPluginCompatibilitySource = 'piagent' | 'claude' | 'codex' | 'pi-mono'

export type AgentPluginComponents = {
  skills: string[]
  mcpServers: string[]
  extensions: string[]
  tools: string[]
  commands: string[]
  agents: string[]
  hooks: string[]
}

export type AgentPluginManifest = {
  id: string
  apiVersion: string
  version: string
  displayName: string
  description?: string
  compatibilitySource: AgentPluginCompatibilitySource
  components: AgentPluginComponents
  interface?: Record<string, unknown>
  permissions?: Record<string, unknown>
}

const emptyComponents = (): AgentPluginComponents => ({
  skills: [],
  mcpServers: [],
  extensions: [],
  tools: [],
  commands: [],
  agents: [],
  hooks: []
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const readString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

const readRequiredString = (record: Record<string, unknown>, key: string): string => {
  const value = readString(record[key])
  if (!value) throw new Error(`Invalid agent plugin manifest: ${key} is required`)
  return value
}

const normalizePathList = (value: unknown): string[] => {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

const readInterfaceDisplayName = (record: Record<string, unknown>): string | null => {
  const interfaceRecord = isRecord(record.interface) ? record.interface : null
  return readString(interfaceRecord?.displayName)
}

export const isTransportManifestRecord = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && readString(value.kind) === 'transport'

export const readManifestId = (value: unknown): string | null => {
  if (!isRecord(value)) return null
  return readString(value.id) ?? readString(value.name)
}

export const parsePiAgentAgentPluginManifest = (value: unknown): AgentPluginManifest => {
  if (!isRecord(value)) throw new Error('Invalid agent plugin manifest: expected object')

  const domain = readString(value.domain)
  if (domain && domain !== 'agent-plugin') {
    throw new Error(`Invalid agent plugin manifest: unsupported domain ${domain}`)
  }

  const componentsRecord = isRecord(value.components) ? value.components : {}
  const components = emptyComponents()
  components.skills = normalizePathList(componentsRecord.skills)
  components.mcpServers = normalizePathList(componentsRecord.mcpServers)
  components.extensions = normalizePathList(componentsRecord.extensions)
  components.tools = normalizePathList(componentsRecord.tools)
  components.commands = normalizePathList(componentsRecord.commands)
  components.agents = normalizePathList(componentsRecord.agents)
  components.hooks = normalizePathList(componentsRecord.hooks)

  return {
    id: readRequiredString(value, 'id'),
    apiVersion: readString(value.apiVersion) ?? '1',
    version: readRequiredString(value, 'version'),
    displayName: readString(value.displayName) ?? readRequiredString(value, 'id'),
    description: readString(value.description) ?? undefined,
    compatibilitySource: 'piagent',
    components,
    interface: isRecord(value.interface) ? value.interface : undefined,
    permissions: isRecord(value.permissions) ? value.permissions : undefined
  }
}

export const parseClaudeAgentPluginManifest = (value: unknown): AgentPluginManifest => {
  if (!isRecord(value)) throw new Error('Invalid Claude plugin manifest: expected object')

  const id = readRequiredString(value, 'name')
  const components = emptyComponents()
  components.skills = ['./skills']
  components.mcpServers = ['./.mcp.json']
  components.commands = ['./commands']
  components.agents = ['./agents']
  components.hooks = ['./hooks', './hooks.json']

  return {
    id,
    apiVersion: '1',
    version: readString(value.version) ?? '0.0.0',
    displayName: readInterfaceDisplayName(value) ?? id,
    description: readString(value.description) ?? undefined,
    compatibilitySource: 'claude',
    components,
    interface: isRecord(value.interface) ? value.interface : undefined
  }
}

export const parseCodexAgentPluginManifest = (value: unknown): AgentPluginManifest => {
  if (!isRecord(value)) throw new Error('Invalid Codex plugin manifest: expected object')

  const id = readRequiredString(value, 'name')
  const components = emptyComponents()
  components.skills = normalizePathList(value.skills)
  components.mcpServers = normalizePathList(value.mcpServers)
  components.extensions = normalizePathList(value.extensions)
  components.tools = normalizePathList(value.tools)
  components.hooks = normalizePathList(value.hooks)

  return {
    id,
    apiVersion: '1',
    version: readString(value.version) ?? '0.0.0',
    displayName: readInterfaceDisplayName(value) ?? id,
    description: readString(value.description) ?? undefined,
    compatibilitySource: 'codex',
    components,
    interface: isRecord(value.interface) ? value.interface : undefined,
    permissions: isRecord(value.permissions) ? value.permissions : undefined
  }
}

export const parsePiMonoAgentPluginManifest = (value: unknown): AgentPluginManifest => {
  if (!isRecord(value)) throw new Error('Invalid pi-mono package manifest: expected object')

  const pi = isRecord(value.pi) ? value.pi : null
  if (!pi) throw new Error('Invalid pi-mono package manifest: pi is required')

  const components = emptyComponents()
  components.skills = normalizePathList(pi.skills)
  components.extensions = normalizePathList(pi.extensions)
  if (components.skills.length === 0 && components.extensions.length === 0) {
    throw new Error('Invalid pi-mono package manifest: pi.skills or pi.extensions is required')
  }

  return {
    id: readRequiredString(value, 'name'),
    apiVersion: '1',
    version: readString(value.version) ?? '0.0.0',
    displayName:
      readString(pi.displayName) ??
      readString(value.displayName) ??
      readRequiredString(value, 'name'),
    description: readString(value.description) ?? undefined,
    compatibilitySource: 'pi-mono',
    components,
    interface: isRecord(value.interface) ? value.interface : undefined
  }
}
