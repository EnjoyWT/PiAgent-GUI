import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('dark theme is registered with the requested palette', () => {
  const themeSettings = readFileSync(
    resolve(repoRoot, 'src/renderer/src/windows/settings/components/ThemeSettings.vue'),
    'utf8'
  )
  const mainCss = readFileSync(resolve(repoRoot, 'src/renderer/src/assets/main.css'), 'utf8')
  const darkCss = readFileSync(resolve(repoRoot, 'src/renderer/src/assets/themes/dark.css'), 'utf8')

  assert.match(themeSettings, /id:\s*'dark'/)
  assert.match(themeSettings, /label:\s*'Dark'/)
  assert.match(mainCss, /@import '\.\/themes\/dark\.css';/)
  assert.match(darkCss, /:root\[data-theme='dark'\]/)
  assert.match(darkCss, /--theme-bg-main:\s*#000000;/)
  assert.match(darkCss, /--theme-bg-content:\s*#16181c;/i)
  assert.match(darkCss, /--theme-bg-hover-btn:\s*#1e2732;/i)
  assert.match(darkCss, /--theme-border-base:\s*#2f3336;/i)
  assert.match(darkCss, /--theme-text-main:\s*#e7e9ea;/i)
  assert.match(darkCss, /--theme-text-dim:\s*#8b98a5;/i)
  assert.match(darkCss, /--theme-text-bright:\s*#ffffff;/i)
  assert.match(darkCss, /--theme-accent:\s*#3d9cdc;/i)
  assert.doesNotMatch(darkCss, /#00ba88/i)
})

test('solarized dark theme uses a higher-contrast single-accent palette', () => {
  const themeSettings = readFileSync(
    resolve(repoRoot, 'src/renderer/src/windows/settings/components/ThemeSettings.vue'),
    'utf8'
  )
  const solarizedCss = readFileSync(
    resolve(repoRoot, 'src/renderer/src/assets/themes/solarized-dark.css'),
    'utf8'
  )

  assert.match(themeSettings, /id:\s*'solarized-dark'/)
  assert.match(themeSettings, /main:\s*'#062C36'/)
  assert.match(solarizedCss, /--theme-bg-main:\s*#062c36;/i)
  assert.match(solarizedCss, /--theme-bg-content:\s*#0b3a45;/i)
  assert.match(solarizedCss, /--theme-text-main:\s*#d4e3df;/i)
  assert.match(solarizedCss, /--theme-text-dim:\s*#8fb0af;/i)
  assert.match(solarizedCss, /--theme-text-bright:\s*#f4fbf8;/i)
  assert.match(solarizedCss, /--theme-accent:\s*#35b8ad;/i)
  assert.match(solarizedCss, /--theme-accent-dim:\s*#7bd3cb;/i)
  assert.doesNotMatch(solarizedCss, /--theme-accent-dim:\s*#268bd2/i)
})

test('custom theme editor opens in a dialog instead of inline content', () => {
  const themeSettings = readFileSync(
    resolve(repoRoot, 'src/renderer/src/windows/settings/components/ThemeSettings.vue'),
    'utf8'
  )

  assert.match(themeSettings, /<Teleport\s+to="body">/)
  assert.match(themeSettings, /role="dialog"/)
  assert.match(themeSettings, /aria-modal="true"/)
  assert.doesNotMatch(themeSettings, /Custom Theme Editor \(visible when editing\)/)
})
