export type RuntimeCapabilityDescriptor = {
  name: string
  schemaTokens: number
  sourceVersion?: string
  pinned?: boolean
  dependencies?: string[]
}

type CapabilityLease = Required<
  Pick<RuntimeCapabilityDescriptor, 'name' | 'schemaTokens' | 'sourceVersion' | 'pinned' | 'dependencies'>
> & {
  activatedAtTurn: number
  lastUsedTurn: number
  useCount: number
}

export type RuntimeCapabilityState = {
  activate(entries: RuntimeCapabilityDescriptor[], turn: number): string[]
  markUsed(name: string, turn: number): void
  selectForTurn(turn: number, sourceVersions?: Record<string, string>): string[]
  clear(): void
  revision(): number
}

export type RuntimeCapabilityStateOptions = {
  coreToolNames: string[]
  maxToolCount: number
  maxSchemaTokens: number
}

const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort()

const normalizeDescriptor = (entry: RuntimeCapabilityDescriptor): CapabilityLease => ({
  name: entry.name,
  schemaTokens: Math.max(0, Math.floor(entry.schemaTokens)),
  sourceVersion: entry.sourceVersion ?? 'static',
  pinned: Boolean(entry.pinned),
  dependencies: uniqueSorted(entry.dependencies ?? []),
  activatedAtTurn: 0,
  lastUsedTurn: 0,
  useCount: 0
})

const sameLease = (left: CapabilityLease, right: CapabilityLease): boolean =>
  left.name === right.name &&
  left.schemaTokens === right.schemaTokens &&
  left.sourceVersion === right.sourceVersion &&
  left.pinned === right.pinned &&
  left.dependencies.join('\u0000') === right.dependencies.join('\u0000')

const compareLeases = (left: CapabilityLease, right: CapabilityLease): number => {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  if (left.lastUsedTurn !== right.lastUsedTurn) return right.lastUsedTurn - left.lastUsedTurn
  if (left.useCount !== right.useCount) return right.useCount - left.useCount
  return left.name.localeCompare(right.name)
}

export const createRuntimeCapabilityState = (
  options: RuntimeCapabilityStateOptions
): RuntimeCapabilityState => {
  const coreToolNames = uniqueSorted(options.coreToolNames)
  const leases = new Map<string, CapabilityLease>()
  let currentRevision = 0

  const removeStaleLeases = (sourceVersions?: Record<string, string>): boolean => {
    if (!sourceVersions) return false
    let changed = false
    for (const [name, lease] of leases) {
      const currentVersion = sourceVersions[name]
      if (currentVersion === undefined || currentVersion !== lease.sourceVersion) {
        leases.delete(name)
        changed = true
      }
    }
    return changed
  }

  return {
    activate(entries, turn) {
      const activated: string[] = []
      let changed = false
      for (const rawEntry of entries) {
        if (!rawEntry.name.trim() || coreToolNames.includes(rawEntry.name)) continue
        const next = normalizeDescriptor(rawEntry)
        const previous = leases.get(next.name)
        if (!previous || !sameLease(previous, next)) {
          leases.set(next.name, {
            ...next,
            activatedAtTurn: turn,
            lastUsedTurn: turn,
            useCount: (previous?.useCount ?? 0) + 1
          })
          changed = true
        }
        activated.push(next.name)
      }
      if (changed) currentRevision += 1
      return uniqueSorted(activated)
    },

    markUsed(name, turn) {
      const lease = leases.get(name)
      if (!lease) return
      lease.lastUsedTurn = Math.max(lease.lastUsedTurn, turn)
      lease.useCount += 1
    },

    selectForTurn(_turn, sourceVersions) {
      let changed = removeStaleLeases(sourceVersions)
      const retained = new Set<string>()
      let selectedCount = 0
      let selectedTokens = 0

      for (const lease of [...leases.values()].sort(compareLeases)) {
        const groupNames = uniqueSorted([lease.name, ...lease.dependencies])
        const group = groupNames.map((name) => leases.get(name)).filter(Boolean) as CapabilityLease[]
        if (group.length !== groupNames.length) continue
        if (group.some((item) => retained.has(item.name))) continue
        const groupTokens = group.reduce((sum, item) => sum + item.schemaTokens, 0)
        if (
          selectedCount + group.length > options.maxToolCount ||
          selectedTokens + groupTokens > options.maxSchemaTokens
        ) {
          continue
        }
        for (const item of group) retained.add(item.name)
        selectedCount += group.length
        selectedTokens += groupTokens
      }

      for (const name of leases.keys()) {
        if (!retained.has(name)) {
          leases.delete(name)
          changed = true
        }
      }
      if (changed) currentRevision += 1
      return [...coreToolNames, ...uniqueSorted(retained)]
    },

    clear() {
      if (leases.size === 0) return
      leases.clear()
      currentRevision += 1
    },

    revision: () => currentRevision
  }
}
