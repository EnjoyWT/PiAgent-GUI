import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createPiAgentShellCommandPrefix,
  resolvePiAgentCliScriptPath,
  toBashPath
} from '../../../src/main/cli/cli-bin-path.ts'

const createTempCliRoot = (): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'piagent-cli-bin-'))
  const binDir = path.join(root, 'resources', 'bin')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(path.join(binDir, 'piagent'), '#!/usr/bin/env node\n', 'utf8')
  return root
}

test('resolvePiAgentCliScriptPath finds the repository resources bin', () => {
  const root = createTempCliRoot()

  assert.equal(
    resolvePiAgentCliScriptPath({
      cwd: root,
      dirname: path.join(root, 'out', 'main')
    }),
    path.join(root, 'resources', 'bin', 'piagent')
  )
})

test('createPiAgentShellCommandPrefix injects the endpoint, function, and PATH', () => {
  const root = createTempCliRoot()
  const prefix = createPiAgentShellCommandPrefix({
    cwd: root,
    dirname: path.join(root, 'out', 'main'),
    endpoint: 'http://127.0.0.1:5566/',
    nodeExecutable: '/Applications/PiAgent.app/Contents/MacOS/PiAgent',
    platform: 'darwin'
  })

  assert.match(prefix, /export PIAGENT_ENDPOINT='http:\/\/127\.0\.0\.1:5566'/)
  assert.match(prefix, /piagent\(\) \{ ELECTRON_RUN_AS_NODE=1 /)
  assert.match(prefix, /"\$@"; \}/)
  assert.match(prefix, new RegExp(`export PATH='${path.join(root, 'resources', 'bin')}':\\$PATH`))
  assert.match(prefix, /hash -r$/)
})

test('toBashPath converts Windows drive paths for bash prefixes', () => {
  assert.equal(
    toBashPath('C:\\Users\\sh\\PiAgent\\resources\\bin', 'win32'),
    '/c/Users/you/PiAgent/resources/bin'
  )
})
