import { app } from 'electron'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'

const SKILLS_ROOT_STATE_FILENAME = '.piagent-skills-state.json'

type SkillsRootState = {
  removedBundledEntries: string[]
}

const normalizeEntryNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    )
  )
}

const getStatePath = (skillsDir: string): string =>
  path.join(path.resolve(skillsDir), SKILLS_ROOT_STATE_FILENAME)

const readSkillsRootState = (skillsDir: string): SkillsRootState => {
  const statePath = getStatePath(skillsDir)
  if (!existsSync(statePath)) return { removedBundledEntries: [] }

  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as { removedBundledEntries?: unknown }
    return {
      removedBundledEntries: normalizeEntryNames(raw.removedBundledEntries)
    }
  } catch {
    return { removedBundledEntries: [] }
  }
}

const writeSkillsRootState = (skillsDir: string, state: SkillsRootState): void => {
  const normalized: SkillsRootState = {
    removedBundledEntries: normalizeEntryNames(state.removedBundledEntries)
  }
  const statePath = getStatePath(skillsDir)

  if (normalized.removedBundledEntries.length === 0) {
    rmSync(statePath, { force: true })
    return
  }

  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify(normalized, null, 2), 'utf8')
}

export const getBundledSkillsTemplateDir = (): string | null => {
  const appPath = app.getAppPath()
  const moduleDir =
    typeof import.meta.dirname === 'string' && import.meta.dirname
      ? import.meta.dirname
      : process.cwd()
  const resourcesPath =
    typeof process.resourcesPath === 'string' && process.resourcesPath
      ? process.resourcesPath
      : null
  const candidates = [
    path.join(moduleDir, '..', '..', '..', 'resources', 'skills'),
    path.join(process.cwd(), 'resources', 'skills'),
    resourcesPath ? path.join(resourcesPath, 'skills') : null,
    path.join(appPath, 'resources', 'skills'),
    path.join(appPath, '..', 'resources', 'skills'),
    path.join(appPath, '..', '..', 'resources', 'skills')
  ].filter((candidate): candidate is string => typeof candidate === 'string')
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export const isBundledSkillEntry = (entryName: string): boolean => {
  const bundledDir = getBundledSkillsTemplateDir()
  if (!bundledDir) return false
  return existsSync(path.join(bundledDir, entryName))
}

export const markBundledSkillRemoved = (skillsDir: string, entryName: string): void => {
  const normalizedEntry = entryName.trim()
  if (!normalizedEntry) return

  const state = readSkillsRootState(skillsDir)
  state.removedBundledEntries = normalizeEntryNames([
    ...state.removedBundledEntries,
    normalizedEntry
  ])
  writeSkillsRootState(skillsDir, state)
}

export const clearBundledSkillRemoval = (skillsDir: string, entryName: string): void => {
  const normalizedEntry = entryName.trim()
  if (!normalizedEntry) return

  const state = readSkillsRootState(skillsDir)
  const nextEntries = state.removedBundledEntries.filter((entry) => entry !== normalizedEntry)
  if (nextEntries.length === state.removedBundledEntries.length) return

  writeSkillsRootState(skillsDir, {
    removedBundledEntries: nextEntries
  })
}

export const ensureSkillsDir = (skillsDir: string): void => {
  const bundledDir = getBundledSkillsTemplateDir()
  mkdirSync(skillsDir, { recursive: true })

  if (!bundledDir) return

  const removedEntries = new Set(readSkillsRootState(skillsDir).removedBundledEntries)
  for (const entry of readdirSync(bundledDir)) {
    if (removedEntries.has(entry)) continue

    const source = path.join(bundledDir, entry)
    const destination = path.join(skillsDir, entry)
    if (!existsSync(destination)) {
      cpSync(source, destination, { recursive: true, force: false, errorOnExist: false })
    }
  }
}
