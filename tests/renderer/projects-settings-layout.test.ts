import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

test('project rows keep long workspace paths inside the settings content width', () => {
  const source = readFileSync(
    resolve(repoRoot, 'src/renderer/src/windows/settings/components/ProjectsSettings.vue'),
    'utf8'
  )

  assert.match(source, /class="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto"/)
  assert.match(source, /group flex min-w-0 items-center justify-between/)
  assert.match(source, /flex flex-1 min-w-0 items-center gap-4/)
  assert.match(source, /min-w-0 flex-1">\s*<h4/)
})
