import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/renderer/src/components/chat/FlowRenderer.vue', 'utf8')

test('FlowRenderer uses cursor indicators instead of spinner icons for running tool rows', () => {
  assert.match(source, /class="tool-running-cursor"/)
  assert.match(source, /\.tool-running-cursor\s*{[^}]*background:\s*var\(--theme-accent\)/s)
  assert.doesNotMatch(source, /v-else-if="block\.step\.status === 'running'"[\s\S]{0,120}<Loader2/)
})
