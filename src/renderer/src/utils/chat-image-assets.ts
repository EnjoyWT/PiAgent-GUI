import { LOCAL_HTTP_BASE_URL } from '../../../shared/local-http.ts'

export const getChatImageAssetUrl = (assetId: string): string =>
  `${LOCAL_HTTP_BASE_URL}/assets/chat-images/${encodeURIComponent(assetId)}`
