import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('general settings includes the local data storage section and refresh action', () => {
  const source = readFileSync(
    resolve(repoRoot, 'src/renderer/src/windows/settings/components/GeneralSettings.vue'),
    'utf8'
  )

  assert.match(source, /本地数据与存储/)
  assert.match(source, /window\.api\.appStorage\.getSummary\(\)/)
  assert.match(source, /刷新/)
})
