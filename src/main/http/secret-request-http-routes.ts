import type { FastifyInstance } from 'fastify'
import {
  SECRET_REQUEST_ANSWER_API_PATH,
  SecretRequestAnswerRequestSchema,
  SecretRequestAnswerResultSchema,
  type SecretRequestAnswerRequest,
  type SecretRequestAnswerResult
} from '../../shared/secret-request-tool.ts'
import { getEmbeddedGatewayService } from '../transport/embedded-gateway'

export const registerSecretRequestHttpRoutes = (app: FastifyInstance): void => {
  app.post<{ Body: SecretRequestAnswerRequest; Reply: SecretRequestAnswerResult }>(
    SECRET_REQUEST_ANSWER_API_PATH,
    {
      schema: {
        body: SecretRequestAnswerRequestSchema,
        response: {
          200: SecretRequestAnswerResultSchema
        }
      }
    },
    async (request) => {
      const gateway = await getEmbeddedGatewayService()
      return gateway.answerDesktopSecret(request.body.threadId.trim(), {
        secretId: request.body.secretId.trim(),
        value: request.body.value
      })
    }
  )
}
