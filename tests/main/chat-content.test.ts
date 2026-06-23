import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeChatMessageContent } from '../../src/shared/chat-content.ts'

test('normalizes image blocks with asset references', () => {
  const content = normalizeChatMessageContent({
    version: 1,
    blocks: [
      { type: 'text', text: 'look' },
      {
        type: 'image',
        assetId: 'img_abc123.png',
        mimeType: 'image/png',
        name: 'demo.png',
        sizeBytes: 12345
      }
    ]
  })

  assert.deepEqual(content, {
    version: 1,
    blocks: [
      { type: 'text', text: 'look' },
      {
        type: 'image',
        assetId: 'img_abc123.png',
        mimeType: 'image/png',
        name: 'demo.png',
        sizeBytes: 12345
      }
    ]
  })
})

test('rejects image blocks that only contain inline base64 data', () => {
  const content = normalizeChatMessageContent({
    version: 1,
    blocks: [
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'iVBORw0KGgo='
      }
    ]
  })

  assert.equal(content, null)
})
