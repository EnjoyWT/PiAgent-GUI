import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  installSkillsFromGitHub,
  readSkillInstallMetadata,
  type InstallSkillsFromGitHubResult,
  type SkillInstallMetadata
} from './skills-install-service'
import { isBundledSkillEntry, markBundledSkillRemoved } from './skills-root-service'

type SkillFrontmatter = {
  name: string
  description: string | null
}

type SkillsShSearchPayload = {
  skills?: SkillsShSearchItem[]
}

type SkillsShSearchItem = {
  id?: string
  name?: string
  installs?: number
  source?: string
}

export type InstalledSkillSummary = {
  name: string
  directoryName: string
  description: string | null
  path: string
  sourceKind: 'managed' | 'bundled' | 'manual'
  installMetadata: SkillInstallMetadata | null
}

export type ListInstalledSkillsResult = {
  targetDir: string
  skills: InstalledSkillSummary[]
}

export type SearchSkillsResultItem = {
  name: string
  slug: string
  source: string
  installSource: string
  detailUrl: string
  installs: number
}

export type SearchSkillsResult = {
  query: string
  items: SearchSkillsResultItem[]
}

export type UninstallSkillResult = {
  targetDir: string
  skill: InstalledSkillSummary
}

export type UpdatedSkillBundle = {
  source: string
  ref: string
  requestedSkills: string[]
  result: InstallSkillsFromGitHubResult
}

export type UpdateSkillsSkippedItem = {
  name: string
  reason: string
}

export type UpdateInstalledSkillsResult = {
  targetDir: string
  updatedBundles: UpdatedSkillBundle[]
  skippedSkills: UpdateSkillsSkippedItem[]
  notFound: string[]
}

const SKILLS_SH_BASE_URL = 'https://skills.sh'

const parseFrontmatterField = (frontmatter: string, key: string): string | null => {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(frontmatter)
  if (!match?.[1]) return null
  const normalized = match[1].trim().replace(/^['"]|['"]$/g, '')
  return normalized || null
}

const readSkillFrontmatter = (skillDir: string, directoryName: string): SkillFrontmatter => {
  const skillFilePath = path.join(skillDir, 'SKILL.md')
  if (!existsSync(skillFilePath)) {
    return { name: directoryName, description: null }
  }

  try {
    const contents = readFileSync(skillFilePath, 'utf8')
    const frontmatterMatch = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents)
    if (!frontmatterMatch) {
      return { name: directoryName, description: null }
    }

    return {
      name: parseFrontmatterField(frontmatterMatch[1], 'name') ?? directoryName,
      description: parseFrontmatterField(frontmatterMatch[1], 'description')
    }
  } catch {
    return { name: directoryName, description: null }
  }
}

const normalizeName = (value: string): string => value.trim().toLowerCase()

const readInstalledSkill = (
  targetDir: string,
  directoryName: string
): InstalledSkillSummary | null => {
  const skillPath = path.join(targetDir, directoryName)
  try {
    if (!statSync(skillPath).isDirectory()) return null
  } catch {
    return null
  }

  const installMetadata = readSkillInstallMetadata(skillPath)
  const frontmatter = readSkillFrontmatter(skillPath, directoryName)
  const sourceKind: InstalledSkillSummary['sourceKind'] = installMetadata
    ? 'managed'
    : isBundledSkillEntry(directoryName)
      ? 'bundled'
      : 'manual'

  return {
    name: installMetadata?.skillName || frontmatter.name,
    directoryName,
    description: frontmatter.description,
    path: skillPath,
    sourceKind,
    installMetadata
  }
}

const findSkillMatches = (
  skills: InstalledSkillSummary[],
  requestedName: string
): InstalledSkillSummary[] => {
  const normalizedRequestedName = normalizeName(requestedName)
  return skills.filter(
    (skill) =>
      normalizeName(skill.name) === normalizedRequestedName ||
      normalizeName(skill.directoryName) === normalizedRequestedName
  )
}

const uniqueSorted = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  )

const asJsonErrorMessage = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null
  const message = (payload as { message?: unknown }).message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'piagent'
    }
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message = asJsonErrorMessage(payload)
    throw new Error(
      message ? `skills.sh 请求失败：${message}` : `skills.sh 请求失败：HTTP ${response.status}`
    )
  }

  return payload as T
}

