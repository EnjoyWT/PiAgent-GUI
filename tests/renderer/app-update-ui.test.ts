import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

const readSource = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8')

test('About settings uses one primary update button with internal progress and a download prompt', () => {
  const source = readSource('src/renderer/src/windows/settings/components/AboutSettings.vue')

  assert.match(source, /buildAppUpdatePrimaryControl/)
  assert.match(source, /primaryControl\.progressPercent/)
  assert.match(source, /bottom-1 h-0\.5/)
  assert.match(source, /<BaseDialog[\s\S]*aria-label="应用更新"/)
  assert.match(source, /立即下载/)
  assert.match(source, /关闭关于页面不会中断/)
})

test('App sidebar exposes a clickable update badge that opens About settings', () => {
  const sidebarSource = readSource('src/renderer/src/components/layout/AppSidebar.vue')
  const appSource = readSource('src/renderer/src/App.vue')

  assert.match(sidebarSource, /updateBadge:\s*AppUpdateSidebarBadge \| null/)
  assert.match(sidebarSource, /\(e:\s*'openUpdateSettings'\):\s*void/)
  assert.match(sidebarSource, /@click="emit\('openUpdateSettings'\)"/)
  assert.match(sidebarSource, /props\.updateBadge\.label/)

  assert.match(appSource, /buildAppUpdateSidebarBadge/)
  assert.match(appSource, /window\.api\.appUpdate\.getStatus\(\)/)
  assert.match(appSource, /window\.api\.appUpdate\.onStatus/)
  assert.match(appSource, /@open-update-settings="openUpdateSettings"/)
  assert.match(appSource, /const openUpdateSettings = \(\): void => openSettings\('about'\)/)
})
