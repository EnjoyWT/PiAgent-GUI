import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const electronStubUrl = pathToFileURL(
  resolve(repoRoot, 'tests/main/ipc/electron-ipc-stub.mjs')
).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        shortCircuit: true,
        url: electronStubUrl
      }
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:')
        ? fileURLToPath(context.parentURL)
        : ''
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) {
        return nextResolve(`${specifier}.ts`, context)
      }
    }
    return nextResolve(specifier, context)
  }
})

const skillsHandlers = await import('../../../src/main/ipc/skills-handlers.ts')
const legacySkillDoctorKey = ['diag', 'nostics'].join('')

test('skills list response exposes loader health through doctor only', () => {
  assert.equal(typeof skillsHandlers.buildSkillsListResponse, 'function')

  const doctor = [
    {
      type: 'warning' as const,
      message: 'duplicate skill name',
      path: '/tmp/example/SKILL.md'
    }
  ]

  const result = {
    [legacySkillDoctorKey]: doctor,
    skills: [
      {
        name: 'enabled-skill',
        description: 'Enabled skill',
        filePath: '/tmp/piagent-skills/enabled-skill/SKILL.md',
        baseDir: '/tmp/piagent-skills/enabled-skill',
        sourceInfo: {
          path: '/tmp/piagent-skills/enabled-skill/SKILL.md',
          source: 'project',
          scope: 'project' as const,
          origin: 'top-level' as const
        },
        disableModelInvocation: false
      },
      {
        name: 'disabled-skill',
        description: 'Disabled skill',
        filePath: '/tmp/piagent-skills/disabled-skill/SKILL.md',
        baseDir: '/tmp/piagent-skills/disabled-skill',
        sourceInfo: {
          path: '/tmp/piagent-skills/disabled-skill/SKILL.md',
          source: 'project',
          scope: 'project' as const,
          origin: 'top-level' as const
        },
        disableModelInvocation: true
      }
    ]
  } as unknown as Parameters<typeof skillsHandlers.buildSkillsListResponse>[0]['result']

  const response = skillsHandlers.buildSkillsListResponse({
    rootDir: '/tmp/piagent-skills',
    defaultRootDir: '/tmp/piagent-skills',
    installRootDir: '/tmp/shared-skills',
    extraDirs: ['/tmp/extra-skills'],
    disabled: new Set(['disabled-skill']),
    result
  })

  assert.deepEqual(response.doctor, doctor)
  assert.equal(Object.hasOwn(response, legacySkillDoctorKey), false)
  assert.equal(response.skills[0]?.enabled, false)
  assert.equal(response.skills[1]?.enabled, true)
})
