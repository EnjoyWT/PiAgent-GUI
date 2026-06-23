import test from 'node:test'
import assert from 'node:assert/strict'
import { getChatImageAssetUrl } from '../../../src/renderer/src/utils/chat-image-assets.ts'

test('builds local HTTP URLs for chat image assets', () => {
  assert.equal(
    getChatImageAssetUrl('img_abc-123.png'),
    'http://127.0.0.1:5566/assets/chat-images/img_abc-123.png'
  )
})

test('encodes chat image asset ids in URLs', () => {
  assert.equal(
    getChatImageAssetUrl('img_a b.png'),
    'http://127.0.0.1:5566/assets/chat-images/img_a%20b.png'
  )
})
