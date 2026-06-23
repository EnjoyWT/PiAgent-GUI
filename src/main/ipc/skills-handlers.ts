import { ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { loadSkills, type ResourceDiagnostic } from '@enjoywt/pi-coding-agent'
import { getAgentPluginStateService } from '../agent-plugins/agent-plugin-state-service-singleton'
import { getSetting, setSetting } from '../db/config-db'
import { getDefaultSharedSkillsDir, getDefaultSkillsDir, getPreferredAppConfigDir } from '../paths'
import { resolveSkillSearchPaths } from '../skills/skill-path-service'
import { installSkillsFromGitHub } from '../skills/skills-install-service'
import { ensureSkillsDir } from '../skills/skills-root-service'

const skillsDisabledKey = (): string => `skills_disabled`
const skillsExtraDirsKey = (): string => `skills_extra_dirs`

const getAgentDir = (): string => path.join(getPreferredAppConfigDir(), 'agent')

const readExtraDirs = (): string[] => {
  const raw = getSetting(skillsExtraDirsKey())
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const dirs = parsed
      .filter((x) => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => path.resolve(x))
      .filter((p) => {
        try {
          return existsSync(p) && statSync(p).isDirectory()
        } catch {
          return false
        }
      })
    return Array.from(new Set(dirs))
  } catch {
    return []
  }
}

const getSkillsRootDir = (): {
  rootDir: string
  defaultRootDir: string
  installRootDir: string
} => {
  const defaultRootDir = getDefaultSkillsDir()
  const installRootDir = getDefaultSharedSkillsDir()
  ensureSkillsDir(defaultRootDir)
  if (!existsSync(installRootDir)) mkdirSync(installRootDir, { recursive: true })

  return {
    rootDir: defaultRootDir,
    defaultRootDir,
    installRootDir
  }
}

const isUnderDir = (filePath: string, dir: string): boolean => {
  const root = path.resolve(dir)
  const target = path.resolve(filePath)
  if (target === root) return true
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  return target.startsWith(prefix)
}

const getGlobalSkillPaths = (): string[] => {
  const { rootDir } = getSkillsRootDir()
  const agentPluginState = getAgentPluginStateService()
  return resolveSkillSearchPaths({
    managedSkillsDir: rootDir,
    extraDirs: readExtraDirs(),
    isAgentPluginComponentEnabled: (pluginId, componentType, componentId) =>
      agentPluginState.isComponentEnabled(pluginId, componentType, componentId)
  })
}

const loadKnownSkills = (): ReturnType<typeof loadSkills> =>
  loadSkills({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    includeDefaults: false,
    skillPaths: getGlobalSkillPaths()
  })

type KnownSkillsResult = ReturnType<typeof loadSkills>
const legacySkillDoctorKey = ['diag', 'nostics'].join('')

const readLegacySkillDoctor = (result: KnownSkillsResult): ResourceDiagnostic[] =>
  Reflect.get(result, legacySkillDoctorKey) as ResourceDiagnostic[]

export type SkillsListResponse = {
  rootDir: string
  defaultRootDir: string
  installRootDir: string
  extraDirs: string[]
  skills: {
    name: string
    description: string
    path: string
    source: string
    enabled: boolean
    disableModelInvocation: boolean
  }[]
  doctor: ResourceDiagnostic[]
}

