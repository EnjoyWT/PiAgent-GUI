import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../..')

const readSource = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8')

test('chat image gallery does not expose image names in visible UI', () => {
  const source = readSource('src/renderer/src/components/chat/ChatImageGallery.vue')

  assert.equal(source.includes('{{ image.name }}'), false)
  assert.equal(source.includes(':title="image.name'), false)
})

test('chat input attachment previews do not expose file names in visible UI', () => {
  const source = readSource('src/renderer/src/components/chat/ChatInputBox.vue')

  assert.equal(source.includes('{{ file.name }}'), false)
  assert.equal(source.includes(':title="file.name'), false)
})

test('chat input animated caret uses supported color configuration', () => {
  const source = readSource('src/renderer/src/components/chat/ChatInputBox.vue')

  assert.equal(source.includes('preset="gradient-green"'), false)
  assert.match(source, /<YLAnimatedCaret[\s\S]*:trail-count="2"/)
})
