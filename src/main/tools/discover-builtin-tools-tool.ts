import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type {
  RuntimeToolCatalogEntry,
  RuntimeToolCatalogSource
} from '../runtime-host/runtime-tool-layer/runtime-tool-catalog.ts'
import type { RuntimeToolsetId } from '../runtime-host/runtime-tool-layer/runtime-tool-registry.ts'

type CreateDiscoverBuiltinToolsToolOptions = {
  getCatalog: () => RuntimeToolCatalogEntry[]
}

const parametersSchema = Type.Object(
  {
    action: Type.Optional(
      Type.String({
        enum: ['discover_builtin_tools', 'get_tool_detail']
      })
    ),
    toolName: Type.Optional(Type.String()),
    query: Type.Optional(Type.String()),
    source: Type.Optional(
      Type.String({
        enum: ['all', 'builtin', 'framework', 'interaction', 'surface', 'mcp', 'plugin']
      })
    ),
    status: Type.Optional(
      Type.String({
        enum: ['all', 'active', 'discoverable', 'blocked']
      })
    ),
    toolset: Type.Optional(Type.String()),
    includeParameters: Type.Optional(Type.Boolean()),
    includeMcp: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
)

const BUILTIN_SOURCES = new Set<RuntimeToolCatalogSource>([
  'builtin',
  'framework',
  'interaction',
  'plugin',
  'surface'
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asTrimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const summarizeEntries = (entries: RuntimeToolCatalogEntry[]): string => {
  if (entries.length === 0) return 'No matching runtime tools were found.'

  const groups = new Map<string, RuntimeToolCatalogEntry[]>()
  for (const entry of entries) {
    const key = `${entry.status}:${entry.source}`
    const bucket = groups.get(key) ?? []
    bucket.push(entry)
    groups.set(key, bucket)
  }

  return [...groups.entries()]
    .map(([key, items]) => {
      const [status, source] = key.split(':')
      return `${status}/${source}: ${items.map((item) => item.name).join(', ')}`
    })
    .join('\n')
}

const serializeEntry = (
  entry: RuntimeToolCatalogEntry,
  includeParameters: boolean
): RuntimeToolCatalogEntry | Omit<RuntimeToolCatalogEntry, 'parameters'> => {
  if (includeParameters) return entry
  const { parameters: _parameters, ...rest } = entry
  return rest
}

const matchesToolset = (entry: RuntimeToolCatalogEntry, toolset: string): boolean => {
  const normalized = toolset.toLowerCase()
  return entry.toolsets.some(
    (candidate: RuntimeToolsetId) => candidate.toLowerCase() === normalized
  )
}

export const createDiscoverBuiltinToolsTool = ({
  getCatalog
}: CreateDiscoverBuiltinToolsToolOptions): ToolDefinition => ({
  name: 'discoverBuiltinToolsTool',
  label: 'Discover Builtin Tools Tool',
  description:
    'Discover the current active runtime tool catalog with toolsets, parameter keys, and source information. Use this when you need to inspect which tools are available on the current runtime surface. This is for capability discovery only; use `systemDoctorTool` for health checks and `imTool` for actual IM operations.',
  parameters: parametersSchema,
  execute: async (_toolCallId, params) => {
    const input = isRecord(params) ? params : {}
    const action = asTrimmed(input.action) || 'discover_builtin_tools'
    const sourceFilter = asTrimmed(input.source)
    const statusFilter = asTrimmed(input.status)
    const toolsetFilter = asTrimmed(input.toolset)
    const includeParameters = Boolean(input.includeParameters)
    const includeMcp = Boolean(input.includeMcp)
    const query = asTrimmed(input.query).toLowerCase()
    const catalog = getCatalog()

    const filtered = catalog.filter((entry) => {
      if (sourceFilter && sourceFilter !== 'all' && entry.source !== sourceFilter) return false
      if (statusFilter && statusFilter !== 'all' && entry.status !== statusFilter) return false
      if (!includeMcp && !sourceFilter && !BUILTIN_SOURCES.has(entry.source)) return false
      if (toolsetFilter && !matchesToolset(entry, toolsetFilter)) return false
      if (!query) return true
      const haystack = [
        entry.name,
        entry.label,
        entry.description,
        entry.source,
        entry.status,
        ...entry.toolsets,
        ...entry.parameterKeys
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })

    if (action === 'get_tool_detail') {
      const toolName = asTrimmed(input.toolName)
      if (!toolName) throw new Error('toolName is required')
      const entry =
        filtered.find((item) => item.name === toolName) ??
        catalog.find((item) => item.name === toolName)
      if (!entry) throw new Error(`Unknown tool: ${toolName}`)
      return {
        content: [
          {
            type: 'text' as const,
            text: `${entry.name} [${entry.status}/${entry.source}] - ${entry.description}`
          }
        ],
        details: {
          action,
          tool: serializeEntry(entry, includeParameters)
        }
      }
    }

    return {
      content: [{ type: 'text' as const, text: summarizeEntries(filtered) }],
      details: {
        action,
        count: filtered.length,
        tools: filtered.map((entry) => serializeEntry(entry, includeParameters))
      }
    }
  }
})
