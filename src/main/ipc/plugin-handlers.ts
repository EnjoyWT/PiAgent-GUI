import { BrowserWindow, ipcMain } from 'electron'
import type {
  SaveTransportPluginAccountInput,
  StartTransportPluginAccountSetupInput,
  SetTransportPluginEnabledInput,
  TransportPluginAccountSetupEvent,
  TestTransportPluginAccountInput
} from '../../shared/transport-plugins.ts'
import { getEmbeddedGatewayService } from '../transport/embedded-gateway.ts'

let accountSetupEventBroadcastAttached = false
let accountSetupEventBroadcastPromise: Promise<void> | null = null

export const getImTransportIpcChannelAliases = (): Array<[legacy: string, current: string]> => [
  ['plugins:list-installed', 'imTransports:listInstalled'],
  ['plugins:get-manifest', 'imTransports:getManifest'],
  ['plugins:set-enabled', 'imTransports:setEnabled'],
  ['plugins:list-transport-accounts', 'imTransports:listAccounts'],
  ['plugins:get-transport-account', 'imTransports:getAccount'],
  ['plugins:save-transport-account', 'imTransports:saveAccount'],
  ['plugins:test-transport-account', 'imTransports:testAccount'],
  ['plugins:list-transport-setup-methods', 'imTransports:listSetupMethods'],
  ['plugins:start-transport-account-setup', 'imTransports:startAccountSetup'],
  ['plugins:cancel-transport-account-setup', 'imTransports:cancelAccountSetup'],
  ['plugins:delete-transport-account', 'imTransports:deleteAccount']
]

const summarizeAccountSetupEventForDebug = (
  event: TransportPluginAccountSetupEvent
): Record<string, unknown> => ({
  type: event.type,
  pluginId: event.pluginId ?? null,
  accountId: event.accountId ?? null,
  methodId: event.methodId ?? null,
  sessionId: event.sessionId,
  state: 'state' in event ? event.state : null,
  expiresAt: 'expiresAt' in event ? event.expiresAt : null,
  reason: 'reason' in event ? event.reason : null,
  retryable: 'retryable' in event ? event.retryable : null,
  error: 'error' in event ? event.error : null
})

const ensureAccountSetupEventBroadcast = async (): Promise<void> => {
  if (accountSetupEventBroadcastAttached) return
  if (accountSetupEventBroadcastPromise) return accountSetupEventBroadcastPromise
  accountSetupEventBroadcastPromise = (async () => {
    const gateway = await getEmbeddedGatewayService()
    gateway.onTransportAccountSetupEvent((setupEvent) => {
      console.info(
        '[transport-account-setup:event:broadcast]',
        summarizeAccountSetupEventForDebug(setupEvent)
      )
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('plugins:transport-account-setup-event', setupEvent)
          window.webContents.send('imTransports:accountSetupEvent', setupEvent)
        }
      }
    })
    accountSetupEventBroadcastAttached = true
    accountSetupEventBroadcastPromise = null
  })().catch((error) => {
    accountSetupEventBroadcastPromise = null
    throw error
  })
  return accountSetupEventBroadcastPromise
}

export function setupPluginHandlers(): void {
  void ensureAccountSetupEventBroadcast()

  const handle = (
    legacyChannel: string,
    currentChannel: string,
    listener: Parameters<typeof ipcMain.handle>[1]
  ): void => {
    ipcMain.handle(legacyChannel, listener)
    ipcMain.handle(currentChannel, listener)
  }

  handle('plugins:list-installed', 'imTransports:listInstalled', async () =>
    (await getEmbeddedGatewayService()).listInstalledTransportPlugins()
  )

  handle('plugins:get-manifest', 'imTransports:getManifest', async (_, pluginId: string) =>
    (await getEmbeddedGatewayService()).getTransportPluginManifest(pluginId)
  )

  handle(
    'plugins:set-enabled',
    'imTransports:setEnabled',
    async (_, input: SetTransportPluginEnabledInput) =>
      (await getEmbeddedGatewayService()).setTransportPluginEnabled(input)
  )

  handle(
    'plugins:list-transport-accounts',
    'imTransports:listAccounts',
    async (_, pluginId: string) =>
      (await getEmbeddedGatewayService()).listTransportAccounts(pluginId)
  )

  handle(
    'plugins:get-transport-account',
    'imTransports:getAccount',
    async (_, pluginId: string, accountId: string) =>
      (await getEmbeddedGatewayService()).getTransportAccount(pluginId, accountId)
  )

  handle(
    'plugins:save-transport-account',
    'imTransports:saveAccount',
    async (_, input: SaveTransportPluginAccountInput) =>
      (await getEmbeddedGatewayService()).saveTransportAccount(input)
  )

  handle(
    'plugins:test-transport-account',
    'imTransports:testAccount',
    async (_, input: TestTransportPluginAccountInput) =>
      (await getEmbeddedGatewayService()).testTransportAccount(input)
  )

  handle(
    'plugins:list-transport-setup-methods',
    'imTransports:listSetupMethods',
    async (_, pluginId: string) =>
      (await getEmbeddedGatewayService()).listTransportAccountSetupMethods(pluginId)
  )

  handle(
    'plugins:start-transport-account-setup',
    'imTransports:startAccountSetup',
    async (_, input: StartTransportPluginAccountSetupInput) => {
      await ensureAccountSetupEventBroadcast()
      return (await getEmbeddedGatewayService()).startTransportAccountSetup(input)
    }
  )

  handle(
    'plugins:cancel-transport-account-setup',
    'imTransports:cancelAccountSetup',
    async (_, pluginId: string, sessionId: string) =>
      (await getEmbeddedGatewayService()).cancelTransportAccountSetup(pluginId, sessionId)
  )

  handle(
    'plugins:delete-transport-account',
    'imTransports:deleteAccount',
    async (_, pluginId: string, accountId: string) =>
      (await getEmbeddedGatewayService()).deleteTransportAccount(pluginId, accountId)
  )
}
