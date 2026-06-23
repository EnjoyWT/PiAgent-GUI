import type { FastifyInstance } from 'fastify'
import { registerCliHttpRoutes } from '../cli/cli-http-routes'
import { registerChatAssetHttpRoutes } from './chat-asset-http-routes'
import { registerComputerUseArtifactHttpRoutes } from './computer-use-artifact-http-routes'
import { registerSecretRequestHttpRoutes } from './secret-request-http-routes'
import { registerWidgetHttpRoutes } from './widget-http-routes'

export const registerLocalHttpRoutes = (app: FastifyInstance): void => {
  app.get('/healthz', async () => ({ ok: true }))

  // CLI is only one module set hosted by the local HTTP service.
  // More route groups can be mounted here later without coupling the
  // server lifecycle to CLI concerns.
  registerCliHttpRoutes(app)
  registerChatAssetHttpRoutes(app)
  registerComputerUseArtifactHttpRoutes(app)
  registerSecretRequestHttpRoutes(app)
  registerWidgetHttpRoutes(app)
}
