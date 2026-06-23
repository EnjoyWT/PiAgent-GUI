import { ipcMain } from 'electron'
import type {
  FetchProviderModelsInput,
  SetProviderModelEnabledInput,
  SetupProviderApiKeyInput,
  UpsertProviderConfigInput,
  ValidateProviderConfigInput
} from '../../shared/provider-config'
import { getProviderConfigService } from '../provider-config/provider-config-service'

export function setupProviderConfigHandlers(): void {
  const service = getProviderConfigService()

  ipcMain.handle('provider-config:list', () => service.listProviders())
  ipcMain.handle('provider-config:get-detail', (_, providerId: string) =>
    service.getProviderDetail(providerId)
  )
  ipcMain.handle('provider-config:upsert', (_, input: UpsertProviderConfigInput) =>
    service.upsertProvider(input)
  )
  ipcMain.handle('provider-config:validate', (_, input: ValidateProviderConfigInput) =>
    service.validate(input)
  )
  ipcMain.handle('provider-config:fetch-models', (_, input: FetchProviderModelsInput) =>
    service.fetchModels(input)
  )
  ipcMain.handle('provider-config:setup-api-key', (_, input: SetupProviderApiKeyInput) =>
    service.setupApiKey(input)
  )
  ipcMain.handle('provider-config:set-model-enabled', (_, input: SetProviderModelEnabledInput) =>
    service.setModelEnabled(input)
  )
  ipcMain.handle('provider-config:delete', (_, providerId: string) =>
    service.deleteProvider(providerId)
  )
}
