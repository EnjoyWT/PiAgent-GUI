import Fastify, { type FastifyInstance } from 'fastify'
import { LOCAL_HTTP_HOST, LOCAL_HTTP_PORT } from './local-http-config'
import { registerLocalHttpRoutes } from './register-local-http-routes'

let localHttpServer: FastifyInstance | null = null

export const startLocalHttpServer = async (): Promise<void> => {
  if (localHttpServer) return

  const app = Fastify({
    logger: false
  })

  registerLocalHttpRoutes(app)

  try {
    await app.listen({
      host: LOCAL_HTTP_HOST,
      port: LOCAL_HTTP_PORT
    })
    localHttpServer = app
  } catch (error) {
    try {
      await app.close()
    } catch {
      // ignore close failure after listen error
    }
    throw error
  }
}

export const stopLocalHttpServer = async (): Promise<void> => {
  if (!localHttpServer) return
  const app = localHttpServer
  localHttpServer = null
  await app.close()
}
