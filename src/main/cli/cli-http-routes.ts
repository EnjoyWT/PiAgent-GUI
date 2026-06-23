import type { FastifyInstance } from 'fastify'
import { createCliFailureResult, normalizeCliResult } from './cli-errors'
import { createCliRegistry } from './cli-registry'
import {
  CLI_EXECUTE_PATH,
  CliExecuteRequestSchema,
  CliExecuteResultSchema,
  type CliExecuteRequest,
  type CliExecuteResult
} from './cli-types'

export const registerCliHttpRoutes = (app: FastifyInstance): void => {
  const registry = createCliRegistry()

  app.post<{ Body: CliExecuteRequest; Reply: CliExecuteResult }>(
    CLI_EXECUTE_PATH,
    {
      schema: {
        body: CliExecuteRequestSchema,
        response: {
          200: CliExecuteResultSchema
        }
      }
    },
    async (request) => {
      try {
        const result = await registry.execute({
          module: request.body.module.trim(),
          action: request.body.action.trim(),
          args: Array.isArray(request.body.args) ? request.body.args : [],
          flags:
            request.body.flags && typeof request.body.flags === 'object' ? request.body.flags : {},
          cwd: request.body.cwd?.trim() || undefined
        })
        return normalizeCliResult(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return createCliFailureResult(5, `CLI execution failed: ${message}`)
      }
    }
  )
}
