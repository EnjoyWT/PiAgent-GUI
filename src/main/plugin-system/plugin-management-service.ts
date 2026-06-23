import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDefaultPluginsDir } from '../paths.ts'
import { validatePluginManifest, type PluginManifest } from './plugin-types.ts'

const PLUGIN_MANIFEST_RELATIVE_PATH = path.join('.piagent-plugin', 'plugin.json')

export type InstallExternalPluginFromLocalPathInput = {
  sourcePath: string
  pluginsDir?: string
  force?: boolean
  cwd?: string
}

export type InstallExternalPluginFromPackageSpecInput = {
  packageSpec: string
  pluginsDir?: string
  force?: boolean
}

export type InstallExternalPluginResult = {
  manifest: PluginManifest
  sourceDir: string
  targetDir: string
  manifestPath: string
  entryPath: string
  replaced: boolean
  installSource: 'local_path' | 'package_spec'
  sourceReference: string
}

export type InstallExternalPluginInput = {
  source: string
  pluginsDir?: string
  force?: boolean
  cwd?: string
}

type InstallExternalPluginPackageDeps = {
  packPackage?: (packageSpec: string, workingDir: string) => string
  extractPackageTarball?: (tarballPath: string, unpackDir: string) => string
  createTempDir?: (prefix: string) => string
  removeDir?: (directory: string) => void
}

const sanitizePluginIdSegment = (segment: string): string => {
  const normalized = segment
    .trim()
    .replace(/[^a-zA-Z0-9._@-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error(`Plugin id segment is not installable: ${JSON.stringify(segment)}`)
  }
  return normalized
}

const resolveInstalledPluginDir = (pluginsDir: string, pluginId: string): string => {
  const segments = pluginId
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(sanitizePluginIdSegment)

  if (segments.length === 0) {
    throw new Error(`Plugin id is not installable: ${JSON.stringify(pluginId)}`)
  }

  return path.join(path.resolve(pluginsDir), ...segments)
}

const resolveUserPath = (value: string): string => {
  const normalized = value.trim()
  if (normalized === '~') return os.homedir()
  if (normalized.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), normalized.slice(2))
  }
  return normalized
}

const resolvePluginRootFromPath = (sourcePath: string): string => {
  const resolved = path.resolve(resolveUserPath(sourcePath))
  if (!existsSync(resolved)) {
    throw new Error(`Plugin path does not exist: ${resolved}`)
  }

  const stats = statSync(resolved)
  if (stats.isDirectory()) {
    const manifestPath = path.join(resolved, PLUGIN_MANIFEST_RELATIVE_PATH)
    if (existsSync(manifestPath)) return resolved
    throw new Error(`Plugin manifest not found: ${manifestPath}`)
  }

  if (
    stats.isFile() &&
    path.basename(resolved) === 'plugin.json' &&
    path.basename(path.dirname(resolved)) === '.piagent-plugin'
  ) {
    return path.dirname(path.dirname(resolved))
  }

  throw new Error(
    `Plugin path must point to a plugin directory or .piagent-plugin/plugin.json: ${resolved}`
  )
}

const readManifestFromPluginRoot = (
  pluginRootDir: string
): { manifest: PluginManifest; manifestPath: string } => {
  const manifestPath = path.join(pluginRootDir, PLUGIN_MANIFEST_RELATIVE_PATH)
  if (!existsSync(manifestPath)) {
    throw new Error(`Plugin manifest not found: ${manifestPath}`)
  }
  const raw = readFileSync(manifestPath, 'utf8')
  return {
    manifest: validatePluginManifest(JSON.parse(raw)),
    manifestPath
  }
}

const verifyPluginInstallable = (
  pluginRootDir: string
): {
  manifest: PluginManifest
  manifestPath: string
  entryPath: string
} => {
  const { manifest, manifestPath } = readManifestFromPluginRoot(pluginRootDir)

  if (manifest.kind !== 'transport') {
    throw new Error(
      `Only transport plugins are installable in the current host. Got kind=${manifest.kind}`
    )
  }
  if (!manifest.entry) {
    throw new Error(`Plugin ${manifest.id} is missing manifest.entry`)
  }

  const entryPath = path.resolve(pluginRootDir, manifest.entry)
  if (!existsSync(entryPath) || !statSync(entryPath).isFile()) {
    throw new Error(`Plugin entry file not found: ${entryPath}`)
  }

  return {
    manifest,
    manifestPath,
    entryPath
  }
}

const installPluginDirectory = (
  sourceDir: string,
  pluginsDir: string,
  force: boolean
): {
  manifest: PluginManifest
  manifestPath: string
  entryPath: string
  targetDir: string
  replaced: boolean
} => {
  const { manifest, manifestPath, entryPath } = verifyPluginInstallable(sourceDir)
  const targetDir = resolveInstalledPluginDir(pluginsDir, manifest.id)
  const sourceReal = path.resolve(sourceDir)
  const targetReal = path.resolve(targetDir)
  if (sourceReal === targetReal) {
    throw new Error(`Source plugin is already installed at target location: ${targetReal}`)
  }

  const replaced = existsSync(targetDir)
  if (replaced && !force) {
    throw new Error(`Plugin already installed at ${targetDir}. Re-run with --force to replace it.`)
  }

  mkdirSync(path.dirname(targetDir), { recursive: true })
  if (replaced) rmSync(targetDir, { recursive: true, force: true })
  cpSync(sourceDir, targetDir, {
    recursive: true,
    force: true
  })

  return {
    manifest,
    manifestPath,
    entryPath,
    targetDir,
    replaced
  }
}

