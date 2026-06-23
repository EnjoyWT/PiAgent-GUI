import { ipcMain } from 'electron'
import { openWebFetchBrowser } from '../webfetch/webfetch-browser-window.ts'

export const setupWebFetchHandlers = (): void => {
  ipcMain.handle('webfetch:open-browser', (_event, url?: string | null) => {
    openWebFetchBrowser(url)
    return { success: true as const }
  })
}
