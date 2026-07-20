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
  const nextConst = source.slice(start + 1).search(/\n\s*const /)
  if (nextConst === -1) return source.slice(start)
  return source.slice(start, start + 1 + nextConst)
}

test('runtime debug disables timeline ingest and persisted event history', () => {
  const debugSource = readSource('src/renderer/src/utils/app-runtime-debug.ts')
  const bridgeSource = readSource('src/renderer/src/utils/app-runtime-event-bridge.ts')
  const panelSource = readSource('src/renderer/src/components/debug/RuntimeDebugPanel.vue')
  const refreshBody = functionBody(debugSource, 'refreshRuntimeDebugEvents')
  const appendLiveBody = functionBody(debugSource, 'appendRuntimeLiveDebugEvent')
  const emitBody = functionBody(debugSource, 'emitRendererDebugEvent')
  const scheduleBody = functionBody(debugSource, 'scheduleRuntimeDebugRefresh')
  const eventsBody = functionBody(debugSource, 'runtimeDebugEvents')

  assert.match(debugSource, /const RUNTIME_DEBUG_EVENT_HISTORY_DISABLED = true/)
  assert.match(debugSource, /const RUNTIME_DEBUG_TIMELINE_DISABLED = true/)
  assert.doesNotMatch(refreshBody, /window\.api\.runtime\.listRuntimeEvents\(/)
  assert.doesNotMatch(emitBody, /window\.api\.runtime\.recordRendererDebugEvent\(/)
  assert.doesNotMatch(scheduleBody, /refreshRuntimeDebugEvents\(/)

  assert.match(appendLiveBody, /if \(RUNTIME_DEBUG_TIMELINE_DISABLED\) return/)
  assert.match(emitBody, /if \(RUNTIME_DEBUG_TIMELINE_DISABLED\) return/)
  assert.match(eventsBody, /if \(RUNTIME_DEBUG_TIMELINE_DISABLED\) return \[\]/)

  assert.match(
    bridgeSource,
    /appendRuntimeLiveDebugEvent\(\s*threadId,\s*options\.createRuntimeLiveEventFromAppEvent\(threadId, event\)\s*\)/
  )

  assert.match(panelSource, /const activeTab = ref<'context' \| 'events'>\('context'\)/)
  assert.match(panelSource, /title="Timeline"/)
  assert.match(panelSource, /@click="activeTab = 'events'"/)
  assert.match(panelSource, /Timeline 已关闭/)
  assert.match(panelSource, /已停止接收 Timeline 数据/)
  assert.doesNotMatch(panelSource, /core-v2\.event_log/)
  assert.doesNotMatch(panelSource, /已持久化/)
})
