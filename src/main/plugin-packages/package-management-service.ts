import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDefaultPluginsDir } from '../paths.ts'

export type PluginPackageManifestKind = 'piagent-agent' | 'piagent' | 'claude' | 'codex' | 'pi-mono'

export type PluginPackageManifestCandidate = {
  kind: PluginPackageManifestKind
  relativePath: string
}

export type InstallPluginPackageInput = {
  sourcePath: string
  pluginsDir?: string
  force?: boolean
  candidates: PluginPackageManifestCandidate[]
  readPackageId: (kind: PluginPackageManifestKind, raw: unknown) => string | null
}

export type InstallPluginPackageResult = {
  sourceDir: string
  targetDir: string
  manifestPath: string
  manifestKind: PluginPackageManifestKind
  manifestRaw: unknown
  packageId: string
  replaced: boolean
}

const resolveUserPath = (value: string): string => {
  const normalized = value.trim()
  if (normalized === '~') return os.homedir()
  if (normalized.startsWith(`~${path.sep}`)) return path.join(os.homedir(), normalized.slice(2))
  return normalized
}

const sanitizePackageIdSegment = (segment: string): string => {
  const normalized = segment
    .trim()
    .replace(/[^a-zA-Z0-9._@-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error(`Package id segment is not installable: ${JSON.stringify(segment)}`)
  }
  return normalized
}

const resolveInstalledPackageDir = (pluginsDir: string, packageId: string): string => {
  const segments = packageId
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(sanitizePackageIdSegment)

  if (segments.length === 0) {
    throw new Error(`Package id is not installable: ${JSON.stringify(packageId)}`)
  }
  return path.join(path.resolve(pluginsDir), ...segments)
}

const findManifest = (
  pluginRootDir: string,
  candidates: PluginPackageManifestCandidate[]
): (PluginPackageManifestCandidate & { manifestPath: string }) | null => {
  for (const candidate of candidates) {
    const manifestPath = path.join(pluginRootDir, candidate.relativePath)
    if (existsSync(manifestPath)) return { ...candidate, manifestPath }
  }
  return null
}

const resolvePackageRootFromPath = (
  sourcePath: string,
  candidates: PluginPackageManifestCandidate[]
): string => {
  const resolved = path.resolve(resolveUserPath(sourcePath))
  if (!existsSync(resolved)) throw new Error(`Plugin package path does not exist: ${resolved}`)

  const stats = statSync(resolved)
  if (stats.isDirectory()) {
    if (findManifest(resolved, candidates)) return resolved
    throw new Error(`Plugin package manifest not found under: ${resolved}`)
  }

  if (stats.isFile() && path.basename(resolved) === 'plugin.json') {
    const rootDir = path.dirname(path.dirname(resolved))
    if (findManifest(rootDir, candidates)) return rootDir
  }

  throw new Error(`Plugin package path must point to a package directory or manifest: ${resolved}`)
}

export const installPluginPackageFromLocalPath = (
  input: InstallPluginPackageInput
): InstallPluginPackageResult => {
  const rawSourcePath = String(input.sourcePath ?? '').trim()
  if (!rawSourcePath) throw new Error('sourcePath is required')

  const sourceDir = resolvePackageRootFromPath(rawSourcePath, input.candidates)
  const manifestCandidate = findManifest(sourceDir, input.candidates)
  if (!manifestCandidate) throw new Error(`Plugin package manifest not found under: ${sourceDir}`)

  const manifestRaw = JSON.parse(readFileSync(manifestCandidate.manifestPath, 'utf8'))
  const packageId = input.readPackageId(manifestCandidate.kind, manifestRaw)
  if (!packageId) throw new Error('Plugin package manifest does not contain an installable id')

  const pluginsDir = path.resolve(input.pluginsDir ?? getDefaultPluginsDir())
  const targetDir = resolveInstalledPackageDir(pluginsDir, packageId)
  const sourceReal = path.resolve(sourceDir)
  const targetReal = path.resolve(targetDir)
  if (sourceReal === targetReal) {
    throw new Error(`Source package is already installed at target location: ${targetReal}`)
  }

  const replaced = existsSync(targetDir)
  if (replaced && !input.force) {
    throw new Error(`Package already installed at ${targetDir}. Re-run with force to replace it.`)
  }

  mkdirSync(path.dirname(targetDir), { recursive: true })
  if (replaced) rmSync(targetDir, { recursive: true, force: true })
  cpSync(sourceDir, targetDir, {
    recursive: true,
    force: true
  })

  return {
    sourceDir,
    targetDir,
    manifestPath: manifestCandidate.manifestPath,
    manifestKind: manifestCandidate.kind,
    manifestRaw,
    packageId,
    replaced
  }
}
