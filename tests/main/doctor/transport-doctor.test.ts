import test from 'node:test'
import assert from 'node:assert/strict'
import { TransportDoctor } from '../../../src/main/doctor/transport-doctor.ts'
import { desktopChatTransportModule } from '../../../src/main/transport/builtin/desktop-chat-transport.ts'
import { TransportHost } from '../../../src/main/transport/transport-host.ts'
import type { BuiltinPluginModule } from '../../../src/main/plugin-system/plugin-types.ts'
import type {
  TransportConnectError,
  TransportPlugin,
  TransportRegisterContext
} from '../../../src/main/transport/transport-contract.ts'

const createSampleTransportModule = (
  id = 'sample-transport'
): BuiltinPluginModule<TransportPlugin, TransportRegisterContext> => ({
  manifest: {
    id,
    kind: 'transport',
    apiVersion: '1',
    version: '0.1.0',
    displayName: 'Sample Transport'
  },
  register: () => ({
    metadata: {
      id,
      displayName: 'Sample Transport',
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
    connect: async (accountId: string) => {
      if (accountId === 'retrying') throw new Error('connect failed')
      if (accountId === 'fatal') {
        throw new (class extends Error {
          retryable = false
          code = 'invalid_credentials'
          constructor() {
            super('invalid credentials')
            this.name = 'TransportConnectError'
          }
        })() as TransportConnectError
      }
    },
    disconnect: async () => undefined,
    send: async () => ({ status: 'sent', externalMessageId: 'msg-1' }),
    onInbound: () => () => undefined
  })
})

test('transport host tracks Hermes-style per-account connection states', async () => {
  const host = new TransportHost()
  host.discoverBuiltin(createSampleTransportModule())
  await host.activateAll()

  await host.connect('sample-transport', 'primary')
  await assert.rejects(() => host.connect('sample-transport', 'retrying'), /connect failed/)
  await assert.rejects(() => host.connect('sample-transport', 'fatal'), /invalid credentials/)

  const afterConnect = host.getAccountStatuses('sample-transport')
  assert.equal(afterConnect.length, 3)
  assert.deepEqual(
    afterConnect.find((status) => status.accountId === 'primary')?.state,
    'connected'
  )
  assert.deepEqual(
    afterConnect.find((status) => status.accountId === 'retrying')?.state,
    'retrying'
  )
  assert.match(
    String(afterConnect.find((status) => status.accountId === 'retrying')?.error ?? ''),
    /connect failed/
  )
  assert.deepEqual(afterConnect.find((status) => status.accountId === 'fatal')?.state, 'fatal')
  assert.equal(
    afterConnect.find((status) => status.accountId === 'fatal')?.errorCode,
    'invalid_credentials'
  )

  await host.disconnect('sample-transport', 'primary')

  const afterDisconnect = host.getAccountStatuses('sample-transport')
  assert.equal(
    afterDisconnect.find((status) => status.accountId === 'primary')?.state,
    'disconnected'
  )
  assert.equal(afterDisconnect.find((status) => status.accountId === 'retrying')?.state, 'retrying')
  assert.equal(afterDisconnect.find((status) => status.accountId === 'fatal')?.state, 'fatal')
})

test('transport doctor aggregates plugin and account state', async () => {
  const host = new TransportHost()
  host.discoverBuiltin(createSampleTransportModule())
  await host.activateAll()
  await host.connect('sample-transport', 'primary')
  await assert.rejects(() => host.connect('sample-transport', 'retrying'), /connect failed/)

  const doctor = new TransportDoctor(host)
  const component = await doctor.getComponentStatus('sample-transport')
  const summary = await doctor.getSummary()

  assert.equal(component.domain, 'transport')
  assert.equal(component.componentId, 'sample-transport')
  assert.equal(component.status, 'degraded')
  assert.equal(component.stage, 'connected')
  assert.match(component.summary, /Partially available/)
  assert.equal(
    Array.isArray(
      (component.metadata as { accountStatuses?: unknown[] } | undefined)?.accountStatuses
    ),
    true
  )

  assert.equal(summary.domain, 'transport')
  assert.equal(summary.status, 'degraded')
  assert.equal(summary.componentCount, 1)
  assert.equal(summary.degradedCount, 1)
  assert.equal(summary.healthyCount, 0)
})

test('IM transport doctor excludes the built-in desktop transport', async () => {
  const host = new TransportHost()
  host.discoverBuiltin(desktopChatTransportModule)
  host.discoverBuiltin(createSampleTransportModule('feishu'))
  await host.activateAll()
  await host.connect('desktop-chat', 'desktop')
  await host.connect('feishu', 'primary')

  const allDoctor = new TransportDoctor(host)
  const imDoctor = new TransportDoctor(host, {
    domainId: 'im-transport',
    displayName: 'IM Transport',
    sourceKind: 'im'
  })

  const allComponents = await allDoctor.listComponents()
  const imComponents = await imDoctor.listComponents()
  const imSummary = await imDoctor.getSummary()

  assert.deepEqual(allComponents.map((component) => component.componentId).sort(), [
    'desktop-chat',
    'feishu'
  ])
  assert.deepEqual(
    imComponents.map((component) => component.componentId),
    ['feishu']
  )
  assert.equal(imSummary.domain, 'im-transport')
  assert.equal(imSummary.componentCount, 1)
  await assert.rejects(
    () => imDoctor.getComponentStatus('desktop-chat'),
    /Transport component not found/
  )
})

test('transport host marks accounts as connecting while connect is in flight', async () => {
  let releaseConnect!: () => void
  const connectStarted = new Promise<void>((resolve) => {
    releaseConnect = resolve
  })

  const host = new TransportHost()
  host.discoverBuiltin({
    manifest: {
      id: 'slow-transport',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Slow Transport'
    },
    register: () => ({
      metadata: {
        id: 'slow-transport',
        displayName: 'Slow Transport',
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
      connect: async () => {
        await connectStarted
      },
      disconnect: async () => undefined,
      send: async () => ({ status: 'sent', externalMessageId: 'msg-1' }),
      onInbound: () => () => undefined
    })
  })
  await host.activateAll()

  const pendingConnect = host.connect('slow-transport', 'primary')
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(host.getAccountStatuses('slow-transport')[0]?.state, 'connecting')

  releaseConnect()
  await pendingConnect

  assert.equal(host.getAccountStatuses('slow-transport')[0]?.state, 'connected')
})
