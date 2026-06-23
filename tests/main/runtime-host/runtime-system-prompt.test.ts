import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildRuntimeSystemPrompt,
  withTemporaryPromptAppend
} from '../../../src/main/runtime-host/runtime-system-prompt.ts'

test('buildRuntimeSystemPrompt includes restored core rules and soul content', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'piagent-soul-'))
  const soulPath = path.join(tempDir, 'SOUL.md')
  writeFileSync(soulPath, '# Soul\n\n- custom persona', 'utf8')

  const prompt = buildRuntimeSystemPrompt('/tmp/workspace', 'thread-123', tempDir)

  assert.match(prompt, /You are yolo, a helpful AI assistant\./)
  assert.match(prompt, /Thread ID: thread-123/)
  assert.match(prompt, new RegExp(`Current host os\\/platform: ${os.platform()}`))
  assert.match(prompt, /use `setPlanTool`/i)
  assert.match(prompt, /use `closePlanTool`/i)
  assert.match(prompt, /Thread ID for task state: thread-123/)
  assert.doesNotMatch(prompt, /\.piagent\/todos-thread-123\.md/)
  assert.match(prompt, /discoverBuiltinToolsTool/)
  assert.match(prompt, /runtime preloads the active tool set/i)
  assert.match(prompt, /For IM or transport account setup/)
  assert.match(prompt, /Do not use `questionnaireTool` to invent setup choices/)
  assert.match(prompt, /do not mention where or how the QR is displayed/i)
  assert.match(prompt, /scan the QR with WeChat/i)
  assert.match(prompt, /Do not copy the QR image, link, QR text, or expiry/i)
  assert.doesNotMatch(prompt, /desktop chat UI renders the QR login card/i)
  assert.doesNotMatch(prompt, /QR cards?/i)
  assert.doesNotMatch(prompt, /rendered card/i)
  assert.doesNotMatch(prompt, /show that QR code to the user/)
  assert.match(prompt, /do not ask the user to manually confirm scanning/)
  assert.match(prompt, /For Feishu direct messages, use `externalUserId`/)
  assert.match(prompt, /use `questionTool` instead of plain text/)
  assert.match(prompt, /use `secretRequestTool`/)
  assert.match(prompt, /Secret rule \(MANDATORY\): NEVER ask the user to paste, type, send/)
  assert.match(prompt, /Do not say .*直接发给我/)
  assert.match(prompt, /collect the API key afterward only through masked secret input/)
  assert.match(prompt, /do not echo tool markers or raw widget payload in assistant text/i)
  assert.match(
    prompt,
    /Never print `\[widgetRenderer\]`, `Widget rendered \(inline\):`, or the widget HTML/i
  )
  assert.match(prompt, /# Soul \(from .*SOUL\.md\)/)
  assert.match(prompt, /custom persona/)
})

test('buildRuntimeSystemPrompt omits desktop-only UI guidance for IM surfaces', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'piagent-soul-im-'))
  const soulPath = path.join(tempDir, 'SOUL.md')
  writeFileSync(soulPath, '# Soul\n\n- remote persona', 'utf8')

  const prompt = buildRuntimeSystemPrompt('/tmp/workspace', 'thread-im', tempDir, 'im')

  assert.match(prompt, /Thread ID: thread-im/)
  assert.match(prompt, /discoverBuiltinToolsTool/)
  assert.match(prompt, /runtime preloads the active tool set/i)
  assert.match(prompt, /non-desktop transport/i)
  assert.match(prompt, /ask plainly in text and wait for the next inbound message/i)
  assert.doesNotMatch(prompt, /desktop chat UI renders the QR login card/i)
  assert.doesNotMatch(prompt, /use `questionTool` instead of plain text/i)
  assert.doesNotMatch(prompt, /secretRequestTool/i)
  assert.doesNotMatch(prompt, /Widget rendered \(inline\):/i)
})

test('buildRuntimeSystemPrompt requires explanations before bash and routine read tool calls', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'piagent-soul-tools-'))
  const soulPath = path.join(tempDir, 'SOUL.md')
  writeFileSync(soulPath, '# Soul\n\n- tool persona', 'utf8')

  const prompt = buildRuntimeSystemPrompt('/tmp/workspace', 'thread-tools', tempDir)

  assert.match(prompt, /Before a tool call/i)
  assert.match(prompt, /routine or obvious steps/i)
  assert.match(prompt, /discoverBuiltinToolsTool/i)
  assert.doesNotMatch(prompt, /Skip it for routine reads/i)
})

test('buildRuntimeSystemPrompt identifies temporary workspace directories', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'piagent-soul-temp-workspace-'))
  const soulPath = path.join(tempDir, 'SOUL.md')
  writeFileSync(soulPath, '# Soul\n\n- temp workspace persona', 'utf8')
  const workspacePath = path.join(os.tmpdir(), 'piagent-user-data', 'temp-workspaces', 'ws-260526-a1b2c3')

  const prompt = buildRuntimeSystemPrompt(workspacePath, 'thread-temp', tempDir)

  assert.match(prompt, new RegExp(`temporary workspace directory: ${workspacePath}`))
  assert.match(prompt, /scratch space for the current conversation/i)
  assert.match(prompt, /not necessarily an existing user project/i)
  assert.doesNotMatch(prompt, new RegExp(`project directory: ${workspacePath}`))
})

test('withTemporaryPromptAppend restores the original prompt after invocation', async () => {
  const session = {
    systemPrompt: 'base prompt',
    agent: {
      state: {
        systemPrompt: 'base prompt'
      }
    }
  }

  await withTemporaryPromptAppend(session, 'memory block', async () => {
    assert.match(session.agent.state.systemPrompt ?? '', /base prompt/)
    assert.match(session.agent.state.systemPrompt ?? '', /memory block/)
  })

  assert.equal(session.agent.state.systemPrompt, 'base prompt')
})
