import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SummaryPromptBuilder,
  createEmptySummarySections,
  renderSummarySections
} from '../../../src/main/context/summary-prompt-builder.ts'

test('SummaryPromptBuilder renders fixed section headings in order', () => {
  const builder = new SummaryPromptBuilder()
  const prompt = builder.build({
    mode: 'initial',
    entries: []
  })

  assert.match(prompt.systemPrompt, /## Goal/)
  assert.match(prompt.systemPrompt, /## Remaining Work/)
  assert.match(prompt.systemPrompt, /## Critical Context/)
})

test('SummaryPromptBuilder parses markdown summary sections and normalizes missing sections', () => {
  const builder = new SummaryPromptBuilder()
  const sections = builder.parseSections(`
## Goal
Ship context compression safely

## Resolved Questions
reload is not a compaction path

## Pending User Asks
implement manual compact
  `)

  assert.equal(sections.goal, 'Ship context compression safely')
  assert.equal(sections.resolvedQuestions, 'reload is not a compaction path')
  assert.equal(sections.pendingUserAsks, 'implement manual compact')

  const normalized = builder.renderSections({
    ...createEmptySummarySections(),
    ...sections
  })
  assert.match(normalized, /## Constraints & Preferences/)
  assert.match(normalized, /## Remaining Work/)
})

test('renderSummarySections keeps the fixed section order', () => {
  const rendered = renderSummarySections({
    ...createEmptySummarySections(),
    criticalContext: 'keep this'
  })

  const remainingIndex = rendered.indexOf('## Remaining Work')
  const criticalIndex = rendered.indexOf('## Critical Context')
  assert.ok(remainingIndex >= 0)
  assert.ok(criticalIndex > remainingIndex)
})
