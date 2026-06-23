import { Type, type Static } from '@sinclair/typebox'

export const CLI_EXECUTE_PATH = '/v1/cli/execute'

const CliFlagValueSchema = Type.Union([Type.Boolean(), Type.Number(), Type.String()])

export const CliExecuteRequestSchema = Type.Object({
  module: Type.String({ minLength: 1 }),
  action: Type.String({ minLength: 1 }),
  args: Type.Optional(Type.Array(Type.String())),
  flags: Type.Optional(Type.Record(Type.String(), CliFlagValueSchema)),
  cwd: Type.Optional(Type.String())
})

export type CliExecuteRequest = Static<typeof CliExecuteRequestSchema>

export const CliExecuteResultSchema = Type.Object({
  ok: Type.Boolean(),
  exitCode: Type.Number(),
  stdout: Type.String(),
  stderr: Type.String(),
  data: Type.Optional(Type.Any())
})

export type CliExecuteResult = Static<typeof CliExecuteResultSchema>

export type CliHandler = (
  request: CliExecuteRequest
) => Promise<CliExecuteResult> | CliExecuteResult
