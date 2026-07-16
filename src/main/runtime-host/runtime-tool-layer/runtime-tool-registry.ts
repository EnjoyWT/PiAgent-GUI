import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { ConversationSourceKind } from '../../core-v2/domain.ts'

export type RuntimeToolRegistrySource =
  | 'builtin'
  | 'framework'
  | 'interaction'
  | 'surface'
  | 'mcp'
  | 'plugin'

export type RuntimeToolsetId =
  | 'discovery'
  | 'coding'
  | 'interaction_local'
  | 'provider_setup'
  | 'automation'
  | 'im_ops'
  | 'doctor'
  | 'system_info'
  | 'presentation'
  | 'computer_use'
  | 'web'
  | 'mcp'
  | 'plugin'

export type RuntimeToolRegistryGroup = {
  source: RuntimeToolRegistrySource
  tools: ToolDefinition[]
  scopes?: ConversationSourceKind[]
}

export type RuntimeToolRegistryEntry = {
  name: string
  label: string
  description: string
  source: RuntimeToolRegistrySource
  builtin: boolean
  parameterKeys: string[]
  parameters: unknown
  promptSnippet?: string
  overriddenSources: RuntimeToolRegistrySource[]
  toolsets: RuntimeToolsetId[]
  scopes: ConversationSourceKind[]
  defaultActive: boolean
}

const LOCAL_ONLY_TOOL_NAMES = new Set([
  'questionTool',
  'questionnaireTool',
  'secretRequestTool',
  'providerConfigTool',
  'widgetRenderer'
])

const CROSS_SURFACE_TOOL_NAMES = new Set([
  'discoverBuiltinToolsTool',
  'scheduledTaskTool',
  'imTool',
  'systemDoctorTool',
  'knowledgeSearchTool',
  'knowledgeTraceTool',
  'conversationQueryTool'
])

const uniqueSorted = <T extends string>(values: Iterable<T>): T[] =>
  Array.from(new Set(values)).sort((left, right) => left.localeCompare(right)) as T[]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const extractParameterKeys = (schema: unknown): string[] => {
  if (!isRecord(schema)) return []
  const properties = schema.properties
  if (!isRecord(properties)) return []
  return Object.keys(properties).sort((left, right) => left.localeCompare(right))
}

const inferToolsets = (
  tool: Pick<ToolDefinition, 'name'>,
  source: RuntimeToolRegistrySource
): RuntimeToolsetId[] => {
  if (tool.name === 'discoverBuiltinToolsTool') return ['discovery']
  if (source === 'mcp') return ['mcp']
  if (source === 'plugin') return ['plugin']

  switch (tool.name) {
    case 'questionTool':
    case 'questionnaireTool':
    case 'secretRequestTool':
      return ['interaction_local']
    case 'providerConfigTool':
      return ['provider_setup']
    case 'scheduledTaskTool':
      return ['automation']
    case 'imTool':
      return ['im_ops']
    case 'systemDoctorTool':
      return ['doctor']
    case 'computerSystemInfoTool':
      return ['system_info']
    case 'widgetRenderer':
      return ['presentation']
    case 'computerUseTool':
      return ['computer_use']
    case 'webSearchTool':
    case 'webFetchTool':
      return ['web']
    default:
      return ['coding']
  }
}

const inferScopes = (
  tool: Pick<ToolDefinition, 'name'>,
  source: RuntimeToolRegistrySource,
  explicitScopes?: ConversationSourceKind[]
): ConversationSourceKind[] => {
  if (LOCAL_ONLY_TOOL_NAMES.has(tool.name)) return ['local']
  if (tool.name === 'computerSystemInfoTool') return ['local']
  if (tool.name === 'computerUseTool') return ['local']
  if (CROSS_SURFACE_TOOL_NAMES.has(tool.name)) return ['local', 'im']
  if (source === 'interaction') return ['local']
  return explicitScopes?.length ? uniqueSorted(explicitScopes) : ['local', 'im']
}

const inferDefaultActive = (toolsets: RuntimeToolsetId[]): boolean => {
  if (toolsets.includes('presentation')) return true
  return true
}

export const buildRuntimeToolRegistry = (
  groups: RuntimeToolRegistryGroup[]
): RuntimeToolRegistryEntry[] => {
  const byName = new Map<string, RuntimeToolRegistryEntry>()

  for (const group of groups) {
    for (const tool of group.tools) {
      const existing = byName.get(tool.name)
      const toolsets = inferToolsets(tool, group.source)
      const scopes = inferScopes(tool, group.source, group.scopes)
      byName.set(tool.name, {
        name: tool.name,
        label: tool.label,
        description: tool.description,
        source: group.source,
        builtin: group.source !== 'mcp' && group.source !== 'plugin',
        parameterKeys: extractParameterKeys(tool.parameters),
        parameters: tool.parameters,
        promptSnippet: tool.promptSnippet,
        overriddenSources: existing
          ? uniqueSorted([...existing.overriddenSources, existing.source])
          : [],
        toolsets: existing ? uniqueSorted([...existing.toolsets, ...toolsets]) : toolsets,
        scopes: existing ? uniqueSorted([...existing.scopes, ...scopes]) : scopes,
        defaultActive:
          existing?.defaultActive ??
          inferDefaultActive(existing ? [...existing.toolsets, ...toolsets] : toolsets)
      })
    }
  }

  return [...byName.values()].sort((left, right) => {
    if (left.source === right.source) return left.name.localeCompare(right.name)
    return left.source.localeCompare(right.source)
  })
}
