import { app, ipcMain } from 'electron'
import type { AppStorageSummary } from '../../shared/app-storage.ts'
import { getAppStorageSummary } from '../app-storage/app-storage-summary.ts'

type AppStorageIpcMain = {
  handle: (
    channel: string,
    handler: (...args: unknown[]) => Promise<AppStorageSummary>
  ) => unknown
}

type AppStorageHandlerDependencies = {
  ipcMainLike?: AppStorageIpcMain
  getUserDataPath?: () => string
  getSummary?: (userDataPath: string) => Promise<AppStorageSummary>
}

export const setupAppStorageHandlers = (
  dependencies: AppStorageHandlerDependencies = {}
): void => {
  const ipcMainLike = dependencies.ipcMainLike ?? (ipcMain as unknown as AppStorageIpcMain)
  const getUserDataPath = dependencies.getUserDataPath ?? (() => app.getPath('userData'))
  const getSummary = dependencies.getSummary ?? getAppStorageSummary

  ipcMainLike.handle('app-storage:get-summary', async () => getSummary(getUserDataPath()))
}
