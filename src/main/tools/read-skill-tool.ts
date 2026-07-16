import { readFile } from 'node:fs/promises'
import type { Skill, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { stripFrontmatter } from '@earendil-works/pi-coding-agent'
import { Type } from '@sinclair/typebox'

type CreateReadSkillToolOptions = {
  getSkills: () => Skill[]
}

const parametersSchema = Type.Object(
  {
    skillName: Type.String({
      description: 'Name of the available skill to read.'
    }),
    includeFrontmatter: Type.Optional(
      Type.Boolean({
        description: 'Return the original SKILL.md frontmatter when true. Defaults to false.'
      })
    )
  },
  { additionalProperties: false }
)

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asTrimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const createReadSkillTool = ({ getSkills }: CreateReadSkillToolOptions): ToolDefinition => ({
  name: 'readSkillTool',
  label: 'Read Skill Tool',
  description:
    'Read the full instruction content for an available skill by skillName. By default this omits the SKILL.md frontmatter because available skill metadata is already present in the system context; set includeFrontmatter to true when the original file header is needed for display or debugging.',
  promptSnippet:
    'readSkillTool: read an available skill by skillName; frontmatter is omitted unless includeFrontmatter is true.',
  parameters: parametersSchema,
  execute: async (_toolCallId, params) => {
    const input = asRecord(params)
    const skillName = asTrimmed(input.skillName)
    if (!skillName) throw new Error('skillName is required')

    const skill = getSkills().find(
      (candidate) => candidate.name === skillName && !candidate.disableModelInvocation
    )
    if (!skill)
      throw new Error(`Skill not found or not available for model invocation: ${skillName}`)

    const includeFrontmatter = Boolean(input.includeFrontmatter)
    const rawContent = await readFile(skill.filePath, 'utf-8')
    const content = includeFrontmatter ? rawContent : stripFrontmatter(rawContent)

    return {
      content: [{ type: 'text' as const, text: content }],
      details: {
        action: 'read_skill',
        skillName,
        path: skill.filePath,
        includeFrontmatter
      }
    }
  }
})
