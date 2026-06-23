import { createReadStream } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import {
  getChatImageAssetService,
  isValidChatImageAssetId,
  type ChatImageAssetService
} from '../chat-assets/chat-image-asset-service.ts'

export const registerChatAssetHttpRoutes = (
  app: FastifyInstance,
  service: ChatImageAssetService = getChatImageAssetService()
): void => {
  app.get('/assets/chat-images/:assetId', async (request, reply) => {
    const params = request.params as { assetId?: string }
    const assetId = String(params.assetId ?? '').trim()
    if (!isValidChatImageAssetId(assetId)) {
      reply.code(400)
      return { error: 'Invalid chat image asset id' }
    }

    try {
      const filePath = service.resolvePath(assetId)
      reply.header('Cache-Control', 'private, max-age=86400')
      reply.type(service.getMimeType(assetId))
      return reply.send(createReadStream(filePath))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reply.code(404)
        return { error: 'Chat image asset not found' }
      }
      throw error
    }
  })
}
