import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ChatImageAssetService } from '../../../src/main/chat-assets/chat-image-asset-service.ts'
import { registerChatAssetHttpRoutes } from '../../../src/main/http/chat-asset-http-routes.ts'

test('serves chat image assets by asset id', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'piagent-chat-assets-http-'))
  const app = Fastify({ logger: false })
  try {
    const service = new ChatImageAssetService({ rootDir })
    const image = await service.persistImage({
      mimeType: 'image/png',
      name: 'demo.png',
      data: Buffer.from('png-bytes')
    })
    registerChatAssetHttpRoutes(app, service)

    const response = await app.inject({
      method: 'GET',
      url: `/assets/chat-images/${encodeURIComponent(image.assetId)}`
    })

    assert.equal(response.statusCode, 200)
    assert.match(response.headers['content-type'] as string, /^image\/png\b/)
    assert.equal(response.body, 'png-bytes')
    assert.equal(response.headers['cache-control'], 'private, max-age=86400')
  } finally {
    await app.close()
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('rejects invalid chat image asset ids', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'piagent-chat-assets-http-'))
  const app = Fastify({ logger: false })
  try {
    const service = new ChatImageAssetService({ rootDir })
    registerChatAssetHttpRoutes(app, service)

    const response = await app.inject({
      method: 'GET',
      url: '/assets/chat-images/not-an-image.txt'
    })

    assert.equal(response.statusCode, 400)
  } finally {
    await app.close()
    await rm(rootDir, { recursive: true, force: true })
  }
})
