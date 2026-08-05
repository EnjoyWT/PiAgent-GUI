import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type { RuntimeToolCatalogEntry } from '../runtime-host/runtime-tool-layer/runtime-tool-catalog.ts'

export type CapabilityRejection = { name: string; reason: string }
export type CapabilityActivationResult = { activated: string[]; rejected: CapabilityRejection[] }

type SearchOptions = { getCatalog: () => RuntimeToolCatalogEntry[]; limit?: number }
type ActivateOptions = { activate: (names: string[]) => CapabilityActivationResult }

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asNames = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    : []

const compactEntry = (entry: RuntimeToolCatalogEntry) => {
  const { parameters: _parameters, promptSnippet: _promptSnippet, ...compact } = entry
  return compact
}

export const createCapabilitySearchTool = ({ getCatalog, limit = 8 }: SearchOptions): ToolDefinition => ({
  name: 'capabilitySearch',
  label: 'Capability Search',
  description: 'Search runtime capabilities before activating a non-core tool or Skill.',
  parameters: Type.Object({ query: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  execute: async (_toolCallId, params) => {
    const query = String(asRecord(params).query ?? '').trim().toLowerCase()
    const capabilities = getCatalog()
      .filter((entry) => entry.status !== 'blocked')
      .filter((entry) => {
        const haystack = [entry.name, entry.label, entry.description, entry.source, ...entry.toolsets]
          .join(' ')
          .toLowerCase()
        return query.split(/\s+/).every((term) => haystack.includes(term))
      })
      .slice(0, Math.max(1, limit))
      .map(compactEntry)
    return {
      content: [{ type: 'text' as const, text: capabilities.length ? capabilities.map((item) => `${item.name}: ${item.description}`).join('\n') : 'No matching capabilities were found.' }],
      details: { capabilities }
    }
  }
})

export const createCapabilityActivateTool = ({ activate }: ActivateOptions): ToolDefinition => ({
  name: 'capabilityActivate',
  label: 'Capability Activate',
  description: 'Activate previously discovered runtime capabilities for the next agent step.',
  parameters: Type.Object({ names: Type.Array(Type.String(), { minItems: 1 }), reason: Type.Optional(Type.String()) }, { additionalProperties: false }),
  execute: async (_toolCallId, params) => {
    const names = asNames(asRecord(params).names)
    const result = activate(names)
    return {
      content: [{ type: 'text' as const, text: result.activated.length ? `Activated: ${result.activated.join(', ')}` : 'No capabilities were activated.' }],
      details: result
    }
  }
})