export const searchSkills = async (query: string, limit = 10): Promise<SearchSkillsResult> => {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) throw new Error('Missing skill search query')
  if (normalizedQuery.length < 2)
    throw new Error('Skill search query must be at least 2 characters')

  const cappedLimit = Math.max(1, Math.min(limit, 20))
  const url = `${SKILLS_SH_BASE_URL}/api/search?q=${encodeURIComponent(normalizedQuery)}&limit=${cappedLimit}`
  const payload = await fetchJson<SkillsShSearchPayload>(url)
  const items = Array.isArray(payload.skills) ? payload.skills : []

  return {
    query: normalizedQuery,
    items: items
      .map((skill) => {
        const name = String(skill.name ?? '').trim()
        const slug = String(skill.id ?? '').trim()
        const source = String(skill.source ?? '').trim()
        if (!name || !slug || !source) return null

        return {
          name,
          slug,
          source,
          installSource: `${source}@${name}`,
          detailUrl: `${SKILLS_SH_BASE_URL}/${slug}`,
          installs: Number.isFinite(skill.installs) ? Number(skill.installs) : 0
        } satisfies SearchSkillsResultItem
      })
      .filter((item): item is SearchSkillsResultItem => Boolean(item))
      .sort((a, b) => b.installs - a.installs)
      .slice(0, cappedLimit)
  }
}

export const listInstalledSkills = (targetDir: string): ListInstalledSkillsResult => {
  const resolvedTargetDir = path.resolve(targetDir)
  if (!existsSync(resolvedTargetDir)) {
    return {
      targetDir: resolvedTargetDir,
      skills: []
    }
  }

  const skills = readdirSync(resolvedTargetDir)
    .filter((entry) => !entry.startsWith('.'))
    .map((entry) => readInstalledSkill(resolvedTargetDir, entry))
    .filter((skill): skill is InstalledSkillSummary => Boolean(skill))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    targetDir: resolvedTargetDir,
    skills
  }
}

export const uninstallSkill = (targetDir: string, requestedName: string): UninstallSkillResult => {
  const normalizedRequestedName = requestedName.trim()
  if (!normalizedRequestedName) throw new Error('Missing skill name')

  const result = listInstalledSkills(targetDir)
  const matches = findSkillMatches(result.skills, normalizedRequestedName)
  if (matches.length === 0) {
    throw new Error(`Skill not found: ${normalizedRequestedName}`)
  }
  if (matches.length > 1) {
    throw new Error(
      `Skill name is ambiguous: ${normalizedRequestedName} (${matches
        .map((skill) => skill.directoryName)
        .join(', ')})`
    )
  }

  const [skill] = matches
  rmSync(skill.path, { recursive: true, force: true })

  if (skill.sourceKind === 'bundled') {
    markBundledSkillRemoved(result.targetDir, skill.directoryName)
  }

  return {
    targetDir: result.targetDir,
    skill
  }
}

export const updateInstalledSkills = async (
  targetDir: string,
  requestedNames: string[]
): Promise<UpdateInstalledSkillsResult> => {
  const result = listInstalledSkills(targetDir)
  const selectedSkills: InstalledSkillSummary[] = []
  const notFound: string[] = []

  const names = uniqueSorted(requestedNames)
  if (names.length === 0) {
    selectedSkills.push(...result.skills)
  } else {
    for (const requestedName of names) {
      const matches = findSkillMatches(result.skills, requestedName)
      if (matches.length === 0) {
        notFound.push(requestedName)
        continue
      }
      if (matches.length > 1) {
        throw new Error(
          `Skill name is ambiguous: ${requestedName} (${matches
            .map((skill) => skill.directoryName)
            .join(', ')})`
        )
      }
      selectedSkills.push(matches[0])
    }
  }

  const skippedSkills: UpdateSkillsSkippedItem[] = []
  const bundleSelections = new Map<
    string,
    {
      metadata: SkillInstallMetadata
      requestedSkills: string[]
    }
  >()

  for (const skill of selectedSkills) {
    if (!skill.installMetadata) {
      skippedSkills.push({
        name: skill.name,
        reason:
          skill.sourceKind === 'bundled'
            ? 'Bundled skill does not have an install source to update from'
            : 'Skill is not managed by piagent skills install'
      })
      continue
    }

    const key = `${skill.installMetadata.source}#${skill.installMetadata.ref}`
    const existing = bundleSelections.get(key)
    if (existing) {
      existing.requestedSkills.push(skill.name)
      continue
    }

    bundleSelections.set(key, {
      metadata: skill.installMetadata,
      requestedSkills: [skill.name]
    })
  }

  const updatedBundles: UpdatedSkillBundle[] = []
  for (const { metadata, requestedSkills } of bundleSelections.values()) {
    const installResult = await installSkillsFromGitHub({
      source: metadata.source,
      targetDir: result.targetDir,
      force: true,
      ref: metadata.ref
    })

    updatedBundles.push({
      source: metadata.source,
      ref: metadata.ref,
      requestedSkills: uniqueSorted(requestedSkills),
      result: installResult
    })
  }

  return {
    targetDir: result.targetDir,
    updatedBundles,
    skippedSkills,
    notFound
  }
}
