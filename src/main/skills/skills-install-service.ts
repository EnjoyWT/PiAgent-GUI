import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clearBundledSkillRemoval } from './skills-root-service'

export type InstallSkillsFromGitHubInput = {
  source: string
  targetDir: string
  force?: boolean
  ref?: string
  skill?: string
}

export type InstallSkillsFromGitHubResult = {
  owner: string
  repo: string
  ref: string
  repoUrl: string
  skillsPath: string
  targetDir: string
  fileCount: number
  installedEntries: string[]
}

export type SkillInstallMetadata = {
  version: 1
  skillName: string
  directoryName: string
  source: string
  owner: string
  repo: string
  repoUrl: string
  ref: string
  skillsPath: string
  installedAt: string
}

type ParsedGitHubSource = {
  owner: string
  repo: string
  ref?: string
  skillsPath: string
  sourcePath: string
  repoUrl: string
  skillFilter?: string
  installSource: string
}

type GitHubRepoPayload = {
  default_branch?: string
}

type GitHubContentItem = {
  type: string
  path: string
  download_url: string | null
}

const GITHUB_API_BASE_URL = 'https://api.github.com'
const SKILLS_SH_HOSTNAMES = new Set(['skills.sh', 'www.skills.sh'])
export const SKILL_INSTALL_METADATA_FILENAME = '.piagent-skill.json'
const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'piagent'
}

const asJsonErrorMessage = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null
  const message = (payload as { message?: unknown }).message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}

const normalizeRepoPath = (value?: string | null): string => {
  const normalized = String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')

  if (!normalized) return ''

  const segments = normalized.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('GitHub 路径不合法')
  }

  return segments.join('/')
}

const normalizeSkillFilter = (value?: string | null): string | undefined => {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}

const resolveSkillsPaths = (value?: string | null): { skillsPath: string; sourcePath: string } => {
  const normalized = normalizeRepoPath(value)
  if (!normalized) {
    return {
      skillsPath: 'skills',
      sourcePath: 'skills'
    }
  }

  const segments = normalized.split('/')
  const skillsIndex = segments.indexOf('skills')
  if (skillsIndex >= 0) {
    return {
      skillsPath: segments.slice(0, skillsIndex + 1).join('/'),
      sourcePath: segments.join('/')
    }
  }

  // 支持任意子路径：如果路径中没有 "skills"，我们直接把该路径作为 sourcePath 和 skillsPath，
  // 后面拉取文件列表后，会自动根据是否有根部 SKILL.md 来智能微调其父子层级关系。
  return {
    skillsPath: normalized,
    sourcePath: normalized
  }
}

const createCanonicalInstallSource = (
  owner: string,
  repo: string,
  skillFilter?: string,
  fallbackSource?: string
): string => {
  const normalizedSkillFilter = normalizeSkillFilter(skillFilter)
  if (fallbackSource) {
    const normalizedFallback = fallbackSource.trim()
    if (normalizedFallback) return normalizedFallback
  }
  return `${owner}/${repo}${normalizedSkillFilter ? `@${normalizedSkillFilter}` : ''}`
}

const scopeSourcePathToSkill = (parsed: ParsedGitHubSource): ParsedGitHubSource => {
  const skillFilter = normalizeSkillFilter(parsed.skillFilter)
  if (!skillFilter) return parsed
  if (parsed.sourcePath !== parsed.skillsPath) return parsed

  return {
    ...parsed,
    sourcePath: normalizeRepoPath(`${parsed.sourcePath}/${skillFilter}`)
  }
}

