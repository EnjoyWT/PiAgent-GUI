import * as electron from 'electron'
import { getConfigDb } from '../db/config-db.ts'
import { TransportPluginConfigService } from './transport-plugin-config-service.ts'

let transportPluginConfigServiceSingleton: TransportPluginConfigService | null = null

const getSafeStorage = (): typeof electron.safeStorage | null =>
  (electron as { safeStorage?: typeof electron.safeStorage }).safeStorage ??
  (electron as { default?: { safeStorage?: typeof electron.safeStorage } }).default?.safeStorage ??
  null

export const getTransportPluginConfigService = (): TransportPluginConfigService => {
  if (transportPluginConfigServiceSingleton) return transportPluginConfigServiceSingleton
  const safeStorage = getSafeStorage()
  transportPluginConfigServiceSingleton = new TransportPluginConfigService(getConfigDb(), {
    secretCodec: safeStorage?.isEncryptionAvailable()
      ? {
          encrypt: (value: string) => safeStorage.encryptString(value),
          decrypt: (value: Buffer) => safeStorage.decryptString(value)
        }
      : undefined
  })
  return transportPluginConfigServiceSingleton
}
