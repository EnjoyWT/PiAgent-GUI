import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/renderer/src/components/chat/FlowRenderer.vue', 'utf8')

test('FlowRenderer defers intermediate process auto-collapse until the final answer has painted', () => {
  assert.match(source, /scheduleIntermediateProcessAutoCollapse/)
  assert.match(source, /await nextTick\(\)/)
  assert.match(source, /requestAnimationFrame/)
  assert.match(source, /flush:\s*'post'/)
  assert.match(source, /v-show="!intermediateProcessCollapsed \|\| isFinalAnswerBlock\(block\)"/)
  assert.doesNotMatch(source, /<TransitionGroup\s+name="flow-intermediate-collapse"/)
})
