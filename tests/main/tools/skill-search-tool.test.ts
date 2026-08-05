import test from 'node:test'
import assert from 'node:assert/strict'
import type { ExtensionContext, Skill } from '@earendil-works/pi-coding-agent'
import { createSkillSearchTool } from '../../../src/main/tools/skill-search-tool.ts'

const createSkill = (name: string, description: string, disabled = false): Skill =>
  ({
    name,
    description,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    sourceInfo: { source: 'test' },
    disableModelInvocation: disabled
  }) as Skill

const testContext = {} as ExtensionContext

test('skillSearch returns compact matching enabled skill metadata', async () => {
  const tool = createSkillSearchTool({
    getSkills: () => [
      createSkill('pdf', 'Read, create, and inspect PDF documents.'),
      createSkill('ios-debugger', 'Run and debug iOS applications.'),
      createSkill('hidden', 'Must not be shown.', true)
    ]
  })

  const result = await tool.execute(
    'search-1',
    { query: 'PDF document' },
    undefined,
    undefined,
    testContext
  )
  const details = result.details as { skills: Array<{ name: string; description: string }> }

  assert.deepEqual(details.skills, [
    { name: 'pdf', description: 'Read, create, and inspect PDF documents.' }
  ])
  assert.doesNotMatch(JSON.stringify(details), /filePath|SKILL\.md|hidden/)
})
