import type { ConversationSourceKind } from '../../core-v2/domain.ts'
import type { RuntimeToolsetId } from './runtime-tool-registry.ts'
import type { RuntimeResolvedToolEntry, RuntimeToolStatus } from './runtime-tool-resolver.ts'

export type RuntimeToolCatalogEntry = {
  name: string
  label: string
  description: string
  source: RuntimeToolCatalogSource
  builtin: boolean
  parameterKeys: string[]
  parameters: unknown
  promptSnippet?: string
  overriddenSources: RuntimeToolCatalogSource[]
  toolsets: RuntimeToolsetId[]
  scopes: ConversationSourceKind[]
  status: RuntimeToolStatus
  blockedReason?: string
}

export type RuntimeToolCatalogSource = RuntimeResolvedToolEntry['source']

const STATUS_ORDER: Record<RuntimeToolStatus, number> = {
  active: 0,
  discoverable: 1,
  blocked: 2
}

export const buildRuntimeToolCatalog = (
  entries: RuntimeResolvedToolEntry[]
): RuntimeToolCatalogEntry[] =>
  entries
    .map((entry) => ({
      name: entry.name,
      label: entry.label,
      description: entry.description,
      source: entry.source,
      builtin: entry.builtin,
      parameterKeys: entry.parameterKeys,
      parameters: entry.parameters,
      promptSnippet: entry.promptSnippet,
      overriddenSources: entry.overriddenSources,
      toolsets: entry.toolsets,
      scopes: entry.scopes,
      status: entry.status,
      blockedReason: entry.blockedReason
    }))
    .sort((left, right) => {
      const statusDelta = STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
      if (statusDelta !== 0) return statusDelta
      if (left.source === right.source) return left.name.localeCompare(right.name)
      return left.source.localeCompare(right.source)
    })
