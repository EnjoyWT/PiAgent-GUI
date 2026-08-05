import { BrowserWindow, ipcMain } from 'electron'
import { cleanupLocalConversations } from '../local-conversation-cleanup/cleanup-service.ts'

export const setupLocalConversationCleanupHandlers = (): void => {
  ipcMain.handle('local-conversations:cleanup', async (event) => {
    const result = await cleanupLocalConversations((progress) =>
      event.sender.send('local-conversations:cleanup-progress', progress)
    )
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('local-conversations:cleared')
    }
    return result
  })
}
