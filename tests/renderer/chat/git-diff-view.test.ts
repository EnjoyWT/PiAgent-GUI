import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDiffViewHunks } from '../../../src/renderer/src/components/chat/git-diff.ts'

test('buildDiffViewHunks wraps bare unified hunks with file headers for rendering', () => {
  const hunks = buildDiffViewHunks({
    diff: '@@ -37,7 +37,8 @@ export default defineConfig({\n-      hmr: false\n+      hmr: true,\n+      port: 5173',
    filePath: 'electron.vite.config.ts'
  })

  assert.equal(hunks.length, 1)
  assert.match(hunks[0], /^--- a\/electron\.vite\.config\.ts/m)
  assert.match(hunks[0], /^\+\+\+ b\/electron\.vite\.config\.ts/m)
  assert.match(hunks[0], /^@@ -37,7 \+37,8 @@/m)
})

test('buildDiffViewHunks keeps full file patches together instead of splitting per hunk', () => {
  const hunks = buildDiffViewHunks({
    diff: [
      'Index: src/example.ts',
      '===================================================================',
      '--- src/example.ts',
      '+++ src/example.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '@@ -9 +9 @@',
      '-before',
      '+after'
    ].join('\n')
  })

  assert.equal(hunks.length, 1)
  assert.match(hunks[0], /^Index: src\/example\.ts/m)
  assert.match(hunks[0], /^@@ -9 \+9 @@/m)
})

test('buildDiffViewHunks returns no structured hunks for non-diff text', () => {
  assert.deepEqual(buildDiffViewHunks({ diff: 'file changed successfully' }), [])
})
