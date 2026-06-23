import { ipcMain } from 'electron'
import type {
  InstallAgentPluginInput,
  SetAgentPluginComponentEnabledInput,
  SetAgentPluginEnabledInput
} from '../../shared/agent-plugins.ts'
import { getAgentPluginManagementService } from '../agent-plugins/agent-plugin-management-service-singleton.ts'
import { startAgentPluginBackgroundExtensions } from '../agent-plugins/agent-plugin-background-service.ts'

export const shouldStartAgentPluginBackgroundExtensions = (
  input: SetAgentPluginEnabledInput | SetAgentPluginComponentEnabledInput
): boolean => {
  if (!input.enabled) return false
  return !('componentType' in input) || input.componentType === 'extensions'
}

const startBackgroundExtensionsAfterEnable = (
  input: SetAgentPluginEnabledInput | SetAgentPluginComponentEnabledInput
): void => {
  if (!shouldStartAgentPluginBackgroundExtensions(input)) return
  void startAgentPluginBackgroundExtensions().catch((error) => {
    console.error('Start agent plugin background extensions failed', error)
  })
}

export function setupAgentPluginHandlers(): void {
  ipcMain.handle('agentPlugins:listInstalled', () =>
    getAgentPluginManagementService().listInstalled()
  )

  ipcMain.handle('agentPlugins:getManifest', (_, pluginId: string) =>
    getAgentPluginManagementService().getManifest(pluginId)
  )

  ipcMain.handle('agentPlugins:setEnabled', (_, input: SetAgentPluginEnabledInput) => {
    const result = getAgentPluginManagementService().setEnabled(input)
    startBackgroundExtensionsAfterEnable(input)
    return result
  })

  ipcMain.handle(
    'agentPlugins:setComponentEnabled',
    (_, input: SetAgentPluginComponentEnabledInput) => {
      const result = getAgentPluginManagementService().setComponentEnabled(input)
      startBackgroundExtensionsAfterEnable(input)
      return result
    }
  )

  ipcMain.handle('agentPlugins:install', (_, input: InstallAgentPluginInput) =>
    getAgentPluginManagementService().install(input)
  )

  ipcMain.handle('agentPlugins:remove', (_, pluginId: string) =>
    getAgentPluginManagementService().remove(pluginId)
  )
}
