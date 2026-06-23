import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolve(repoRoot, 'tests/main/runtime-host/electron-stub.mjs')).href
      }
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.ts')) {
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

const { McpRuntimeManager } = await import('../../../src/main/mcp/mcp-runtime-manager.ts')

test('MCP runtime signature includes plugin-owned extra server configs', async () => {
  const manager = new McpRuntimeManager()

  const signature = await manager.getWorkspaceSignature('/tmp/piagent-workspace', [
    {
      id: 'plugin__agent_pack__github',
      name: 'Agent Pack / github',
      description: null,
      transport_type: 'stdio',
      command: 'node',
      args: JSON.stringify(['server.js']),
      env: null,
      url: null,
      headers: null,
      enabled: 1,
      created_at: ''
    }
  ])

  assert.deepEqual(JSON.parse(signature), ['plugin__agent_pack__github'])
})
