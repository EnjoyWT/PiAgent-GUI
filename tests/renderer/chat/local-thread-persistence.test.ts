import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldPersistRuntimeUserMessageToLocalThread } from '../../../src/renderer/src/utils/local-thread-persistence.ts'

test('persists runtime user messages only for known local threads', () => {
  const knownLocalThreads = new Set(['local-thread-1'])
  const isKnownLocalThread = (threadId: string) => knownLocalThreads.has(threadId)

  assert.equal(
    shouldPersistRuntimeUserMessageToLocalThread('local-thread-1', isKnownLocalThread),
    true
  )
  assert.equal(
    shouldPersistRuntimeUserMessageToLocalThread('im-conversation-1', isKnownLocalThread),
    false
  )
})
