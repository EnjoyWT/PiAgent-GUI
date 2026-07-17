import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  WorkspaceSandbox,
  normalizeExternalSandboxGrant,
  normalizeWorkspaceSandboxPath,
  readProjectSandboxManifest
} from '../../../src/main/sandbox/workspace-sandbox.ts'

test('allows workspace paths and blocks external paths in sandbox mode', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'piagent-sandbox-'))
  const workspace = path.join(root, 'workspace')
  const external = path.join(root, 'external')
  mkdirSync(workspace)
  mkdirSync(external)
  writeFileSync(path.join(workspace, 'inside.txt'), 'ok')
  writeFileSync(path.join(external, 'outside.txt'), 'no')

  const sandbox = new WorkspaceSandbox({ workspacePath: workspace, mode: 'sandbox' })

  assert.equal(sandbox.decideFileAccess(path.join(workspace, 'inside.txt'), 'read').allowed, true)
  assert.equal(
    sandbox.decideFileAccess(path.join(workspace, '..', 'external', 'outside.txt'), 'read').allowed,
    false
  )
})

test('resolves symlinks before evaluating a workspace boundary', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'piagent-sandbox-'))
  const workspace = path.join(root, 'workspace')
  const external = path.join(root, 'external')
  mkdirSync(workspace)
  mkdirSync(external)
  writeFileSync(path.join(external, 'secret.txt'), 'no')
  symlinkSync(external, path.join(workspace, 'linked-external'))

  const sandbox = new WorkspaceSandbox({ workspacePath: workspace, mode: 'sandbox' })

  assert.equal(
    sandbox.decideFileAccess(path.join(workspace, 'linked-external', 'secret.txt'), 'read').allowed,
    false
  )
})

test('accepts read grants but requires a write grant for writes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'piagent-sandbox-'))
  const workspace = path.join(root, 'workspace')
  const external = path.join(root, 'external')
  mkdirSync(workspace)
  mkdirSync(external)

  const sandbox = new WorkspaceSandbox({
    workspacePath: workspace,
    mode: 'sandbox',
    grants: [{ path: external, access: 'read' }]
  })

  assert.equal(sandbox.decideFileAccess(path.join(external, 'source.ts'), 'read').allowed, true)
  assert.equal(sandbox.decideFileAccess(path.join(external, 'source.ts'), 'write').allowed, false)
})

test('keeps existing unrestricted behavior in full mode', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'piagent-sandbox-'))
  const workspace = path.join(root, 'workspace')
  const external = path.join(root, 'external')
  mkdirSync(workspace)
  mkdirSync(external)

  const sandbox = new WorkspaceSandbox({ workspacePath: workspace, mode: 'full' })

  assert.equal(sandbox.decideFileAccess(path.join(external, 'source.ts'), 'write').allowed, true)
})

test('normalizes external grants but refuses workspace paths and symlink aliases', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'piagent-sandbox-'))
  const workspace = path.join(root, 'workspace')
  const external = path.join(root, 'external')
  mkdirSync(workspace)
  mkdirSync(external)
  symlinkSync(workspace, path.join(root, 'workspace-alias'))

  assert.equal(
    normalizeExternalSandboxGrant(workspace, external),
    normalizeWorkspaceSandboxPath(external)
  )
  assert.throws(() => normalizeExternalSandboxGrant(workspace, workspace))
  assert.throws(() => normalizeExternalSandboxGrant(workspace, path.join(root, 'workspace-alias')))
})

test('reads project sandbox manifest (.pi/piagent-sandbox.json)', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'piagent-sandbox-'))
  const workspace = path.join(root, 'workspace')
  mkdirSync(workspace)
  mkdirSync(path.join(workspace, '.pi'))

  // Case 1: no file
  assert.equal(readProjectSandboxManifest(workspace), null)

  // Case 2: valid JSON
  const manifestData = {
    requestedGrants: [
      { path: '../external-dir', access: 'read' },
      { path: '/tmp/some-path', access: 'write' },
      { path: '.', access: 'write' }
    ]
  }
  writeFileSync(path.join(workspace, '.pi', 'piagent-sandbox.json'), JSON.stringify(manifestData))

  const manifest = readProjectSandboxManifest(workspace)
  assert.ok(manifest)
  assert.equal(manifest.requestedGrants.length, 2)
  assert.equal(manifest.requestedGrants[0].path, '../external-dir')
  assert.equal(manifest.requestedGrants[0].access, 'read')
  assert.equal(
    manifest.requestedGrants[0].resolvedPath,
    normalizeWorkspaceSandboxPath(path.resolve(workspace, '../external-dir'))
  )
  assert.equal(manifest.requestedGrants[1].path, '/tmp/some-path')
  assert.equal(manifest.requestedGrants[1].access, 'write')
  assert.equal(
    manifest.requestedGrants[1].resolvedPath,
    normalizeWorkspaceSandboxPath(path.resolve(workspace, '/tmp/some-path'))
  )
})
