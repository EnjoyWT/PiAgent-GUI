import { existsSync } from 'node:fs'
import path from 'node:path'

type ResolvePiAgentCliPathOptions = {
  cwd?: string
  dirname?: string
  resourcesPath?: string
}

export type CreatePiAgentShellCommandPrefixOptions = ResolvePiAgentCliPathOptions & {
  endpoint: string
  nodeExecutable?: string
  platform?: NodeJS.Platform
}

const PIAGENT_CLI_SCRIPT_NAME = 'piagent'

const uniqueExistingCandidateDirs = (candidates: string[]): string[] =>
  Array.from(
    new Set(
      candidates
        .map((candidate) => path.resolve(candidate))
        .filter((candidate) => existsSync(path.join(candidate, PIAGENT_CLI_SCRIPT_NAME)))
    )
  )

export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

export const toBashPath = (value: string, platform: NodeJS.Platform = process.platform): string => {
  if (platform !== 'win32') return value

  const normalized = value.replace(/\\/g, '/')
  const driveMatch = /^([A-Za-z]):\/(.*)$/.exec(normalized)
  if (!driveMatch) return normalized

  return `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`
}

export const resolvePiAgentCliBinDir = (
  options: ResolvePiAgentCliPathOptions = {}
): string | null => {
  const cwd = options.cwd ?? process.cwd()
  const dirname = options.dirname ?? __dirname
  const resourcesPath = options.resourcesPath ?? process.resourcesPath ?? ''
  const candidates = uniqueExistingCandidateDirs([
    path.join(resourcesPath, 'bin'),
    path.join(resourcesPath, 'app.asar.unpacked', 'resources', 'bin'),
    path.join(resourcesPath, 'resources', 'bin'),
    path.join(cwd, 'resources', 'bin'),
    path.join(dirname, '..', '..', '..', 'resources', 'bin'),
    path.join(dirname, '..', '..', 'resources', 'bin'),
    path.join(dirname, '..', 'resources', 'bin')
  ])

  return candidates[0] ?? null
}

export const resolvePiAgentCliScriptPath = (
  options: ResolvePiAgentCliPathOptions = {}
): string | null => {
  const binDir = resolvePiAgentCliBinDir(options)
  return binDir ? path.join(binDir, PIAGENT_CLI_SCRIPT_NAME) : null
}

export const createPiAgentShellCommandPrefix = (
  options: CreatePiAgentShellCommandPrefixOptions
): string => {
  const endpoint = options.endpoint.replace(/\/+$/, '')
  const platform = options.platform ?? process.platform
  const cliScriptPath = resolvePiAgentCliScriptPath(options)
  const lines = [`export PIAGENT_ENDPOINT=${shellQuote(endpoint)}`]

  if (cliScriptPath && options.nodeExecutable) {
    const shellNodeExecutable = shellQuote(toBashPath(options.nodeExecutable, platform))
    const shellCliScriptPath = shellQuote(toBashPath(cliScriptPath, platform))
    const shellCliBinDir = shellQuote(toBashPath(path.dirname(cliScriptPath), platform))

    lines.push(
      `piagent() { ELECTRON_RUN_AS_NODE=1 ${shellNodeExecutable} ${shellCliScriptPath} "$@"; }`
    )
    lines.push(`export PATH=${shellCliBinDir}:$PATH`)
  }

  lines.push('hash -r')
  return lines.join('\n')
}