const parseGitHubSource = (
  source: string,
  refOverride?: string,
  skillOverride?: string
): ParsedGitHubSource => {
  const raw = String(source ?? '').trim()
  if (!raw) throw new Error('请输入 GitHub 仓库地址或 owner/repo')

  const normalizedRef = String(refOverride ?? '').trim() || undefined
  const normalizedSkillOverride = normalizeSkillFilter(skillOverride)

  const scpMatch = /^git@github\.com:([^/]+)\/([^#]+?)(?:\.git)?(?:#(.+))?$/i.exec(raw)
  if (scpMatch) {
    const owner = scpMatch[1]?.trim()
    const repo = scpMatch[2]?.trim()
    const refFromSource = scpMatch[3]?.trim() || undefined
    const ref = normalizedRef ?? refFromSource
    if (!owner || !repo) throw new Error('GitHub 地址不合法')
    return scopeSourcePathToSkill({
      owner,
      repo,
      ref,
      skillsPath: 'skills',
      sourcePath: 'skills',
      repoUrl: `https://github.com/${owner}/${repo}`,
      skillFilter: normalizedSkillOverride,
      installSource: createCanonicalInstallSource(owner, repo, normalizedSkillOverride)
    })
  }

  const shorthandMatch =
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:@([^#]+))?(?:#(.+))?$/.exec(raw)
  if (shorthandMatch) {
    const owner = shorthandMatch[1]?.trim()
    const repo = shorthandMatch[2]?.trim()
    const skillFromSource = normalizeSkillFilter(shorthandMatch[3])
    const refFromSource = shorthandMatch[4]?.trim() || undefined
    const ref = normalizedRef ?? refFromSource
    const skillFilter = normalizedSkillOverride ?? skillFromSource
    if (normalizedSkillOverride && skillFromSource && normalizedSkillOverride !== skillFromSource) {
      throw new Error('技能来源和 --skill 指定的技能名称不一致')
    }
    if (!owner || !repo) throw new Error('GitHub 地址不合法')
    return scopeSourcePathToSkill({
      owner,
      repo,
      ref,
      skillsPath: 'skills',
      sourcePath: 'skills',
      repoUrl: `https://github.com/${owner}/${repo}`,
      skillFilter,
      installSource: createCanonicalInstallSource(owner, repo, skillFilter)
    })
  }

  const rawUrl = raw.startsWith('git+') ? raw.slice(4) : raw
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('仅支持 GitHub 仓库地址或 owner/repo')
  }

  const hostname = url.hostname.toLowerCase()
  if (SKILLS_SH_HOSTNAMES.has(hostname)) {
    const segments = url.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)

    if (segments.length < 2) {
      throw new Error('skills.sh 地址不完整')
    }

    const owner = decodeURIComponent(segments[0])
    const repo = decodeURIComponent(segments[1])
    const skillFromSource = normalizeSkillFilter(
      segments[2] ? decodeURIComponent(segments[2]) : undefined
    )
    const skillFilter = normalizedSkillOverride ?? skillFromSource
    if (normalizedSkillOverride && skillFromSource && normalizedSkillOverride !== skillFromSource) {
      throw new Error('skills.sh 地址和 --skill 指定的技能名称不一致')
    }

    return scopeSourcePathToSkill({
      owner,
      repo,
      ref: normalizedRef,
      skillsPath: 'skills',
      sourcePath: 'skills',
      repoUrl: `https://github.com/${owner}/${repo}`,
      skillFilter,
      installSource: createCanonicalInstallSource(owner, repo, skillFilter)
    })
  }

  if (hostname !== 'github.com' && hostname !== 'www.github.com') {
    throw new Error('当前仅支持 GitHub 仓库地址、skills.sh 地址或 owner/repo')
  }

  const segments = url.pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length < 2) {
    throw new Error('GitHub 仓库地址不完整')
  }

  const owner = decodeURIComponent(segments[0])
  const repo = decodeURIComponent(segments[1]).replace(/\.git$/i, '')
  if (!owner || !repo) throw new Error('GitHub 仓库地址不完整')

  if (segments[2] === 'blob') {
    throw new Error('请提供仓库地址或 skills 目录地址，不支持单文件 blob 地址')
  }

  const pathFromTree =
    segments[2] === 'tree' && segments.length > 4
      ? segments
          .slice(4)
          .map((segment) => decodeURIComponent(segment))
          .join('/')
      : ''

  const refFromSource =
    segments[2] === 'tree' && segments[3] ? decodeURIComponent(segments[3]) : undefined

  const refFromHash =
    String(url.hash || '')
      .replace(/^#/, '')
      .trim() || undefined
  const ref = normalizedRef ?? refFromHash ?? refFromSource
  const resolvedPaths = resolveSkillsPaths(pathFromTree)

  return scopeSourcePathToSkill({
    owner,
    repo,
    ref: ref || undefined,
    skillsPath: resolvedPaths.skillsPath,
    sourcePath: resolvedPaths.sourcePath,
    repoUrl: `https://github.com/${owner}/${repo}`,
    skillFilter: normalizedSkillOverride,
    installSource: createCanonicalInstallSource(owner, repo, normalizedSkillOverride, raw)
  })
}

const createGitHubApiUrl = (owner: string, repo: string, resourcePath: string): string =>
  `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${resourcePath}`

const fetchGitHubJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { headers: GITHUB_HEADERS })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message = asJsonErrorMessage(payload)
    throw new Error(
      message ? `GitHub 请求失败：${message}` : `GitHub 请求失败：HTTP ${response.status}`
    )
  }

  return payload as T
}