export function buildSkillsListResponse(input: {
  rootDir: string
  defaultRootDir: string
  installRootDir: string
  extraDirs: string[]
  disabled: Set<string>
  result: KnownSkillsResult
}): SkillsListResponse {
  const skills = input.result.skills
    .map((s) => ({
      name: s.name,
      description: s.description,
      path: s.filePath,
      source: s.sourceInfo.source,
      enabled: !input.disabled.has(s.name),
      disableModelInvocation: Boolean(s.disableModelInvocation)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    rootDir: input.rootDir,
    defaultRootDir: input.defaultRootDir,
    installRootDir: input.installRootDir,
    extraDirs: input.extraDirs,
    skills,
    doctor: readLegacySkillDoctor(input.result)
  }
}

const readDisabledSet = (): Set<string> => {
  const raw = getSetting(skillsDisabledKey())
  if (!raw) return new Set<string>()
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set<string>()
    return new Set(arr.filter((x) => typeof x === 'string'))
  } catch {
    return new Set<string>()
  }
}

const writeDisabledSet = (set: Set<string>): void => {
  setSetting(skillsDisabledKey(), JSON.stringify(Array.from(set.values()).sort()))
}

export function setupSkillsHandlers(): void {
  ipcMain.handle('skills:get-root-dir', async () => {
    const { rootDir, defaultRootDir, installRootDir } = getSkillsRootDir()
    return { rootDir, defaultRootDir, installRootDir, extraDirs: readExtraDirs() }
  })

  ipcMain.handle('skills:open-folder', async () => {
    const { rootDir: dir, defaultRootDir, installRootDir } = getSkillsRootDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
    return {
      success: true,
      rootDir: dir,
      defaultRootDir,
      installRootDir,
      extraDirs: readExtraDirs()
    }
  })

  ipcMain.handle('skills:add-extra-dir', async (_, dir: string) => {
    const next = (dir ?? '').trim()
    if (!next) return { success: false, error: 'Empty directory' }
    const resolved = path.resolve(next)
    if (!existsSync(resolved)) return { success: false, error: 'Directory does not exist' }
    try {
      if (!statSync(resolved).isDirectory())
        return { success: false, error: 'Path is not a directory' }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }

    const current = readExtraDirs()
    const updated = Array.from(new Set([...current, resolved])).sort()
    setSetting(skillsExtraDirsKey(), JSON.stringify(updated))
    const { rootDir, defaultRootDir, installRootDir } = getSkillsRootDir()
    return { success: true, rootDir, defaultRootDir, installRootDir, extraDirs: updated }
  })

  ipcMain.handle('skills:remove-extra-dir', async (_, dir: string) => {
    const resolved = path.resolve((dir ?? '').trim())
    const current = readExtraDirs()
    const updated = current.filter((p) => p !== resolved)
    setSetting(skillsExtraDirsKey(), JSON.stringify(updated))
    const { rootDir, defaultRootDir, installRootDir } = getSkillsRootDir()
    return { success: true, rootDir, defaultRootDir, installRootDir, extraDirs: updated }
  })

  ipcMain.handle('skills:list', async () => {
    const { rootDir: dir, defaultRootDir, installRootDir } = getSkillsRootDir()
    const extraDirs = readExtraDirs()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const disabled = readDisabledSet()

    const result = loadKnownSkills()

    return buildSkillsListResponse({
      rootDir: dir,
      defaultRootDir,
      installRootDir,
      extraDirs,
      disabled,
      result
    })
  })

  ipcMain.handle(
    'skills:install',
    async (_, source: string, options?: { force?: boolean; ref?: string }) => {
      try {
        const { rootDir, installRootDir } = getSkillsRootDir()
        const result = await installSkillsFromGitHub({
          source,
          targetDir: installRootDir,
          force: Boolean(options?.force),
          ref: typeof options?.ref === 'string' ? options.ref : undefined
        })
        return { success: true, rootDir, installRootDir, result }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('skills:set-enabled', async (_, name: string, enabled: boolean) => {
    const disabled = readDisabledSet()
    if (enabled) disabled.delete(name)
    else disabled.add(name)
    writeDisabledSet(disabled)
    return { success: true }
  })

  ipcMain.handle('skills:read', async (_, name: string) => {
    const result = loadKnownSkills()
    const skill = result.skills.find((s) => s.name === name)
    if (!skill) return { success: false, error: 'Skill not found' }
    try {
      const content = readFileSync(skill.filePath, 'utf-8')
      return { success: true, path: skill.filePath, content }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('skills:delete', async (_, name: string) => {
    const result = loadKnownSkills()
    const skill = result.skills.find((s) => s.name === name)
    if (!skill) return { success: false, error: 'Skill not found' }

    try {
      // Safety: only allow deleting skills under PiAgent-managed roots.
      const { rootDir, installRootDir } = getSkillsRootDir()
      const allowedRoots = [rootDir, installRootDir]
      if (!allowedRoots.some((dir) => isUnderDir(skill.filePath, dir))) {
        return {
          success: false,
          error: `Only skills under ${rootDir} or ${installRootDir} can be deleted`
        }
      }

      const filePath = skill.filePath
      const baseName = path.basename(filePath).toLowerCase()
      if (baseName === 'skill.md') {
        rmSync(path.dirname(filePath), { recursive: true, force: true })
      } else {
        rmSync(filePath, { force: true })
      }

      const disabled = readDisabledSet()
      disabled.delete(name)
      writeDisabledSet(disabled)

      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
