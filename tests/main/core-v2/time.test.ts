import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCoreTimestamp } from '../../../src/main/core-v2/time.ts'

test('core timestamps store local ISO strings with an explicit offset', () => {
  const input = new Date('2026-04-20T08:00:05.123Z')
  const output = normalizeCoreTimestamp(input)

  assert.match(output, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
  assert.equal(Date.parse(output), input.getTime())
  assert.equal(output.endsWith('Z'), false)
})