const fetchGitHubFile = async (url: string): Promise<Buffer> => {
  const response = await fetch(url, { headers: { 'User-Agent': 'piagent' } })
  if (!response.ok) {
    throw new Error(`下载文件失败：HTTP ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

const listGitHubDirectoryFiles = async (
  owner: string,
  repo: string,
  dirPath: string,
  ref: string,
  visitedPaths = new Set<string>()
): Promise<GitHubContentItem[]> => {
  const encodedPath = dirPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  const resourcePath = `/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`
  const payload = await fetchGitHubJson<GitHubContentItem[] | GitHubContentItem>(
    createGitHubApiUrl(owner, repo, resourcePath)
  )

  if (!Array.isArray(payload)) {
    throw new Error(`GitHub 路径 "${dirPath}" 不是目录`)
  }

  const files: GitHubContentItem[] = []
  for (const item of payload) {
    if (item.type === 'file') {
      files.push(item)
      continue
    }
    if (item.type === 'dir') {
      files.push(...(await listGitHubDirectoryFiles(owner, repo, item.path, ref, visitedPaths)))
      continue
    }
    if (item.type === 'symlink') {
      if (!item.download_url) {
        continue
      }
      try {
        const symlinkContentBuffer = await fetchGitHubFile(item.download_url)
        const target = symlinkContentBuffer.toString('utf8').trim()

        const parentDir = path.posix.dirname(item.path)
        const targetPath = path.posix.resolve('/', parentDir, target).replace(/^\//, '')

        if (visitedPaths.has(targetPath)) {
          console.warn(`循环符号链接检测，跳过：${item.path} -> ${targetPath}`)
          continue
        }
        visitedPaths.add(targetPath)

        const targetResourcePath = `/contents/${targetPath.split('/').filter(Boolean).map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`
        const targetPayload = await fetchGitHubJson<GitHubContentItem[] | GitHubContentItem>(
          createGitHubApiUrl(owner, repo, targetResourcePath)
        )

        if (Array.isArray(targetPayload)) {
          const subFiles = await listGitHubDirectoryFiles(owner, repo, targetPath, ref, visitedPaths)
          for (const subFile of subFiles) {
            const relToTarget = path.posix.relative(targetPath, subFile.path)
            const mappedPath = path.posix.join(item.path, relToTarget)
            files.push({
              ...subFile,
              path: mappedPath
            })
          }
        } else {
          files.push({
            ...targetPayload,
            path: item.path
          })
        }
      } catch (err) {
        console.warn(`解析符号链接 "${item.path}" 失败:`, err)
      }
    }
  }

  return files
}

const relativePathFromSkillsRoot = (skillsPath: string, filePath: string): string => {
  const absSkills = '/' + skillsPath.split('/').filter(Boolean).join('/')
  const absFile = '/' + filePath.split('/').filter(Boolean).join('/')
  const relative = path.posix.relative(absSkills, absFile)
  const normalized = relative.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('../') || normalized === '..') {
    throw new Error(`技能文件路径异常：${filePath}`)
  }
  return normalized
}

const readSkillFrontmatterName = (skillDir: string, fallbackName: string): string => {
  const skillFilePath = path.join(skillDir, 'SKILL.md')
  if (!existsSync(skillFilePath)) return fallbackName

  try {
    const contents = readFileSync(skillFilePath, 'utf8')
    const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents)
    if (!match) return fallbackName

    const nameMatch = /^name:\s*(.+)$/m.exec(match[1])
    if (!nameMatch?.[1]) return fallbackName

    const normalized = nameMatch[1].trim().replace(/^['"]|['"]$/g, '')
    return normalized || fallbackName
  } catch {
    return fallbackName
  }
}

const selectInstalledEntries = (
  tempRoot: string,
  installedEntries: string[],
  skillFilter?: string
): string[] => {
  const normalizedSkillFilter = normalizeSkillFilter(skillFilter)
  if (!normalizedSkillFilter) return installedEntries
  const requestedName = normalizedSkillFilter.toLowerCase()

  const matches = installedEntries.filter((entry) => {
    if (entry.toLowerCase() === requestedName) return true

    const skillDir = path.join(tempRoot, entry)
    return readSkillFrontmatterName(skillDir, entry).toLowerCase() === requestedName
  })

  if (matches.length === 0) {
    throw new Error(`仓库中未找到技能：${normalizedSkillFilter}`)
  }

  if (matches.length > 1) {
    throw new Error(`匹配到多个同名技能：${normalizedSkillFilter} (${matches.join(', ')})`)
  }

  return matches
}

const writeSkillInstallMetadata = (
  targetDir: string,
  entryName: string,
  parsed: ParsedGitHubSource,
  source: string,
  ref: string
): void => {
  const skillDir = path.join(targetDir, entryName)
  if (!existsSync(skillDir)) return

  try {
    if (!statSync(skillDir).isDirectory()) return
  } catch {
    return
  }

  const metadata: SkillInstallMetadata = {
    version: 1,
    skillName: readSkillFrontmatterName(skillDir, entryName),
    directoryName: entryName,
    source,
    owner: parsed.owner,
    repo: parsed.repo,
    repoUrl: parsed.repoUrl,
    ref,
    skillsPath: parsed.skillsPath,
    installedAt: new Date().toISOString()
  }

  writeFileSync(
    path.join(skillDir, SKILL_INSTALL_METADATA_FILENAME),
    JSON.stringify(metadata, null, 2),
    'utf8'
  )
}

export const readSkillInstallMetadata = (skillDir: string): SkillInstallMetadata | null => {
  const metadataPath = path.join(skillDir, SKILL_INSTALL_METADATA_FILENAME)
  if (!existsSync(metadataPath)) return null

  try {
    const raw = JSON.parse(readFileSync(metadataPath, 'utf8')) as Partial<SkillInstallMetadata>
    if (
      raw.version !== 1 ||
      typeof raw.skillName !== 'string' ||
      typeof raw.directoryName !== 'string' ||
      typeof raw.source !== 'string' ||
      typeof raw.owner !== 'string' ||
      typeof raw.repo !== 'string' ||
      typeof raw.repoUrl !== 'string' ||
      typeof raw.ref !== 'string' ||
      typeof raw.skillsPath !== 'string' ||
      typeof raw.installedAt !== 'string'
    ) {
      return null
    }

    return {
      version: 1,
      skillName: raw.skillName.trim(),
      directoryName: raw.directoryName.trim(),
      source: raw.source.trim(),
      owner: raw.owner.trim(),
      repo: raw.repo.trim(),
      repoUrl: raw.repoUrl.trim(),
      ref: raw.ref.trim(),
      skillsPath: raw.skillsPath.trim(),
      installedAt: raw.installedAt.trim()
    }
  } catch {
    return null
  }
}

export const installSkillsFromGitHub = async (
  input: InstallSkillsFromGitHubInput
): Promise<InstallSkillsFromGitHubResult> => {
  const parsed = parseGitHubSource(input.source, input.ref, input.skill)
  const repoInfo = await fetchGitHubJson<GitHubRepoPayload>(
    createGitHubApiUrl(parsed.owner, parsed.repo, '')
  )
  const ref = parsed.ref || String(repoInfo.default_branch || '').trim()
  if (!ref) throw new Error('无法确定仓库分支')

  const files = await listGitHubDirectoryFiles(parsed.owner, parsed.repo, parsed.sourcePath, ref)
  if (files.length === 0) {
    throw new Error(`仓库中未找到可安装的技能文件：${parsed.sourcePath}`)
  }

  // 自动检测：如果 sourcePath 下直接存在 SKILL.md 或 skill.json，说明该目录本身就是一个独立的技能目录
  // 此时我们将 skillsPath 动态调整为它的父目录，使技能在安装时能正确生成技能名文件夹
  let resolvedSkillsPath = parsed.skillsPath
  const hasRootSkillFile = files.some((f) => {
    const rel = path.posix.relative(parsed.sourcePath, f.path)
    return rel === 'SKILL.md' || rel === 'skill.json'
  })
  if (hasRootSkillFile) {
    resolvedSkillsPath = path.posix.dirname(parsed.sourcePath)
    if (resolvedSkillsPath === '.' || resolvedSkillsPath === '/' || !resolvedSkillsPath) {
      resolvedSkillsPath = ''
    }
  }

  let relativeFiles = files.map((file) => ({
    ...file,
    relativePath: relativePathFromSkillsRoot(resolvedSkillsPath, file.path)
  }))

  // 虚拟映射：若 relativePath 中没有斜杠，说明 SKILL.md 直接在根目录上
  // 我们将其统一放入以仓库名（parsed.repo）命名的子目录下，以便将其安装为该名称的技能
  if (relativeFiles.some((f) => !f.relativePath.includes('/'))) {
    relativeFiles = relativeFiles.map((f) => ({
      ...f,
      relativePath: `${parsed.repo}/${f.relativePath}`
    }))
  }

  const allInstalledEntries = Array.from(
    new Set(
      relativeFiles
        .map((file) => file.relativePath.split('/')[0])
        .filter((entry): entry is string => Boolean(entry))
    )
  ).sort((a, b) => a.localeCompare(b))

  const targetDirValue = String(input.targetDir ?? '').trim()
  if (!targetDirValue) throw new Error('目标 skills 目录无效')
  const targetDir = path.resolve(targetDirValue)

  mkdirSync(targetDir, { recursive: true })

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-skills-'))
  try {
    for (const file of relativeFiles) {
      if (!file.download_url) {
        throw new Error(`技能文件缺少下载地址：${file.path}`)
      }

      const fileBuffer = await fetchGitHubFile(file.download_url)
      const destination = path.join(tempRoot, ...file.relativePath.split('/'))
      mkdirSync(path.dirname(destination), { recursive: true })
      writeFileSync(destination, fileBuffer)
    }

    const installedEntries = selectInstalledEntries(
      tempRoot,
      allInstalledEntries,
      parsed.skillFilter
    )

    if (!input.force) {
      const conflicts = installedEntries.filter((entry) => existsSync(path.join(targetDir, entry)))
      if (conflicts.length > 0) {
        throw new Error(`目标目录已存在同名技能：${conflicts.join(', ')}`)
      }
    }

    for (const entry of installedEntries) {
      const destination = path.join(targetDir, entry)
      if (input.force && existsSync(destination)) {
        rmSync(destination, { recursive: true, force: true })
      }

      cpSync(path.join(tempRoot, entry), destination, {
        recursive: true,
        force: Boolean(input.force)
      })

      writeSkillInstallMetadata(targetDir, entry, parsed, parsed.installSource, ref)
      clearBundledSkillRemoval(targetDir, entry)
    }

    const selectedEntries = new Set(installedEntries)
    const selectedFileCount = relativeFiles.filter((file) =>
      selectedEntries.has(file.relativePath.split('/')[0] || '')
    ).length

    return {
      owner: parsed.owner,
      repo: parsed.repo,
      ref,
      repoUrl: parsed.repoUrl,
      skillsPath: parsed.skillsPath,
      targetDir,
      fileCount: selectedFileCount,
      installedEntries
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}
