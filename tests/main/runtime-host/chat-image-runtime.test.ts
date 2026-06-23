import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ChatImageAssetService } from '../../../src/main/chat-assets/chat-image-asset-service.ts'
import {
  materializeImageBlockForRuntime,
  materializeContentBlocksForRuntime
} from '../../../src/main/runtime-host/chat-image-runtime.ts'

test('materializes image asset refs into runtime base64 only at the boundary', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'piagent-chat-image-runtime-'))
  try {
    const service = new ChatImageAssetService({ rootDir })
    const image = await service.persistImage({
      mimeType: 'image/png',
      name: 'demo.png',
      data: Buffer.from('png-bytes')
    })

    assert.deepEqual(await materializeImageBlockForRuntime(image, service), {
      type: 'image',
      data: Buffer.from('png-bytes').toString('base64'),
      mimeType: 'image/png'
    })
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('materializes mixed content blocks for runtime prompts', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'piagent-chat-image-runtime-'))
  try {
    const service = new ChatImageAssetService({ rootDir })
    const image = await service.persistImage({
      mimeType: 'image/jpeg',
      name: 'photo.jpg',
      data: Buffer.from('jpeg-bytes')
    })

    assert.deepEqual(
      await materializeContentBlocksForRuntime([{ type: 'text', text: 'hello' }, image], service),
      [
        { type: 'text', text: 'hello' },
        {
          type: 'image',
          data: Buffer.from('jpeg-bytes').toString('base64'),
          mimeType: 'image/jpeg'
        }
      ]
    )
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
