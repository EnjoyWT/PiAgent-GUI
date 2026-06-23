import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/renderer/src/components/common/FloatingTooltip.vue', 'utf8')

test('FloatingTooltip keeps compact labels from shrink-wrapping vertically', () => {
  assert.match(source, /\.capability-tooltip-panel\s*{[^}]*width:\s*max-content/s)
  assert.match(
    source,
    /\.capability-tooltip-panel\s*{[^}]*max-width:\s*min\(260px,\s*calc\(100vw - 16px\)\)/s
  )
  assert.doesNotMatch(source, /\.capability-tooltip-panel\s*{[^}]*word-break:\s*break-all/s)
})

test('FloatingTooltip uses theme colors instead of hardcoded light surface text', () => {
  assert.match(
    source,
    /\.capability-tooltip-panel\s*{[^}]*background:\s*color-mix\(in srgb,\s*var\(--theme-bg-sidebar\)\s*94%,\s*var\(--theme-bg-content\)\)/s
  )
  assert.match(source, /\.capability-tooltip-panel\s*{[^}]*color:\s*var\(--theme-text-main\)/s)
  assert.match(source, /\.tooltip-title\s*{[^}]*color:\s*var\(--theme-text-bright\)/s)
  assert.match(source, /\.tooltip-muted\s*{[^}]*color:\s*var\(--theme-text-dim\)/s)
  assert.doesNotMatch(source, /background:\s*#f9fafb/)
  assert.doesNotMatch(source, /text-gray-700|text-gray-900|text-slate-400|text-slate-500/)
})

test('FloatingTooltip still allows path and list rows to wrap long file paths', () => {
  assert.match(source, /\.tooltip-line\s*{[^}]*overflow-wrap:\s*anywhere/s)
  assert.match(source, /\.tooltip-path\s*{[^}]*overflow-wrap:\s*anywhere/s)
})
