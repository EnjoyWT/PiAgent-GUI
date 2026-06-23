import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  ChatImageAssetService,
  isValidChatImageAssetId
} from '../../../src/main/chat-assets/chat-image-asset-service.ts'

test('persists image bytes as a local chat asset reference', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'piagent-chat-assets-'))
  try {
    const service = new ChatImageAssetService({ rootDir })
    const image = await service.persistImage({
      mimeType: 'image/png',
      name: 'demo.png',
      data: Buffer.from('png-bytes')
    })

    assert.equal(image.type, 'image')
    assert.equal(image.mimeType, 'image/png')
    assert.equal(image.name, 'demo.png')
    assert.equal(image.sizeBytes, 9)
    assert.match(image.assetId, /^img_[a-zA-Z0-9_-]+\.png$/)
    assert.equal(isValidChatImageAssetId(image.assetId), true)

    const filePath = service.resolvePath(image.assetId)
    assert.equal(path.dirname(filePath), path.join(rootDir, 'images'))
    assert.equal(await readFile(filePath, 'utf8'), 'png-bytes')
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('reads image assets as base64 only on demand', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'piagent-chat-assets-'))
  try {
    const service = new ChatImageAssetService({ rootDir })
    const image = await service.persistImage({
      mimeType: 'image/jpeg',
      name: 'photo.jpg',
      data: Buffer.from('jpeg-bytes')
    })

    const inline = await service.readAsBase64(image.assetId)

    assert.deepEqual(inline, {
      type: 'image',
      data: Buffer.from('jpeg-bytes').toString('base64'),
      mimeType: 'image/jpeg'
    })
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('rejects invalid asset ids before resolving a filesystem path', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'piagent-chat-assets-'))
  try {
    const service = new ChatImageAssetService({ rootDir })

    assert.throws(() => service.resolvePath('../secret.png'), /Invalid chat image asset id/)
    await assert.rejects(() => service.readAsBase64('../secret.png'), /Invalid chat image asset id/)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
