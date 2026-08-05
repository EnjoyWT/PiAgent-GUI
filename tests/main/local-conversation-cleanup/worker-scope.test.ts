import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearLocalConversationData } from '../../../src/main/local-conversation-cleanup/worker-entry.ts'

test('clears only desktop-chat conversations', () => {
  const statements: string[] = []
  const db = {
    prepare: (sql: string) => {
      statements.push(sql)
      return { run: () => undefined, all: () => [] }
    },
    exec: (sql: string) => statements.push(sql)
  } as any
  clearLocalConversationData(db, db)
  assert.equal(statements.some((sql) => sql.includes("transport_id = 'desktop-chat'")), true)
  assert.equal(statements.some((sql) => sql.includes('scheduled_tasks')), false)
})

test('removes the application temporary-workspaces root during cleanup', () => {
  const source = readFileSync('src/main/local-conversation-cleanup/worker-entry.ts', 'utf8')

  assert.match(source, /tempWorkspacesRootPath/)
  assert.match(source, /clearTemporaryWorkspaces\(input\.tempWorkspacesRootPath\)/)
})

test('removes temporary workspaces without touching sibling directories', async () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'piagent-cleanup-'))
  const tempWorkspacesRootPath = join(testRoot, 'temp-workspaces')
  const temporaryWorkspacePath = join(tempWorkspacesRootPath, 'ws-260805-abcdef')
  const siblingProjectPath = join(testRoot, 'project')
  mkdirSync(temporaryWorkspacePath, { recursive: true })
  mkdirSync(siblingProjectPath)
  writeFileSync(join(temporaryWorkspacePath, 'scratch.txt'), 'temporary')
  writeFileSync(join(siblingProjectPath, 'keep.txt'), 'project')

  try {
    const worker = await import('../../../src/main/local-conversation-cleanup/worker-entry.ts')
    assert.equal(typeof worker.clearTemporaryWorkspaces, 'function')
    worker.clearTemporaryWorkspaces(tempWorkspacesRootPath)
    assert.equal(existsSync(tempWorkspacesRootPath), false)
    assert.equal(existsSync(siblingProjectPath), true)
  } finally {
    rmSync(testRoot, { recursive: true, force: true })
  }
})
