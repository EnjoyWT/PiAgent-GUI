import type { Skill, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from '@sinclair/typebox'

type CreateSkillSearchToolOptions = {
  getSkills: () => Skill[]
  limit?: number
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export const createSkillSearchTool = ({
  getSkills,
  limit = 8
}: CreateSkillSearchToolOptions): ToolDefinition => ({
  name: 'skillSearch',
  label: 'Skill Search',
  description: 'Search available Skills before reading specialized task instructions.',
  parameters: Type.Object({ query: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  execute: async (_toolCallId, params) => {
    const query = String(asRecord(params).query ?? '').trim().toLowerCase()
    const terms = query.split(/\s+/).filter(Boolean)
    const skills = getSkills()
      .filter((skill) => !skill.disableModelInvocation)
      .filter((skill) => {
        const haystack = `${skill.name} ${skill.description}`.toLowerCase()
        return terms.every((term) => haystack.includes(term))
      })
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, Math.max(1, limit))
      .map((skill) => ({ name: skill.name, description: skill.description }))

    return {
      content: [
        {
          type: 'text' as const,
          text: skills.length
            ? skills.map((skill) => `${skill.name}: ${skill.description}`).join('\n')
            : 'No matching Skills were found.'
        }
      ],
      details: { skills }
    }
  }
})
