import type { ChatContentBlock, ChatImageBlock } from '../../shared/chat-content.ts'
import {
  getChatImageAssetService,
  type ChatImageAssetService,
  type InlineChatImageData
} from '../chat-assets/chat-image-asset-service.ts'

export type RuntimeChatContentBlock = { type: 'text'; text: string } | InlineChatImageData

export const materializeImageBlockForRuntime = async (
  image: ChatImageBlock,
  service: ChatImageAssetService = getChatImageAssetService()
): Promise<InlineChatImageData> => await service.readAsBase64(image.assetId)

export const materializeContentBlocksForRuntime = async (
  blocks: ChatContentBlock[],
  service: ChatImageAssetService = getChatImageAssetService()
): Promise<RuntimeChatContentBlock[]> =>
  await Promise.all(
    blocks.map((block) =>
      block.type === 'image'
        ? materializeImageBlockForRuntime(block, service)
        : Promise.resolve({ type: 'text' as const, text: block.text })
    )
  )