const formatExecError = (error: unknown, fallbackMessage: string): string => {
  if (!(error instanceof Error)) return fallbackMessage
  const stderr =
    'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '').trim() : ''
  const stdout =
    'stdout' in error ? String((error as { stdout?: unknown }).stdout ?? '').trim() : ''
  return stderr || stdout || error.message || fallbackMessage
}

const defaultPackPackage = (packageSpec: string, workingDir: string): string => {
  const npmBin = process.env.PIAGENT_NPM_BIN?.trim() || 'npm'
  try {
    const output = execFileSync(npmBin, ['pack', packageSpec, '--silent'], {
      cwd: workingDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1)

    if (!output) {
      throw new Error(`npm pack did not return a tarball name for ${packageSpec}`)
    }
    return path.join(workingDir, output)
  } catch (error) {
    throw new Error(
      `npm pack failed for ${packageSpec}: ${formatExecError(error, 'Unknown npm error')}`
    )
  }
}

const defaultExtractPackageTarball = (tarballPath: string, unpackDir: string): string => {
  const tarBin = process.env.PIAGENT_TAR_BIN?.trim() || 'tar'
  mkdirSync(unpackDir, { recursive: true })
  try {
    execFileSync(tarBin, ['-xzf', tarballPath, '-C', unpackDir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    throw new Error(
      `Failed to extract package tarball ${tarballPath}: ${formatExecError(error, 'Unknown tar error')}`
    )
  }

  const packageRoot = path.join(unpackDir, 'package')
  if (existsSync(packageRoot) && statSync(packageRoot).isDirectory()) {
    return packageRoot
  }
  return resolvePluginRootFromPath(unpackDir)
}

const defaultCreateTempDir = (prefix: string): string => mkdtempSync(path.join(os.tmpdir(), prefix))

const defaultRemoveDir = (directory: string): void => {
  rmSync(directory, { recursive: true, force: true })
}

const isLikelyLocalPath = (source: string, cwd?: string): boolean => {
  const normalized = source.trim()
  if (!normalized) return false
  if (normalized.startsWith('file:')) return true
  if (normalized === '~' || normalized.startsWith(`~${path.sep}`)) return true
  if (path.isAbsolute(normalized)) return true
  if (/^[A-Za-z]:[\\/]/.test(normalized)) return true
  if (normalized.startsWith('./') || normalized.startsWith('../')) return true

  const resolved = cwd ? path.resolve(cwd, normalized) : path.resolve(normalized)
  return existsSync(resolved)
}

export const installExternalPluginFromLocalPath = (
  input: InstallExternalPluginFromLocalPathInput
): InstallExternalPluginResult => {
  const rawSourcePath = String(input.sourcePath ?? '').trim()
  if (!rawSourcePath) throw new Error('sourcePath is required')

  const sourcePath = input.cwd
    ? path.resolve(input.cwd, resolveUserPath(rawSourcePath))
    : path.resolve(resolveUserPath(rawSourcePath))
  const sourceDir = resolvePluginRootFromPath(sourcePath)
  const pluginsDir = path.resolve(input.pluginsDir ?? getDefaultPluginsDir())
  const installed = installPluginDirectory(sourceDir, pluginsDir, Boolean(input.force))

  return {
    ...installed,
    sourceDir,
    installSource: 'local_path',
    sourceReference: rawSourcePath
  }
}

export const installExternalPluginFromPackageSpec = (
  input: InstallExternalPluginFromPackageSpecInput,
  deps: InstallExternalPluginPackageDeps = {}
): InstallExternalPluginResult => {
  const packageSpec = String(input.packageSpec ?? '').trim()
  if (!packageSpec) throw new Error('packageSpec is required')

  const createTempDir = deps.createTempDir ?? defaultCreateTempDir
  const removeDir = deps.removeDir ?? defaultRemoveDir
  const packPackage = deps.packPackage ?? defaultPackPackage
  const extractPackageTarball = deps.extractPackageTarball ?? defaultExtractPackageTarball
  const tempDir = createTempDir('piagent-plugin-pack-')

  try {
    const tarballPath = packPackage(packageSpec, tempDir)
    const extractedPluginRoot = extractPackageTarball(tarballPath, path.join(tempDir, 'unpacked'))
    const pluginsDir = path.resolve(input.pluginsDir ?? getDefaultPluginsDir())
    const installed = installPluginDirectory(extractedPluginRoot, pluginsDir, Boolean(input.force))

    return {
      ...installed,
      sourceDir: extractedPluginRoot,
      installSource: 'package_spec',
      sourceReference: packageSpec
    }
  } finally {
    removeDir(tempDir)
  }
}

export const installExternalPlugin = (
  input: InstallExternalPluginInput,
  deps: InstallExternalPluginPackageDeps = {}
): InstallExternalPluginResult => {
  const source = String(input.source ?? '').trim()
  if (!source) throw new Error('source is required')

  if (isLikelyLocalPath(source, input.cwd)) {
    return installExternalPluginFromLocalPath({
      sourcePath: source,
      cwd: input.cwd,
      force: input.force,
      pluginsDir: input.pluginsDir
    })
  }

  return installExternalPluginFromPackageSpec(
    {
      packageSpec: source,
      force: input.force,
      pluginsDir: input.pluginsDir
    },
    deps
  )
}
