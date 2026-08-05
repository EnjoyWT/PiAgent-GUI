import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('local conversation cleanup worker has its own build entry', () => {
  const config = readFileSync('electron.vite.config.ts', 'utf8')
  const service = readFileSync('src/main/local-conversation-cleanup/cleanup-service.ts', 'utf8')
  assert.match(config, /'local-conversation-cleanup-worker-entry'/)
  assert.match(service, /local-conversation-cleanup-worker-entry\.js/)
})
