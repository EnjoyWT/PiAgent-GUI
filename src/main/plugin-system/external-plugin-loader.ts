import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  getDefaultPluginDataDir,
  getDefaultPluginsDir,
  getPreferredAppConfigDir
} from '../paths.ts'
import {
  createConsolePluginLogger,
  validatePluginManifest,
  type BuiltinPluginModule,
  type PluginKind,
  type PluginManifest,
  type PluginRegisterContext,
  type PluginSourceKind
} from './plugin-types.ts'

const PLUGIN_MANIFEST_RELATIVE_PATH = path.join('.piagent-plugin', 'plugin.json')

type ExternalPluginEntryModule<TPlugin, TContext extends PluginRegisterContext> =
  | BuiltinPluginModule<TPlugin, TContext>
  | {
      default?:
        | BuiltinPluginModule<TPlugin, TContext>
        | ((ctx: TContext) => TPlugin | Promise<TPlugin>)
      register?: (ctx: TContext) => TPlugin | Promise<TPlugin>
    }

export type ExternalPluginModule<
  TPlugin,
  TContext extends PluginRegisterContext
> = BuiltinPluginModule<TPlugin, TContext>

export type ExternalPluginDiscoveryResult<TPlugin, TContext extends PluginRegisterContext> = {
  module: ExternalPluginModule<TPlugin, TContext>
  manifest: PluginManifest
  manifestPath: string
  pluginRootDir: string
  sourceKind: PluginSourceKind
}

export type DiscoverExternalPluginsOptions = {
  kind: PluginKind
  sourceKind?: PluginSourceKind
  directories?: string[]
}

type MainImportMetaEnv = {
  MAIN_VITE_PIAGENT_PLUGIN_DIRS?: string
}

const getConfiguredPluginDirs = (): string => {
  const runtimeDirs = process.env.PIAGENT_PLUGIN_DIRS?.trim()
  if (runtimeDirs) return runtimeDirs

  return (
    (import.meta as ImportMeta & { env?: MainImportMetaEnv }).env?.MAIN_VITE_PIAGENT_PLUGIN_DIRS ??
    ''
  ).trim()
}

const normalizeDirectoryList = (directories?: string[]): string[] => {
  if (Array.isArray(directories) && directories.length > 0) {
    return [...new Set(directories.map((item) => path.resolve(item)).filter(Boolean))]
  }

  const fromEnv = getConfiguredPluginDirs()
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)

  if (fromEnv.length > 0) return [...new Set(fromEnv.map((item) => path.resolve(item)))]
  return [getDefaultPluginsDir()]
}

const createPluginConfigDir = (pluginId: string): string => {
  const configDir = path.join(
    getDefaultPluginDataDir(),
    pluginId.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'plugin'
  )
  mkdirSync(configDir, { recursive: true })
  return configDir
}

const readPluginManifest = (manifestPath: string): PluginManifest => {
  const raw = readFileSync(manifestPath, 'utf8')
  return validatePluginManifest(JSON.parse(raw))
}

const collectPluginManifestPaths = (rootDir: string): string[] => {
  const resolvedRoot = path.resolve(rootDir)
  if (!existsSync(resolvedRoot)) return []

  const directManifest = path.join(resolvedRoot, PLUGIN_MANIFEST_RELATIVE_PATH)
  const manifestPaths = new Set<string>()
  if (existsSync(directManifest)) manifestPaths.add(directManifest)

  for (const entry of readdirSync(resolvedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const entryPath = path.join(resolvedRoot, entry.name)
    const entryManifest = path.join(entryPath, PLUGIN_MANIFEST_RELATIVE_PATH)
    if (existsSync(entryManifest)) {
      manifestPaths.add(entryManifest)
      continue
    }

    if (!entry.name.startsWith('@')) continue
    for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
      if (!scopedEntry.isDirectory()) continue
      const scopedManifest = path.join(entryPath, scopedEntry.name, PLUGIN_MANIFEST_RELATIVE_PATH)
      if (existsSync(scopedManifest)) manifestPaths.add(scopedManifest)
    }
  }

  return [...manifestPaths]
}

const resolveRegister = <TPlugin, TContext extends PluginRegisterContext>(
  imported: ExternalPluginEntryModule<TPlugin, TContext>
): ((ctx: TContext) => TPlugin | Promise<TPlugin>) => {
  const record = imported as {
    default?: unknown
    register?: unknown
  }

  if (typeof record.register === 'function') {
    return record.register as (ctx: TContext) => TPlugin | Promise<TPlugin>
  }
  if (typeof record.default === 'function') {
    return record.default as (ctx: TContext) => TPlugin | Promise<TPlugin>
  }
  if (record.default && typeof record.default === 'object') {
    const defaultRecord = record.default as { register?: unknown }
    if (typeof defaultRecord.register === 'function') {
      return defaultRecord.register as (ctx: TContext) => TPlugin | Promise<TPlugin>
    }
  }
  throw new Error('External plugin entry must export a register(ctx) function')
}

export const discoverExternalPluginModules = async <
  TPlugin,
  TContext extends PluginRegisterContext = PluginRegisterContext
>(
  options: DiscoverExternalPluginsOptions
): Promise<Array<ExternalPluginDiscoveryResult<TPlugin, TContext>>> => {
  const directories = normalizeDirectoryList(options.directories)
  const sourceKind = options.sourceKind ?? 'user'
  const discovered: Array<ExternalPluginDiscoveryResult<TPlugin, TContext>> = []
  const seenPluginIds = new Set<string>()

  for (const directory of directories) {
    for (const manifestPath of collectPluginManifestPaths(directory)) {
      const manifest = readPluginManifest(manifestPath)
      if (manifest.kind !== options.kind) continue
      if (seenPluginIds.has(manifest.id)) {
        throw new Error(`Duplicate external plugin id: ${manifest.id}`)
      }
      if (!manifest.entry) {
        throw new Error(`External plugin ${manifest.id} is missing manifest.entry`)
      }

      const pluginRootDir = path.dirname(path.dirname(manifestPath))
      const entryPath = path.resolve(pluginRootDir, manifest.entry)
      const entryUrl = pathToFileURL(entryPath).href
      const module: ExternalPluginModule<TPlugin, TContext> = {
        manifest,
        register: async (ctx: TContext) => {
          const imported = (await import(entryUrl)) as ExternalPluginEntryModule<TPlugin, TContext>
          const register = resolveRegister(imported)
          const externalContext = {
            ...ctx,
            pluginId: manifest.id,
            manifest,
            sourceKind,
            pluginRootDir,
            pluginConfigDir: createPluginConfigDir(manifest.id),
            appConfigDir: getPreferredAppConfigDir(),
            logger: ctx.logger ?? createConsolePluginLogger(manifest.id)
          }
          return await register(externalContext)
        }
      }

      discovered.push({
        module,
        manifest,
        manifestPath,
        pluginRootDir,
        sourceKind
      })
      seenPluginIds.add(manifest.id)
    }
  }

  return discovered
}
