import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const readSource = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8')

const functionBody = (source: string, name: string): string => {
  const start = source.indexOf(`const ${name}`)
  assert.notEqual(start, -1, `${name} should exist`)
  const nextConst = source.indexOf('\nconst ', start + 1)
  return source.slice(start, nextConst === -1 ? undefined : nextConst)
}

test('runtime debug disables persisted event history without removing live UI updates', () => {
  const appSource = readSource('src/renderer/src/App.vue')
  const panelSource = readSource('src/renderer/src/components/debug/RuntimeDebugPanel.vue')
  const refreshBody = functionBody(appSource, 'refreshRuntimeDebugEvents')
  const appendLiveBody = functionBody(appSource, 'appendRuntimeLiveDebugEvent')
  const emitBody = functionBody(appSource, 'emitRendererDebugEvent')
  const scheduleBody = functionBody(appSource, 'scheduleRuntimeDebugRefresh')

  assert.match(appSource, /const RUNTIME_DEBUG_EVENT_HISTORY_DISABLED = true/)
  assert.doesNotMatch(refreshBody, /window\.api\.runtime\.listRuntimeEvents\(/)
  assert.doesNotMatch(emitBody, /window\.api\.runtime\.recordRendererDebugEvent\(/)
  assert.doesNotMatch(scheduleBody, /refreshRuntimeDebugEvents\(/)

  assert.match(
    appSource,
    /appendRuntimeLiveDebugEvent\(threadId, createRuntimeLiveEventFromAppEvent\(threadId, event\)\)/
  )
  assert.match(appendLiveBody, /if \(list\.length > 100\)/)
  assert.match(appendLiveBody, /list\.splice\(0, list\.length - 100\)/)
  assert.doesNotMatch(appendLiveBody, /300/)
  assert.match(emitBody, /appendRuntimeLiveDebugEvent\(threadId, event\)/)
  assert.match(appSource, /const live = runtimeLiveDebugEventsByThreadId\.get\(threadId\) \?\? \[\]/)

  assert.match(panelSource, /const activeTab = ref<'context' \| 'events'>\('events'\)/)
  assert.match(panelSource, /title="Timeline"/)
  assert.match(panelSource, /@click="activeTab = 'events'"/)
  assert.match(panelSource, /只展示当前窗口实时收到的 live 内存事件/)
  assert.doesNotMatch(panelSource, /Timeline disabled/)
  assert.doesNotMatch(panelSource, /core-v2\.event_log/)
  assert.doesNotMatch(panelSource, /已持久化/)
})
