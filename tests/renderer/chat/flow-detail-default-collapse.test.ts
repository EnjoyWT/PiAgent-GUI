import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const toolBlockSource = readFileSync('src/renderer/src/components/chat/FlowToolBlock.vue', 'utf8')
const fileBlockSource = readFileSync('src/renderer/src/components/chat/FlowFileBlock.vue', 'utf8')

test('tool detail blocks default to collapsed even while running', () => {
  assert.match(toolBlockSource, /const isExpanded = ref\(false\)/)
  assert.doesNotMatch(
    toolBlockSource,
    /const isExpanded = ref\(step\.value\.status === 'running'\)/
  )
  assert.doesNotMatch(toolBlockSource, /isExpanded\.value = true/)
})

test('file diff detail blocks default to collapsed even while running', () => {
  assert.match(fileBlockSource, /const isExpanded = ref\(false\)/)
  assert.doesNotMatch(
    fileBlockSource,
    /const isExpanded = ref\(props\.block\.step\.status === 'running'\)/
  )
  assert.doesNotMatch(fileBlockSource, /isExpanded\.value = true/)
})
