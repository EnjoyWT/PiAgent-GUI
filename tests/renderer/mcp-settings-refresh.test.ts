import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('MCP refresh button rotates while refreshing and blocks duplicate clicks', () => {
  const source = readFileSync(
    resolve(repoRoot, 'src/renderer/src/windows/settings/components/McpSettings.vue'),
    'utf8'
  )

  assert.match(source, /const refreshIconSpinning = ref\(false\)/)
  assert.match(source, /:disabled="isRefreshing"/)
  assert.match(source, /refreshIconSpinning \|\| isRefreshing \? 'animate-spin' : ''/)
  assert.match(source, /refreshIconSpinning\.value = true/)
})
