import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeKnowledgeText,
  makeEntitySlug,
  buildKnowledgeFtsQuery
} from '../../../src/main/knowledge/knowledge-text.ts'

test('normalizeKnowledgeText cleans whitespace and preserves Chinese', () => {
  assert.equal(normalizeKnowledgeText('  PiAgent   is  cool '), 'PiAgent is cool')
  assert.equal(normalizeKnowledgeText('项目 / Alpha'), '项目 / Alpha')
  assert.equal(normalizeKnowledgeText(''), '')
})

test('makeEntitySlug generates lowercase slug and falls back on empty name', () => {
  assert.equal(makeEntitySlug('project', 'PiAgent'), 'project:piagent')
  assert.equal(makeEntitySlug('person', ' 张三 '), 'person:zhang-san')
  assert.equal(makeEntitySlug('project', '项目 / Alpha'), 'project:项目-alpha')
  assert.equal(makeEntitySlug('project', ''), 'project:unknown')
})

test('buildKnowledgeFtsQuery constructs OR query with double-quoted tokens', () => {
  assert.equal(buildKnowledgeFtsQuery(''), '')
  assert.equal(buildKnowledgeFtsQuery('PiAgent core'), '"piagent" OR "core"')
  assert.equal(buildKnowledgeFtsQuery('张三: "hello"*'), '"张" OR "三" OR "hello"')
  assert.equal(buildKnowledgeFtsQuery('1 2 3 4 5 6 7 8 9 10 11 12 13'), '"1" OR "2" OR "3" OR "4" OR "5" OR "6" OR "7" OR "8" OR "9" OR "10" OR "11" OR "12"')
})
