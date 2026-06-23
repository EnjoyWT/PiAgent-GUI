import type { CliExecuteResult } from './cli-types'

const ensureTrailingNewline = (value: string): string => {
  if (!value) return ''
  return value.endsWith('\n') ? value : `${value}\n`
}

export const createCliFailureResult = (exitCode: number, message: string): CliExecuteResult => ({
  ok: false,
  exitCode,
  stdout: '',
  stderr: ensureTrailingNewline(message)
})

export const normalizeCliResult = (result: CliExecuteResult): CliExecuteResult => ({
  ok: result.ok,
  exitCode: result.exitCode,
  stdout: result.stdout ? ensureTrailingNewline(result.stdout) : '',
  stderr: result.stderr ? ensureTrailingNewline(result.stderr) : '',
  data: result.data
})
