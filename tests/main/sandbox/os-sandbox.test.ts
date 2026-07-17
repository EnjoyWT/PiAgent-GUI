import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createSandboxedBashOperations } from '../../../src/main/sandbox/os-sandbox.ts'

const supportedPlatforms = new Set(['darwin', 'linux', 'win32'])

test(
  'runs commands in the workspace through the OS sandbox',
  { skip: supportedPlatforms.has(process.platform) ? undefined : 'unsupported platform' },
  async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'piagent-sandbox-'))
    const externalPath = path.join(os.tmpdir(), `piagent-sandbox-external-${Date.now()}.txt`)
    await writeFile(path.join(workspacePath, 'inside.txt'), 'inside')
    await writeFile(externalPath, 'outside')
    try {
      const operations = createSandboxedBashOperations(workspacePath, async () => [])
      const output: Buffer[] = []
      const result = await operations.exec('cat inside.txt', workspacePath, {
        onData: (chunk) => output.push(chunk)
      })
      assert.equal(result.exitCode, 0)
      assert.equal(Buffer.concat(output).toString(), 'inside')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
      await rm(externalPath, { force: true })
    }
  }
)
