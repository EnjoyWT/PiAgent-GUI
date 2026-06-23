import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { createCliFailureResult } from '../cli-errors.ts'
import type { CliExecuteRequest, CliExecuteResult } from '../cli-types'
import type { CliRegistry } from '../cli-registry'
import { getDefaultPluginsDir } from '../../paths.ts'
import {
  installExternalPlugin,
  type InstallExternalPluginResult
} from '../../plugin-system/plugin-management-service.ts'

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

const asJsonResult = (data: unknown): CliExecuteResult => ({
  ok: true,
  exitCode: 0,
  stdout: JSON.stringify(data, null, 2),
  stderr: '',
  data
})

const resolvePluginsTargetDir = (request: CliExecuteRequest): string => {
  const targetDir = path.resolve(parseStringFlag(request, 'target') ?? getDefaultPluginsDir())
  mkdirSync(targetDir, { recursive: true })
  return targetDir
}

const formatInstallResult = (result: InstallExternalPluginResult): string => {
  const lines = [
    `Installed transport plugin ${result.manifest.id}@${result.manifest.version}`,
    `Source: ${result.sourceReference}`,
    `Resolved Source: ${result.sourceDir}`,
    `Target: ${result.targetDir}`,
    `Entry: ${result.manifest.entry}`
  ]
  if (result.replaced) lines.push('Replaced existing installation.')
  lines.push('Restart PiAgent to load the updated plugin.')
  return lines.join('\n')
}

const installHandler = async (request: CliExecuteRequest): Promise<CliExecuteResult> => {
  const source = request.args?.join(' ').trim()
  if (!source) {
    return createCliFailureResult(
      2,
      'Missing plugin source. Usage: piagent plugins install <local-path|package-spec>'
    )
  }

  try {
    const result = installExternalPlugin({
      source,
      cwd: request.cwd,
      force: parseBooleanFlag(request, 'force'),
      pluginsDir: resolvePluginsTargetDir(request)
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
    return createCliFailureResult(5, `Failed to install plugin: ${message}`)
  }
}

export const registerPluginsCliModule = (registry: CliRegistry): void => {
  registry.register('plugins', 'install', installHandler)
}
