import type { ConversationSourceKind } from '../../core-v2/domain.ts'
import type { RuntimeToolRegistryEntry, RuntimeToolsetId } from './runtime-tool-registry.ts'

export type RuntimeToolStatus = 'active' | 'discoverable' | 'blocked'

export type RuntimeToolResolverContext = {
  surface: ConversationSourceKind
  toolProfileId?: string | null
  activeToolNames?: string[] | null
}

export type RuntimeResolvedToolEntry = RuntimeToolRegistryEntry & {
  status: RuntimeToolStatus
  blockedReason?: string
}

export type RuntimeToolResolution = {
  activeToolNames: string[]
  enabledToolsets: RuntimeToolsetId[]
  entries: RuntimeResolvedToolEntry[]
}

const ALWAYS_ACTIVE_TOOLSETS = new Set<RuntimeToolsetId>(['discovery'])

const uniqueSorted = <T extends string>(values: Iterable<T>): T[] =>
  Array.from(new Set(values)).sort((left, right) => left.localeCompare(right)) as T[]

const resolveEnabledToolsets = (
  registry: RuntimeToolRegistryEntry[],
  context: RuntimeToolResolverContext
): RuntimeToolsetId[] => {
  const allToolsets = uniqueSorted(registry.flatMap((entry) => entry.toolsets))
  if (context.toolProfileId === 'minimal') {
    return allToolsets.filter((toolset) =>
      new Set<RuntimeToolsetId>(['coding', 'doctor', 'discovery']).has(toolset)
    )
  }
  return allToolsets
}

export const resolveRuntimeTools = (
  registry: RuntimeToolRegistryEntry[],
  context: RuntimeToolResolverContext
): RuntimeToolResolution => {
  const enabledToolsets = resolveEnabledToolsets(registry, context)
  const eligibleEntries = registry.filter((entry) => entry.scopes.includes(context.surface))
  const defaultActiveToolNames = eligibleEntries
    .filter(
      (entry) =>
        entry.defaultActive && entry.toolsets.some((toolset) => enabledToolsets.includes(toolset))
    )
    .map((entry) => entry.name)
  const mandatoryToolNames = eligibleEntries
    .filter((entry) => entry.toolsets.some((toolset) => ALWAYS_ACTIVE_TOOLSETS.has(toolset)))
    .map((entry) => entry.name)
  const requestedActiveToolNames =
    context.activeToolNames && context.activeToolNames.length > 0
      ? context.activeToolNames
      : defaultActiveToolNames
  const activeToolNames = uniqueSorted(
    requestedActiveToolNames
      .filter((name) => eligibleEntries.some((entry) => entry.name === name))
      .concat(mandatoryToolNames)
  )

  return {
    activeToolNames,
    enabledToolsets,
    entries: registry.map((entry) => {
      if (!entry.scopes.includes(context.surface)) {
        return {
          ...entry,
          status: 'blocked' as const,
          blockedReason: `Unavailable on the ${context.surface} runtime surface.`
        }
      }

      if (activeToolNames.includes(entry.name)) {
        return {
          ...entry,
          status: 'active' as const
        }
      }

      return {
        ...entry,
        status: 'discoverable' as const
      }
    })
  }
}
