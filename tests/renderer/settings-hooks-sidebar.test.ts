import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readSource = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

test('settings sidebar does not expose a standalone hooks module', () => {
  const settingsWindowSource = readSource('../../src/renderer/src/windows/settings/SettingsWindow.vue')

  assert.doesNotMatch(settingsWindowSource, /\{\s*id:\s*'hooks',\s*label:\s*'钩子'/)
  assert.doesNotMatch(settingsWindowSource, /\bWebhook\b/)
})
