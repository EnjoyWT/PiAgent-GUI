import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('local conversation cleanup shows deletion progress and compaction state', () => {
  const source = readFileSync('src/renderer/src/windows/settings/components/GeneralSettings.vue', 'utf8')
  assert.match(source, /localConversations\.onProgress/)
  assert.match(source, /正在删除会话/)
  assert.match(source, /正在压缩数据库/)
})
