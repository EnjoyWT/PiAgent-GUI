import { createReadStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { FastifyInstance } from 'fastify'

type ComputerUseArtifactRoutesOptions = {
  artifactDir?: string
}

const ARTIFACT_NAME_PATTERN = /^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp|gif)$/i

const MIME_TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

export const getComputerUseArtifactDir = (): string =>
  path.join(os.tmpdir(), 'piagent-computer-use')

const isValidComputerUseArtifactName = (fileName: string): boolean =>
  ARTIFACT_NAME_PATTERN.test(fileName)

const resolveArtifactPath = (artifactDir: string, fileName: string): string => {
  if (!isValidComputerUseArtifactName(fileName)) {
    throw new Error('Invalid computer use artifact name')
  }

  const root = path.resolve(artifactDir)
  const resolved = path.resolve(root, fileName)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid computer use artifact path')
  }
  return resolved
}

const getMimeType = (fileName: string): string => {
  const ext = path.extname(fileName).slice(1).toLowerCase()
  return MIME_TYPE_BY_EXT[ext] ?? 'application/octet-stream'
}

export const registerComputerUseArtifactHttpRoutes = (
  app: FastifyInstance,
  options: ComputerUseArtifactRoutesOptions = {}
): void => {
  const artifactDir = options.artifactDir ?? getComputerUseArtifactDir()

  app.get('/assets/computer-use/:fileName', async (request, reply) => {
    const params = request.params as { fileName?: string }
    const fileName = String(params.fileName ?? '').trim()

    let filePath: string
    try {
      filePath = resolveArtifactPath(artifactDir, fileName)
    } catch {
      reply.code(400)
      return { error: 'Invalid computer use artifact name' }
    }

    try {
      reply.header('Cache-Control', 'no-store')
      reply.type(getMimeType(fileName))
      return reply.send(createReadStream(filePath))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reply.code(404)
        return { error: 'Computer Use artifact not found' }
      }
      throw error
    }
  })
}
