import { ipcMain } from 'electron'
import { cleanupLocalConversations } from '../local-conversation-cleanup/cleanup-service.ts'

export const setupLocalConversationCleanupHandlers = (): void => {
  ipcMain.handle('local-conversations:cleanup', (event) =>
    cleanupLocalConversations((progress) => event.sender.send('local-conversations:cleanup-progress', progress))
  )
}
