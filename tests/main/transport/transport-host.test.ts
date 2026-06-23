import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TransportHost } from '../../../src/main/transport/transport-host.ts'

const noopHandler = () => undefined

test('transport host discovers external transport plugins', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-transport-host-'))
  const pluginRoot = path.join(tempRoot, 'transport-sample')
  const entryPath = path.join(pluginRoot, 'dist', 'index.mjs')

  mkdirSync(path.join(pluginRoot, '.piagent-plugin'), { recursive: true })
  mkdirSync(path.join(pluginRoot, 'dist'), { recursive: true })
  writeFileSync(
    path.join(pluginRoot, '.piagent-plugin', 'plugin.json'),
    JSON.stringify({
      id: 'sample-external-transport',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Sample External Transport',
      entry: './dist/index.mjs'
    }),
    'utf8'
  )
  writeFileSync(
    entryPath,
    `
      export const register = async () => ({
        metadata: {
          id: 'sample-external-transport',
          displayName: 'Sample External Transport',
          version: '0.1.0'
        },
        getCapabilities: () => ({
          canEditMessage: false,
          canStreamByEdit: false,
          canRenderButtons: false,
          canRenderRichCards: false,
          canReplyInThread: false,
          canUploadImage: false,
          canUploadFile: false,
          canCollectStructuredForm: false
        }),
        connect: async () => undefined,
        disconnect: async () => undefined,
        send: async () => ({ status: 'sent', externalMessageId: 'msg-1' }),
        onInbound: () => ${noopHandler.toString()}
      })
    `,
    'utf8'
  )

  try {
    const host = new TransportHost()
    await host.discoverExternal([tempRoot])
    await host.activateAll()

    const statuses = host.listStatuses()

    assert.equal(statuses.length, 1)
    assert.equal(statuses[0]?.pluginId, 'sample-external-transport')
    assert.equal(statuses[0]?.sourceKind, 'user')
    assert.equal(statuses[0]?.state, 'activated')
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
