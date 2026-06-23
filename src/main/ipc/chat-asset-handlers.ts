import { ipcMain } from 'electron'
import type { ChatImageBlock } from '@shared/chat-content'
import { getChatImageAssetService } from '../chat-assets/chat-image-asset-service.ts'

export type PersistChatImageAssetIpcInput = {
  mimeType: string
  name?: string
  filePath?: string
  data?: ArrayBuffer | Uint8Array
}

export function setupChatAssetHandlers(): void {
  ipcMain.handle(
    'chat-assets:images:persist',
    async (_, inputs: PersistChatImageAssetIpcInput[]): Promise<ChatImageBlock[]> => {
      const service = getChatImageAssetService()
      return await Promise.all(
        (inputs ?? []).map((input) =>
          service.persistImage({
            mimeType: input.mimeType,
            name: input.name,
            filePath: input.filePath,
            data: input.data
          })
        )
      )
    }
  )
}
