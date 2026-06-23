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

test('file change names expose path tooltip and native context menu hook', () => {
  const rightArea = readSource('src/renderer/src/components/layout/RightArea.vue')
  const flowRenderer = readSource('src/renderer/src/components/chat/FlowRenderer.vue')
  const chatMessageItem = readSource('src/renderer/src/components/chat/ChatMessageItem.vue')
  const preload = readSource('src/preload/index.ts')
  const mainIndex = readSource('src/main/index.ts')

  assert.match(rightArea, /:workspace-path="workspacePath"/)
  assert.match(chatMessageItem, /workspacePath\?: string/)
  assert.match(chatMessageItem, /:workspace-path="props\.workspacePath"/)
  assert.match(flowRenderer, /import Tooltip from '\.\.\/common\/Tooltip\.vue'/)
  assert.match(flowRenderer, /workspacePath\?: string/)
  assert.match(flowRenderer, /const resolveFileDisplayPath = \(filePath: string\): string/)
  assert.match(flowRenderer, /<Tooltip[\s\S]*:text="resolveFileDisplayPath\(block\.entry\.path\)"/)
  assert.match(
    flowRenderer,
    /@contextmenu\.prevent\.stop="openFileContextMenu\(block\.entry\.path\)"/
  )
  assert.match(chatMessageItem, /:thread-id="props\.run\?\.threadId"/)
  assert.match(preload, /showFileContextMenu:/)
  assert.match(preload, /workspacePath\?: string \| null/)
  assert.match(mainIndex, /setupFileContextMenuHandlers\(\)/)
})
