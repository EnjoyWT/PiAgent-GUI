import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { generateId } from '../../shared/id.ts'
import type { ChatImageBlock } from '../../shared/chat-content.ts'

type BinaryImageData = ArrayBuffer | ArrayBufferView | Buffer

export type PersistChatImageAssetInput = {
  mimeType: string
  name?: string
  filePath?: string
  data?: BinaryImageData
}

export type InlineChatImageData = {
  type: 'image'
  data: string
  mimeType: string
}

export type ChatImageAssetServiceOptions = {
  rootDir?: string
  maxBytes?: number
}

const IMAGE_EXT_BY_MIME_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

const MIME_TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const ASSET_ID_PATTERN = /^img_[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/
const require = createRequire(import.meta.url)

type ElectronAppLike = {
  getPath(name: 'userData'): string
}

const getElectronApp = (): ElectronAppLike => {
  const electron = require('electron') as {
    app?: ElectronAppLike
    default?: { app?: ElectronAppLike }
  }
  const electronApp = electron.app ?? electron.default?.app
  if (!electronApp) throw new Error('Electron app is not available')
  return electronApp
}

export const getDefaultChatImageAssetRoot = (): string =>
  path.join(getElectronApp().getPath('userData'), 'chat-assets')

export const isValidChatImageAssetId = (assetId: string): boolean => ASSET_ID_PATTERN.test(assetId)

const getExtForMimeType = (mimeType: string): string => {
  const ext = IMAGE_EXT_BY_MIME_TYPE[mimeType.trim().toLowerCase()]
  if (!ext) throw new Error(`Unsupported chat image mime type: ${mimeType}`)
  return ext
}

const getMimeTypeForAssetId = (assetId: string): string => {
  const ext = path.extname(assetId).slice(1).toLowerCase()
  const mimeType = MIME_TYPE_BY_EXT[ext]
  if (!mimeType) throw new Error(`Unsupported chat image asset extension: ${assetId}`)
  return mimeType
}

const toBuffer = (data: BinaryImageData): Buffer => {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

export class ChatImageAssetService {
  private readonly rootDir: string
  private readonly imageDir: string
  private readonly maxBytes: number

  constructor(options: ChatImageAssetServiceOptions = {}) {
    this.rootDir = options.rootDir ?? getDefaultChatImageAssetRoot()
    this.imageDir = path.join(this.rootDir, 'images')
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  }

  async persistImage(input: PersistChatImageAssetInput): Promise<ChatImageBlock> {
    const mimeType = input.mimeType.trim().toLowerCase()
    const ext = getExtForMimeType(mimeType)
    const assetId = `img_${generateId()}.${ext}`
    const targetPath = this.resolvePath(assetId)

    await mkdir(this.imageDir, { recursive: true })

    let sizeBytes = 0
    if (input.filePath) {
      const source = await stat(input.filePath)
      sizeBytes = source.size
      this.assertSizeAllowed(sizeBytes)
      await copyFile(input.filePath, targetPath)
    } else if (input.data) {
      const buffer = toBuffer(input.data)
      sizeBytes = buffer.byteLength
      this.assertSizeAllowed(sizeBytes)
      await writeFile(targetPath, buffer)
    } else {
      throw new Error('Chat image asset requires filePath or data')
    }

    return {
      type: 'image',
      assetId,
      mimeType,
      name: input.name?.trim() || undefined,
      sizeBytes
    }
  }

  resolvePath(assetId: string): string {
    const normalized = assetId.trim()
    if (!isValidChatImageAssetId(normalized)) {
      throw new Error(`Invalid chat image asset id: ${assetId}`)
    }

    const resolved = path.resolve(this.imageDir, normalized)
    const root = path.resolve(this.imageDir)
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Invalid chat image asset path: ${assetId}`)
    }
    return resolved
  }

  async readAsBase64(assetId: string): Promise<InlineChatImageData> {
    const filePath = this.resolvePath(assetId)
    const bytes = await readFile(filePath)
    return {
      type: 'image',
      data: bytes.toString('base64'),
      mimeType: getMimeTypeForAssetId(assetId)
    }
  }

  getMimeType(assetId: string): string {
    this.resolvePath(assetId)
    return getMimeTypeForAssetId(assetId)
  }

  async deleteAsset(assetId: string): Promise<void> {
    try {
      await unlink(this.resolvePath(assetId))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private assertSizeAllowed(sizeBytes: number): void {
    if (sizeBytes <= 0) throw new Error('Chat image asset is empty')
    if (sizeBytes > this.maxBytes) {
      throw new Error(`Chat image asset exceeds ${this.maxBytes} bytes`)
    }
  }
}

let sharedChatImageAssetService: ChatImageAssetService | null = null

export const getChatImageAssetService = (): ChatImageAssetService => {
  if (!sharedChatImageAssetService) {
    sharedChatImageAssetService = new ChatImageAssetService()
  }
  return sharedChatImageAssetService
}
