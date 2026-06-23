import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readSource = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Skills settings shows skill content in a dialog instead of inline expansion', () => {
  const source = readSource(
    '../../../src/renderer/src/windows/settings/components/SkillsSettings.vue'
  )

  assert.match(source, /import BaseDialog from '@renderer\/components\/common\/BaseDialog.vue'/)
  assert.match(source, /<BaseDialog[\s\S]*aria-label="技能内容详情"/)
  assert.match(source, /aria-label="技能内容详情"/)
  assert.match(source, /openSkillContentDialog\(item\)/)
  assert.doesNotMatch(source, /expanded\[item\.name\]/)
})

test('Knowledge L4 profile detail uses the shared base dialog', () => {
  const source = readSource(
    '../../../src/renderer/src/windows/settings/components/KnowledgeSettings.vue'
  )

  assert.match(source, /import BaseDialog from '@renderer\/components\/common\/BaseDialog.vue'/)
  assert.match(source, /<BaseDialog[\s\S]*aria-label="L4 实体记忆详情"/)
})

test('Base dialog provides shared overlay, card, transition, and square close button styles', () => {
  const source = readSource('../../../src/renderer/src/components/common/BaseDialog.vue')

  assert.match(source, /<Teleport to="body">/)
  assert.match(source, /<Transition name="base-dialog-fade">/)
  assert.match(source, /class="base-dialog-overlay"/)
  assert.match(source, /class="base-dialog-card"/)
  assert.match(source, /h-8 w-8/)
  assert.match(source, /<X :size="16" \/>/)
})

test('Skills refresh button keeps the same icon across loading and refreshed states', () => {
  const source = readSource(
    '../../../src/renderer/src/windows/settings/components/SkillsSettings.vue'
  )

  assert.match(
    source,
    /<RefreshCw[\s\S]*:class="refreshIconSpinning \|\| loading \? 'animate-spin' : ''"/
  )
  assert.match(source, /class="inline-flex w-\[5\.25rem\] items-center gap-1\.5/)
  assert.match(source, /const refreshIconSpinning = ref\(false\)/)
  assert.match(source, /refreshIconSpinning\.value = true/)
  assert.match(source, /refreshIconSpinning\.value = false/)
  assert.doesNotMatch(source, /<Check v-else :size="14" \/>/)
})
