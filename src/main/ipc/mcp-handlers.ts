import { ipcMain } from 'electron'
import { listMcpMarketplace } from '../mcp/mcp-marketplace-service'

export function setupMcpHandlers(): void {
  ipcMain.handle(
    'mcp:marketplace:list',
    async (
      _,
      input?: {
        query?: string
        page?: number
        limit?: number
        cursor?: string
      }
    ) => await listMcpMarketplace(input)
  )
}
