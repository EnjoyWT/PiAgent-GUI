import { createCliFailureResult } from '../cli-errors'
import type { CliExecuteRequest, CliExecuteResult } from '../cli-types'
import type { CliRegistry } from '../cli-registry'
import path from 'node:path'
import { getDefaultSharedSkillsDir } from '../../paths'
import { installSkillsFromGitHub } from '../../skills/skills-install-service'
import {
  listInstalledSkills,
  searchSkills,
  uninstallSkill,
  updateInstalledSkills
} from '../../skills/skills-management-service'
import { mkdirSync } from 'node:fs'

const parseStringFlag = (request: CliExecuteRequest, key: string): string | undefined => {
  const value = request.flags?.[key]
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

const parseBooleanFlag = (request: CliExecuteRequest, key: string): boolean => {
  const value = request.flags?.[key]
  return value === true || value === 'true' || value === 1
}

const parseNumberFlag = (request: CliExecuteRequest, key: string): number | undefined => {
  const value = request.flags?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const asJsonResult = (data: unknown): CliExecuteResult => ({
  ok: true,
  exitCode: 0,
  stdout: JSON.stringify(data, null, 2),
  stderr: '',
  data
})

const formatInstallResult = (
  result: Awaited<ReturnType<typeof installSkillsFromGitHub>>
): string => {
  const lines = [
    `Installed ${result.installedEntries.length} skill entries (${result.fileCount} files) from ${result.owner}/${result.repo}#${result.ref}`,
    `Target: ${result.targetDir}`
  ]

  if (result.installedEntries.length > 0) {
    lines.push('Entries:')
    for (const entry of result.installedEntries) {
      lines.push(`- ${entry}`)
    }
  }

  return lines.join('\n')
}

const resolveTargetDir = (request: CliExecuteRequest): string => {
  const defaultTargetDir = path.resolve(getDefaultSharedSkillsDir())
  const explicitTargetDir = parseStringFlag(request, 'target')
  const targetDir = path.resolve(explicitTargetDir ?? defaultTargetDir)
  if (explicitTargetDir) return targetDir

  mkdirSync(targetDir, { recursive: true })
  return targetDir
}

const formatSearchResult = (result: Awaited<ReturnType<typeof searchSkills>>): string => {
  if (result.items.length === 0) {
    return `No skills.sh results matched "${result.query}".`
  }

  const lines = [`Found ${result.items.length} skills.sh result(s) for "${result.query}":`]
  for (const item of result.items) {
    lines.push(`- ${item.name} [installs=${item.installs} source=${item.source}]`)
    lines.push(`  install: piagent skills install ${item.installSource}`)
    lines.push(`  page: ${item.detailUrl}`)
  }

  return lines.join('\n')
}

const formatListResult = (result: ReturnType<typeof listInstalledSkills>): string => {
  if (result.skills.length === 0) {
    return `No skills found in ${result.targetDir}.`
  }

  const lines = [`Installed skills in ${result.targetDir}:`]
  for (const skill of result.skills) {
    const detailParts: string[] = [skill.sourceKind]
    if (skill.installMetadata) {
      detailParts.push(
        `${skill.installMetadata.owner}/${skill.installMetadata.repo}#${skill.installMetadata.ref}`
      )
    }
    if (skill.directoryName !== skill.name) {
      detailParts.push(`dir=${skill.directoryName}`)
    }

    lines.push(`- ${skill.name} [${detailParts.join(' ')}]`)
    if (skill.description) lines.push(`  ${skill.description}`)
  }

  return lines.join('\n')
}

const formatUninstallResult = (result: ReturnType<typeof uninstallSkill>): string =>
  `Uninstalled ${result.skill.name} from ${result.targetDir}\n` +
  `Directory: ${result.skill.directoryName}\n` +
  `Source: ${result.skill.sourceKind}`

const formatUpdateResult = (result: Awaited<ReturnType<typeof updateInstalledSkills>>): string => {
  const lines: string[] = []

  if (result.updatedBundles.length === 0) {
    lines.push(`No managed skills were updated in ${result.targetDir}.`)
  } else {
    lines.push(`Updated ${result.updatedBundles.length} skill bundle(s) in ${result.targetDir}:`)
    for (const bundle of result.updatedBundles) {
      lines.push(
        `- ${bundle.source}#${bundle.ref} -> ${bundle.result.installedEntries.join(', ')} (requested: ${bundle.requestedSkills.join(', ')})`
      )
    }
  }

  if (result.skippedSkills.length > 0) {
    lines.push('Skipped:')
    for (const item of result.skippedSkills) {
      lines.push(`- ${item.name}: ${item.reason}`)
    }
  }

  if (result.notFound.length > 0) {
    lines.push('Not found:')
    for (const item of result.notFound) {
      lines.push(`- ${item}`)
    }
  }

  return lines.join('\n')
}

const installHandler = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  const source = request.args?.join(' ').trim()
  if (!source) {
    return createCliFailureResult(2, 'Missing GitHub repository URL or owner/repo')
  }

  try {
    const result = await installSkillsFromGitHub({
      source,
      targetDir: resolveTargetDir(request),
      force: parseBooleanFlag(request, 'force'),
      ref: parseStringFlag(request, 'ref'),
      skill: parseStringFlag(request, 'skill')
    })
    const data = { result }

    if (parseBooleanFlag(request, 'json')) return asJsonResult(data)

    return {
      ok: true,
      exitCode: 0,
      stdout: formatInstallResult(result),
      stderr: '',
      data
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createCliFailureResult(5, `Failed to install skills: ${message}`)
  }
}

const searchHandler = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  const query = request.args?.join(' ').trim()
  if (!query) return createCliFailureResult(2, 'Missing skill search query')

  try {
    const data = await searchSkills(query, parseNumberFlag(request, 'limit') ?? 10)
    if (parseBooleanFlag(request, 'json')) return asJsonResult(data)

    return {
      ok: true,
      exitCode: 0,
      stdout: formatSearchResult(data),
      stderr: '',
      data
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createCliFailureResult(5, `Failed to search skills: ${message}`)
  }
}

const listHandler = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  try {
    const data = listInstalledSkills(resolveTargetDir(request))
    if (parseBooleanFlag(request, 'json')) return asJsonResult(data)

    return {
      ok: true,
      exitCode: 0,
      stdout: formatListResult(data),
      stderr: '',
      data
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createCliFailureResult(5, `Failed to list skills: ${message}`)
  }
}

const uninstallHandler = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  const skillName = request.args?.[0]?.trim()
  if (!skillName) return createCliFailureResult(2, 'Missing skill name')

  try {
    const data = uninstallSkill(resolveTargetDir(request), skillName)
    if (parseBooleanFlag(request, 'json')) return asJsonResult(data)

    return {
      ok: true,
      exitCode: 0,
      stdout: formatUninstallResult(data),
      stderr: '',
      data
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createCliFailureResult(5, `Failed to uninstall skill: ${message}`)
  }
}

const updateHandler = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  try {
    const data = await updateInstalledSkills(resolveTargetDir(request), request.args ?? [])
    if (parseBooleanFlag(request, 'json')) return asJsonResult(data)

    return {
      ok: true,
      exitCode: 0,
      stdout: formatUpdateResult(data),
      stderr: '',
      data
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createCliFailureResult(5, `Failed to update skills: ${message}`)
  }
}

export const registerSkillsCliModule = (registry: CliRegistry): void => {
  registry.register('skills', 'search', searchHandler)
  registry.register('skills', 'install', installHandler)
  registry.register('skills', 'list', listHandler)
  registry.register('skills', 'uninstall', uninstallHandler)
  registry.register('skills', 'update', updateHandler)
}
