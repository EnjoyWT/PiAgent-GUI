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
  assert.match(source, /updateStatus\.phase === 'checking'/)
  assert.match(source, /updateStatus\.phase === 'downloading'/)
  assert.match(source, /updateStatus\.phase === 'installing'/)
  assert.match(source, /primaryIconClass/)
  assert.match(source, /if \(updateStatus\.phase === 'downloading'\) return Download/)
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
  assert.match(sidebarSource, /Download/)
  assert.match(sidebarSource, /const updateBadgeIcon = computed/)
  assert.match(
    sidebarSource,
    /props\.updateBadge\.tone === 'downloading' \? Download : CircleArrowUp/
  )

  assert.match(appSource, /buildAppUpdateSidebarBadge/)
  assert.match(appSource, /window\.api\.appUpdate\.getStatus\(\)/)
  assert.match(appSource, /window\.api\.appUpdate\.onStatus/)
  assert.match(appSource, /@open-update-settings="openUpdateSettings"/)
  assert.match(appSource, /const openUpdateSettings = \(\): void => openSettings\('about'\)/)
})

test('App updater install flow exposes an installing state before quitting', () => {
  const aboutSource = readSource('src/renderer/src/windows/settings/components/AboutSettings.vue')
  const serviceSource = readSource('src/main/updater/app-updater-service.ts')

  assert.match(aboutSource, /updateStatus\.phase = 'installing'/)
  assert.match(
    aboutSource,
    /updateStatus\.phase === 'checking' \|\|[\s\S]*updateStatus\.phase === 'installing'/
  )
  assert.match(serviceSource, /this\.setPhase\('installing'/)
  assert.match(serviceSource, /if \(this\.phase === 'installing'\) return this\.getStatus\(\)/)
  assert.match(serviceSource, /toUserFacingUpdateError\(error, 'install'\)/)
})
