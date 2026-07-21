import { ipcMain } from 'electron'
import { getAppUpdaterService } from '../updater/app-updater-service.ts'

export function setupAppUpdateHandlers(): void {
  const service = getAppUpdaterService()
  service.init()

  ipcMain.handle('app-update:get-status', () => service.getStatus())
  ipcMain.handle('app-update:check', () => service.checkForUpdates())
  ipcMain.handle('app-update:download', () => service.downloadUpdate())
  ipcMain.handle('app-update:quit-and-install', () => service.quitAndInstall())
  ipcMain.handle('app-update:open-release-page', () => service.openReleasePage())
}
