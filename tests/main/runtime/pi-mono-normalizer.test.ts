import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@shared/')) {
      const sharedPath = resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`)
      return {
        shortCircuit: true,
        url: pathToFileURL(sharedPath).href
      }
    }
    return nextResolve(specifier, context)
  }
})

const { PiMonoNormalizer } = await import('../../../src/main/runtime/pi-mono-normalizer.ts')

test('normalizer closes open thinking before text delta and ignores late thinking end', () => {
  const normalizer = new PiMonoNormalizer('thread-thinking')

  normalizer.normalizeMany({ type: 'agent_start' })
  normalizer.normalizeMany({ type: 'turn_start' })
  normalizer.normalizeMany({
    type: 'message_start',
    message: {
      role: 'assistant',
      content: []
    }
  })

  const thinkingStart = normalizer.normalizeMany({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'thinking_start',
      contentIndex: 0,
      partial: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '先' }]
      }
    },
    message: {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '先' }]
    }
  })
  assert.equal(thinkingStart[0]?.type, 'agentMessageThinkingStarted')

  normalizer.normalizeMany({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'thinking_delta',
      contentIndex: 0,
      delta: '想一下',
      partial: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '先想一下' }]
      }
    },
    message: {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '先想一下' }]
    }
  })

  const textDelta = normalizer.normalizeMany({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'text_delta',
      contentIndex: 1,
      delta: '正文',
      partial: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先想一下' },
          { type: 'text', text: '正文' }
        ]
      }
    },
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '先想一下' },
        { type: 'text', text: '正文' }
      ]
    }
  })

  assert.deepEqual(
    textDelta.map((event) => event.type),
    ['agentMessageThinkingFinished', 'agentMessageDelta']
  )
  assert.equal((textDelta[0]?.payload as { content?: string } | undefined)?.content, '先想一下')

  const lateThinkingEnd = normalizer.normalizeMany({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'thinking_end',
      contentIndex: 0,
      content: '先想一下',
      partial: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先想一下' },
          { type: 'text', text: '正文' }
        ]
      }
    },
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '先想一下' },
        { type: 'text', text: '正文' }
      ]
    }
  })

  assert.deepEqual(lateThinkingEnd, [])
})

const retryableAssistantMessage = {
  role: 'assistant',
  content: [],
  stopReason: 'error',
  errorMessage: 'fetch failed'
}

const createRetryableEndedRun = () => {
  const normalizer = new PiMonoNormalizer('thread-retry')
  const started = normalizer.normalizeMany({ type: 'agent_start' })
  assert.equal(started[0]?.type, 'agentRunStarted')

  const ended = normalizer.normalizeMany({
    type: 'agent_end',
    messages: [retryableAssistantMessage]
  })
  assert.equal(ended.length, 0)
  return normalizer
}

test('normalizer finalizes retryable run as aborted when abort arrives before retry starts', () => {
  const normalizer = createRetryableEndedRun()

  const events = normalizer.markAbortRequested()
  const retryStarted = normalizer.normalizeMany({
    type: 'auto_retry_start',
    attempt: 1,
    maxAttempts: 5,
    delayMs: 1000,
    errorMessage: 'fetch failed'
  })

  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, 'agentRunAborted')
  const payload = events[0]?.payload as { requestedStatus?: string }
  assert.equal(payload.requestedStatus, 'aborted')
  assert.equal(retryStarted.length, 0)
})

test('normalizer finalizes retryable run as aborted when retry wait is cancelled', () => {
  const normalizer = createRetryableEndedRun()

  const retryStarted = normalizer.normalizeMany({
    type: 'auto_retry_start',
    attempt: 1,
    maxAttempts: 5,
    delayMs: 1000,
    errorMessage: 'fetch failed'
  })
  assert.equal(retryStarted.length, 0)

  const events = normalizer.markAbortRequested()
  const retryEnded = normalizer.normalizeMany({
    type: 'auto_retry_end',
    success: false,
    attempt: 1,
    finalError: 'Retry cancelled'
  })

  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, 'agentRunAborted')
  const payload = events[0]?.payload as {
    requestedStatus?: string
    retryAttempt?: number
    maxRetryAttempts?: number
  }
  assert.equal(payload.requestedStatus, 'aborted')
  assert.equal(payload.retryAttempt, 1)
  assert.equal(payload.maxRetryAttempts, 5)
  assert.equal(retryEnded.length, 0)
})

test('normalizer emits aborted immediately when abort is requested during an active run', () => {
  const normalizer = new PiMonoNormalizer('thread-active-abort')
  normalizer.normalizeMany({ type: 'agent_start' })

  const events = normalizer.markAbortRequested()
  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, 'agentRunAborted')
})

test('normalizer aborts a run immediately when abort was requested before agent_start arrives', () => {
  const normalizer = new PiMonoNormalizer('thread-pre-start-abort')
  normalizer.markAbortRequested()

  const events = normalizer.normalizeMany({ type: 'agent_start' })
  assert.equal(events.length, 2)
  assert.equal(events[0]?.type, 'agentRunStarted')
  assert.equal(events[1]?.type, 'agentRunAborted')
})
