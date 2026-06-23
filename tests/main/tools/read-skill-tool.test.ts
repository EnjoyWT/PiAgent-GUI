import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionContext, Skill } from '@enjoywt/pi-coding-agent'
import { createReadSkillTool } from '../../../src/main/tools/read-skill-tool.ts'

type TextToolResult = {
  content: Array<{ type: string; text?: string }>
  details?: unknown
}

const testContext = {} as ExtensionContext

const firstText = (result: TextToolResult): string => {
  const first = result.content[0]
  return first?.type === 'text' ? (first.text ?? '') : ''
}

const createSkill = (name: string, filePath: string): Skill =>
  ({
    name,
    description: `${name} description`,
    filePath,
    baseDir: path.dirname(filePath),
    sourceInfo: { source: 'test' },
    disableModelInvocation: false
  }) as Skill

test('readSkillTool strips SKILL.md frontmatter by default', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'piagent-read-skill-'))
  try {
    const skillFile = path.join(dir, 'SKILL.md')
    await writeFile(
      skillFile,
      [
        '---',
        'name: demo-skill',
        'description: Demo skill',
        '---',
        '',
        '# Demo Skill',
        '',
        'Use the exact project workflow.'
      ].join('\n'),
      'utf-8'
    )

    const tool = createReadSkillTool({
      getSkills: () => [createSkill('demo-skill', skillFile)]
    })

    const result = await tool.execute(
      'read-skill-1',
      { skillName: 'demo-skill' },
      undefined,
      undefined,
      testContext
    )

    assert.doesNotMatch(firstText(result), /^---/)
    assert.match(firstText(result), /# Demo Skill/)
    assert.match(firstText(result), /Use the exact project workflow\./)
    assert.equal((result.details as { skillName: string }).skillName, 'demo-skill')
    assert.equal((result.details as { includeFrontmatter: boolean }).includeFrontmatter, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readSkillTool can include SKILL.md frontmatter when requested', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'piagent-read-skill-'))
  try {
    const skillFile = path.join(dir, 'SKILL.md')
    await writeFile(
      skillFile,
      ['---', 'name: demo-skill', 'description: Demo skill', '---', '', '# Demo Skill'].join('\n'),
      'utf-8'
    )

    const tool = createReadSkillTool({
      getSkills: () => [createSkill('demo-skill', skillFile)]
    })

    const result = await tool.execute(
      'read-skill-2',
      { skillName: 'demo-skill', includeFrontmatter: true },
      undefined,
      undefined,
      testContext
    )

    assert.match(firstText(result), /^---\nname: demo-skill/)
    assert.equal((result.details as { includeFrontmatter: boolean }).includeFrontmatter, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
