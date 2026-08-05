import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/renderer/src/components/chat/ChatInputBox.vue', 'utf8')

test('chat composer does not expose per-workspace MCP selection controls', () => {
  assert.doesNotMatch(source, /aria-label="MCP servers"/)
  assert.doesNotMatch(source, /workspaceMcpServers\.(?:setEnabled|clear)/)
  assert.doesNotMatch(source, /loadWorkspaceMcpServers/)
})
