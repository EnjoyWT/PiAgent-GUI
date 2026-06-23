import test from 'node:test'
import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { ScheduledTaskService } from '../../../src/main/scheduled-tasks/scheduled-task-service.ts'

test('validate resolves model override fields without throwing', () => {
  const service = new ScheduledTaskService({} as Database.Database)

  const result = service.validate({
    name: 'Daily summary',
    prompt: 'Summarize today',
    schedule: 'every 1h',
    modelProviderId: 'openai',
    modelId: 'gpt-5'
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.task.triggerExecutionOverride, {
    model: {
      providerId: 'openai',
      modelId: 'gpt-5'
    }
  })
})
