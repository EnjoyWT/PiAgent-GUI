import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readSource = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

test('settings sidebar keeps Plugins and exposes IM as a separate module', () => {
  const settingsWindowSource = readSource(
    '../../../src/renderer/src/windows/settings/SettingsWindow.vue'
  )

  assert.match(settingsWindowSource, /import ImSettings from '\.\/components\/ImSettings\.vue'/)
  assert.match(settingsWindowSource, /\{\s*id:\s*'plugins',\s*label:\s*'插件'/)
  assert.match(settingsWindowSource, /\{\s*id:\s*'im',\s*label:\s*'IM'/)
  assert.match(settingsWindowSource, /im:\s*ImSettings/)
  assert.match(settingsWindowSource, /plugins:\s*PluginsSettings/)
  assert.doesNotMatch(settingsWindowSource, /activeCategory\.value === 'plugins' \? 'im'/)
})

test('IM settings owns transport plugin content without the search bar', () => {
  const imSettingsSource = readSource(
    '../../../src/renderer/src/windows/settings/components/ImSettings.vue'
  )
  const listHeaderStart = imSettingsSource.indexOf(
    'px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3'
  )
  const listBodyStart = imSettingsSource.indexOf(
    'flex-1 min-h-0 min-w-0 overflow-y-auto',
    listHeaderStart
  )
  const listHeaderSource = imSettingsSource.slice(listHeaderStart, listBodyStart)

  assert.doesNotMatch(imSettingsSource, /v-model="searchQuery"/)
  assert.doesNotMatch(imSettingsSource, /placeholder="搜索/)
  assert.doesNotMatch(imSettingsSource, /<div class="flex items-center justify-end">/)
  assert.match(imSettingsSource, />IM 插件</)
  assert.match(listHeaderSource, /\{\{\s*plugins\.length\s*\}\} 个 IM 插件/)
  assert.match(listHeaderSource, /@click="refreshImPlugins\(\)"/)
  assert.match(listHeaderSource, /refreshIconSpinning/)
  assert.match(imSettingsSource, /setTimeout\(\(\) => \{\s*refreshIconSpinning\.value = false/)
  assert.match(imSettingsSource, /未发现已安装的 IM 插件。/)
  assert.match(imSettingsSource, />IM 插件详情</)
  assert.match(imSettingsSource, /window\.api\.plugins\.listInstalled/)
})

test('Plugins settings does not load IM transport plugin content', () => {
  const pluginSettingsSource = readSource(
    '../../../src/renderer/src/windows/settings/components/PluginsSettings.vue'
  )

  assert.match(pluginSettingsSource, /placeholder="搜索插件\.\.\."/)
  assert.match(pluginSettingsSource, /@click="refreshPluginList\(\)"/)
  assert.match(pluginSettingsSource, /refreshIconSpinning/)
  assert.match(pluginSettingsSource, /setTimeout\(\(\) => \{\s*refreshIconSpinning\.value = false/)
  assert.match(pluginSettingsSource, /已安装/)
  assert.match(pluginSettingsSource, /已启用/)
  assert.match(pluginSettingsSource, /可用/)
  assert.match(pluginSettingsSource, /不可用/)
  assert.match(
    pluginSettingsSource,
    /\{\{\s*filteredPlugins\.length\s*\}\} \/ \{\{\s*plugins\.length\s*\}\} 个插件/
  )
  assert.match(pluginSettingsSource, />插件</)
  assert.doesNotMatch(pluginSettingsSource, /IM 插件/)
  assert.doesNotMatch(pluginSettingsSource, /window\.api\.plugins\.listInstalled/)
  assert.doesNotMatch(pluginSettingsSource, /onTransportAccountSetupEvent/)
})
