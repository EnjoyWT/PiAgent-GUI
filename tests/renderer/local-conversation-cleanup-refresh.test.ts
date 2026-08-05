import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('refreshes the desktop conversation snapshot after local cleanup finishes', () => {
  const source = readFileSync('src/renderer/src/App.vue', 'utf8')
  const handlerSource = readFileSync('src/main/ipc/local-conversation-cleanup-handlers.ts', 'utf8')

  assert.match(source, /localConversations\.onCleared/)
  assert.match(source, /await reloadWorkspaceSnapshot\(\)/)
  assert.match(handlerSource, /BrowserWindow\.getAllWindows\(\)/)
})
