import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  isTransportManifestRecord,
  parseClaudeAgentPluginManifest,
  parseCodexAgentPluginManifest,
  parsePiMonoAgentPluginManifest,
  parsePiAgentAgentPluginManifest,
  readManifestId,
  type AgentPluginManifest
} from './agent-plugin-manifest.ts'

export type AgentPluginDiagnosticCode =
  | 'invalid-manifest'
  | 'invalid-component'
  | 'duplicate-plugin-id'
  | 'routed-to-im-transport'
  | 'unsupported-piagent-plugin'

export type AgentPluginDiagnostic = {
  code: AgentPluginDiagnosticCode
  message: string
  manifestPath: string
  pluginId?: string | null
}

export type DiscoveredAgentPlugin = {
  manifest: AgentPluginManifest
  manifestPath: string
  pluginRootDir: string
}

export type DiscoverAgentPluginsOptions = {
  directories: string[]
}

export type DiscoverAgentPluginsResult = {
  plugins: DiscoveredAgentPlugin[]
  diagnostics: AgentPluginDiagnostic[]
}

type ManifestCandidateKind = 'piagent-agent' | 'piagent' | 'claude' | 'codex' | 'pi-mono'

type ManifestCandidate = {
  kind: ManifestCandidateKind
  relativePath: string
}

const MANIFEST_CANDIDATES: ManifestCandidate[] = [
  { kind: 'piagent-agent', relativePath: path.join('.piagent-agent-plugin', 'plugin.json') },
  { kind: 'piagent', relativePath: path.join('.piagent-plugin', 'plugin.json') },
  { kind: 'claude', relativePath: path.join('.claude-plugin', 'plugin.json') },
  { kind: 'codex', relativePath: path.join('.codex-plugin', 'plugin.json') },
  { kind: 'pi-mono', relativePath: 'package.json' }
]

const isDirectory = (value: string): boolean => {
  try {
    return statSync(value).isDirectory()
  } catch {
    return false
  }
}

const safeReadJson = (filePath: string): unknown => JSON.parse(readFileSync(filePath, 'utf8'))

const findManifestCandidate = (
  pluginRootDir: string
): (ManifestCandidate & { manifestPath: string }) | null => {
  for (const candidate of MANIFEST_CANDIDATES) {
    const manifestPath = path.join(pluginRootDir, candidate.relativePath)
    if (existsSync(manifestPath)) return { ...candidate, manifestPath }
  }
  return null
}

const collectPluginRoots = (directory: string): string[] => {
  const resolved = path.resolve(directory)
  if (!isDirectory(resolved)) return []

  const roots = new Set<string>()
  if (findManifestCandidate(resolved)) roots.add(resolved)

  for (const entry of readdirSync(resolved, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const entryPath = path.join(resolved, entry.name)
    if (findManifestCandidate(entryPath)) {
      roots.add(entryPath)
      continue
    }

    if (!entry.name.startsWith('@')) continue
    for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
      if (!scopedEntry.isDirectory()) continue
      const scopedPath = path.join(entryPath, scopedEntry.name)
      if (findManifestCandidate(scopedPath)) roots.add(scopedPath)
    }
  }

  return [...roots]
}

const parseCandidateManifest = (
  candidate: ManifestCandidate & { manifestPath: string },
  raw: unknown
): AgentPluginManifest | null => {
  if (candidate.kind === 'piagent-agent') return parsePiAgentAgentPluginManifest(raw)
  if (candidate.kind === 'claude') return parseClaudeAgentPluginManifest(raw)
  if (candidate.kind === 'codex') return parseCodexAgentPluginManifest(raw)
  if (candidate.kind === 'pi-mono') return parsePiMonoAgentPluginManifest(raw)

  if (isTransportManifestRecord(raw)) return null
  const domain =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).domain
      : undefined
  if (domain === 'agent-plugin') return parsePiAgentAgentPluginManifest(raw)
  throw new Error('PiAgent plugin manifest is not an agent plugin manifest')
}

export const discoverAgentPlugins = (
  options: DiscoverAgentPluginsOptions
): DiscoverAgentPluginsResult => {
  const plugins: DiscoveredAgentPlugin[] = []
  const diagnostics: AgentPluginDiagnostic[] = []
  const seenPluginIds = new Set<string>()

  for (const directory of options.directories) {
    for (const pluginRootDir of collectPluginRoots(directory)) {
      const candidate = findManifestCandidate(pluginRootDir)
      if (!candidate) continue

      try {
        const raw = safeReadJson(candidate.manifestPath)
        if (candidate.kind === 'piagent' && isTransportManifestRecord(raw)) {
          diagnostics.push({
            code: 'routed-to-im-transport',
            message: 'PiAgent transport manifest is owned by the IM transport domain.',
            manifestPath: candidate.manifestPath,
            pluginId: readManifestId(raw)
          })
          continue
        }

        const manifest = parseCandidateManifest(candidate, raw)
        if (!manifest) continue
        if (seenPluginIds.has(manifest.id)) {
          diagnostics.push({
            code: 'duplicate-plugin-id',
            message: `Duplicate agent plugin id: ${manifest.id}`,
            manifestPath: candidate.manifestPath,
            pluginId: manifest.id
          })
          continue
        }

        seenPluginIds.add(manifest.id)
        plugins.push({
          manifest,
          manifestPath: candidate.manifestPath,
          pluginRootDir
        })
      } catch (error) {
        diagnostics.push({
          code: candidate.kind === 'piagent' ? 'unsupported-piagent-plugin' : 'invalid-manifest',
          message: error instanceof Error ? error.message : String(error),
          manifestPath: candidate.manifestPath,
          pluginId: null
        })
      }
    }
  }

  return { plugins, diagnostics }
}

export const resolveAgentPluginSkillPaths = (plugin: DiscoveredAgentPlugin): string[] =>
  plugin.manifest.components.skills
    .map((skillPath) => path.resolve(plugin.pluginRootDir, skillPath))
    .filter(isDirectory)
