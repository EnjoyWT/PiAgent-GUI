import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:')
        ? fileURLToPath(context.parentURL)
        : ''
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) {
        return nextResolve(`${specifier}.ts`, context)
      }
    }
    return nextResolve(specifier, context)
  }
})

const { applyAgentSessionCompat } = await import(
  '../../../src/main/runtime/agent-session-compat.ts'
)

test('applyAgentSessionCompat heuristic reads agent.state.messages when session.messages is missing', () => {
  const longText = 'x'.repeat(800)
  const session = {
    model: { contextWindow: 10_000, maxTokens: 1024 },
    systemPrompt: 'sys',
    agent: {
      state: {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: longText }],
            stopReason: 'stop'
          }
        ]
      }
    },
    getContextUsage() {
      return {
        tokens: 10,
        contextWindow: 10_000,
        percent: 0.1
      }
    }
  }

  applyAgentSessionCompat(session)
  const usage = session.getContextUsage() as {
    tokens: number | null
    contextWindow: number
    percent: number | null
  }

  assert.ok(usage.tokens != null)
  assert.ok(usage.tokens! > 100)
  assert.ok(usage.tokens! > 10)
})

test('applyAgentSessionCompat swallows missing-usage TypeError from _checkCompaction', async () => {
  const session = {
    model: { contextWindow: 100_000, maxTokens: 4096 },
    async _checkCompaction() {
      throw new TypeError("Cannot read properties of undefined (reading 'totalTokens')")
    }
  }

  applyAgentSessionCompat(session)
  await assert.doesNotReject(async () => {
    await session._checkCompaction(
      {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'prompt is too long'
      },
      true
    )
  })
})
