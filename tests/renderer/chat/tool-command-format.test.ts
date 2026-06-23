import test from 'node:test'
import assert from 'node:assert/strict'
import { formatToolCommand } from '../../../src/renderer/src/components/chat/tool-command-format.ts'

test('formats array arguments in tool command details', () => {
  const command = formatToolCommand({
    toolName: 'webFetchTool',
    args: {
      urls: ['https://example.com/page'],
      maxCharsPerUrl: 4000
    }
  })

  assert.match(command, /^webFetchTool /)
  assert.match(command, /--urls \["https:\/\/example\.com\/page"\]/)
  assert.match(command, /--maxCharsPerUrl 4000/)
})
