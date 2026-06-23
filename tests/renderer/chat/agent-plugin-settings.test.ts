import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readSource = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Agent plugin component rows explain extension components', () => {
  const source = readSource(
    '../../../src/renderer/src/windows/settings/components/AgentPluginsSettings.vue'
  )

  assert.match(source, /import Tooltip from '@renderer\/components\/common\/Tooltip\.vue'/)
  assert.match(source, /CircleHelp/)
  assert.match(source, /componentHelpText/)
  assert.match(source, /加载 PiAgent extension/)
  assert.match(source, /监听对话事件流并注册插件工具/)
})

test('Agent plugin settings exposes declared viewer URL actions', () => {
  const source = readSource(
    '../../../src/renderer/src/windows/settings/components/AgentPluginsSettings.vue'
  )

  assert.match(source, /pluginViewerUrl/)
  assert.match(source, /打开可视化界面/)
  assert.match(source, /window\.api\.openExternal/)
})

test('Agent plugin settings exposes PiAgent plugin spec and template guidance', () => {
  const source = readSource(
    '../../../src/renderer/src/windows/settings/components/AgentPluginsSettings.vue'
  )

  assert.match(source, /规格\/模板/)
  assert.match(source, /\.piagent-agent-plugin\/plugin\.json/)
  assert.match(source, /"domain": "agent-plugin"/)
  assert.match(source, /"skills": "\.\/skills"/)
  assert.match(source, /当前支持/)
  assert.match(source, /暂未支持/)
  assert.match(source, /showSpecModal/)
})
