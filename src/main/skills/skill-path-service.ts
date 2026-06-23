import { existsSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  discoverAgentPlugins,
  resolveAgentPluginSkillPaths
} from '../agent-plugins/agent-plugin-discovery.ts'
import type { AgentPluginComponentType } from '../agent-plugins/agent-plugin-state-service.ts'
import { getDefaultPluginsDir, getDefaultSharedSkillsDir, getDefaultSkillsDir } from '../paths.ts'

export type AgentPluginComponentEnabledPredicate = (
  pluginId: string,
  componentType: AgentPluginComponentType,
  componentId: string
) => boolean

export type SkillSearchPathOptions = {
  managedSkillsDir?: string
  extraDirs?: string[]
  sharedSkillDirs?: string[]
  pluginDirectories?: string[]
  includeAgentPluginSkills?: boolean
  isAgentPluginComponentEnabled?: AgentPluginComponentEnabledPredicate
}

const isDirectory = (value: string): boolean => {
  try {
    return statSync(value).isDirectory()
  } catch {
    return false
  }
}

const uniqueExistingDirectories = (values: string[]): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = path.resolve(value)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    if (existsSync(normalized) && isDirectory(normalized)) result.push(normalized)
  }
  return result
}

export const getClaudeSkillsDir = (): string => path.join(os.homedir(), '.claude', 'skills')

export const getSuperpowersMarketplaceSkillsDir = (): string =>
  path.join(os.homedir(), '.claude', 'plugins', 'cache', 'superpowers-marketplace', 'superpowers')

export const getDefaultSharedSkillDirs = (): string[] => [
  getDefaultSharedSkillsDir(),
  getClaudeSkillsDir(),
  getSuperpowersMarketplaceSkillsDir()
]

export const resolveAgentPluginSkillSearchPaths = (
  pluginDirectories: string[],
  options: { isAgentPluginComponentEnabled?: AgentPluginComponentEnabledPredicate } = {}
): string[] =>
  discoverAgentPlugins({ directories: pluginDirectories }).plugins.flatMap((plugin) => {
    const skillPaths = plugin.manifest.components.skills.filter(
      (skillPath) =>
        options.isAgentPluginComponentEnabled?.(plugin.manifest.id, 'skills', skillPath) ?? true
    )
    return resolveAgentPluginSkillPaths({
      ...plugin,
      manifest: {
        ...plugin.manifest,
        components: {
          ...plugin.manifest.components,
          skills: skillPaths
        }
      }
    })
  })

export const resolveSkillSearchPaths = (options: SkillSearchPathOptions = {}): string[] => {
  const managedSkillsDir = options.managedSkillsDir ?? getDefaultSkillsDir()
  const extraDirs = options.extraDirs ?? []
  const sharedSkillDirs = options.sharedSkillDirs ?? getDefaultSharedSkillDirs()
  const pluginDirectories = options.pluginDirectories ?? [getDefaultPluginsDir()]
  const includeAgentPluginSkills = options.includeAgentPluginSkills !== false
  const pluginSkillPaths = includeAgentPluginSkills
    ? resolveAgentPluginSkillSearchPaths(pluginDirectories, {
        isAgentPluginComponentEnabled: options.isAgentPluginComponentEnabled
      })
    : []

  return uniqueExistingDirectories([
    managedSkillsDir,
    ...extraDirs,
    ...sharedSkillDirs,
    ...pluginSkillPaths
  ])
}
