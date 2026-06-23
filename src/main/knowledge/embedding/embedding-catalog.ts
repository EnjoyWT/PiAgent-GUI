import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import * as electron from 'electron'

export interface KnowledgeEmbeddingModelOption {
  key: string
  label: string
  providerName: string
  description: string
  sourceType: 'local' | 'remote'
  approximateSizeMb: number | null
  dimensions: number | null
  languageHint: string | null
  license: string | null
  publicResourceUrl: string | null
  downloaded: boolean
  cacheDir: string | null
}

type CatalogSeed = Omit<KnowledgeEmbeddingModelOption, 'downloaded' | 'cacheDir'> & {
  /** HuggingFace repo that actually contains Transformers.js ONNX artifacts. */
  downloadRepo?: string
}

const KNOWN_EMBEDDING_MODELS: CatalogSeed[] = [
  {
    key: 'BAAI/bge-small-zh-v1.5',
    label: 'BGE Small ZH v1.5',
    providerName: 'BAAI',
    description: 'Chinese and English local embedding model with ONNX artifacts',
    sourceType: 'local',
    approximateSizeMb: 90,
    dimensions: 384,
    languageHint: 'Chinese/English',
    license: 'mit',
    publicResourceUrl: 'https://huggingface.co/BAAI/bge-small-zh-v1.5',
    downloadRepo: 'Xenova/bge-small-zh-v1.5'
  },
  {
    key: 'BAAI/bge-small-en-v1.5',
    label: 'BGE Small EN v1.5',
    providerName: 'BAAI',
    description: 'English local embedding model with ONNX artifacts',
    sourceType: 'local',
    approximateSizeMb: 33,
    dimensions: 384,
    languageHint: 'English',
    license: 'mit',
    publicResourceUrl: 'https://huggingface.co/BAAI/bge-small-en-v1.5',
    downloadRepo: 'Xenova/bge-small-en-v1.5'
  }
]

const sanitizeModelKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '__')
    .replace(/^_+|_+$/g, '')

const hasVisibleFiles = (dir: string): boolean => {
  if (!existsSync(dir)) return false
  const hasConfig = existsSync(path.join(dir, 'config.json'))
  const hasTokenizer =
    existsSync(path.join(dir, 'tokenizer.json')) ||
    existsSync(path.join(dir, 'tokenizer_config.json'))
  const hasOnnx =
    existsSync(path.join(dir, 'onnx', 'model.onnx')) ||
    existsSync(path.join(dir, 'onnx', 'model_quantized.onnx')) ||
    existsSync(path.join(dir, 'model_quantized.onnx')) ||
    existsSync(path.join(dir, 'model.onnx'))

  return hasConfig && hasTokenizer && hasOnnx
}

export const getKnowledgeEmbeddingModelCacheRoot = (): string => {
  const app = electron.app || (electron as any).default?.app
  const baseDir = app?.getPath ? app.getPath('userData') : process.cwd()
  return path.join(baseDir, 'models', 'knowledge-embeddings')
}

export const getKnowledgeEmbeddingModelCacheDir = (key: string): string | null => {
  const model = KNOWN_EMBEDDING_MODELS.find((item) => item.key === key)
  if (!model || model.sourceType !== 'local') return null
  return path.join(getKnowledgeEmbeddingModelCacheRoot(), sanitizeModelKey(key))
}

export const ensureKnowledgeEmbeddingModelCacheDir = (key: string): string | null => {
  const cacheDir = getKnowledgeEmbeddingModelCacheDir(key)
  if (!cacheDir) return null
  mkdirSync(cacheDir, { recursive: true })
  return cacheDir
}

export const listKnownKnowledgeEmbeddingModels = (): KnowledgeEmbeddingModelOption[] =>
  KNOWN_EMBEDDING_MODELS.map((item) => {
    const cacheDir = item.sourceType === 'local' ? getKnowledgeEmbeddingModelCacheDir(item.key) : null
    return {
      ...item,
      downloaded: cacheDir ? hasVisibleFiles(cacheDir) : false,
      cacheDir
    }
  })

export const getKnownKnowledgeEmbeddingModel = (key: string): KnowledgeEmbeddingModelOption | null =>
  listKnownKnowledgeEmbeddingModels().find((item) => item.key === key) ?? null

export type DownloadProgressEvent = {
  key: string
  file: string
  downloadedBytes: number
  totalBytes: number | null
  fileIndex: number
  fileCount: number
}

export const downloadLocalKnowledgeEmbeddingModel = async (
  key: string,
  onProgress?: (event: DownloadProgressEvent) => void
): Promise<{ success: boolean; error?: string }> => {
  try {
    const model = KNOWN_EMBEDDING_MODELS.find((item) => item.key === key)
    if (!model || model.sourceType !== 'local') {
      return { success: false, error: '模型不存在或不是本地模型' }
    }

    const cacheDir = ensureKnowledgeEmbeddingModelCacheDir(key)
    if (!cacheDir) {
      return { success: false, error: '无法创建模型缓存目录' }
    }

    const fs = await import('node:fs')
    const https = await import('node:https')
    const filesToDownload = [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'onnx/model.onnx',
      'onnx/model_quantized.onnx'
    ]

    const fetchWithRedirects = (
      url: string,
      dest: string,
      fileIndex: number,
      fileCount: number,
      fileName: string,
      redirects = 5
    ): Promise<boolean> =>
      new Promise((resolve, reject) => {
        if (redirects === 0) {
          reject(new Error('Too many redirects'))
          return
        }

        fs.mkdirSync(path.dirname(dest), { recursive: true })
        https
          .get(url, (response) => {
            if (
              response.statusCode &&
              response.statusCode >= 300 &&
              response.statusCode < 400 &&
              response.headers.location
            ) {
              const redirectUrl = new URL(response.headers.location, url).href
              fetchWithRedirects(redirectUrl, dest, fileIndex, fileCount, fileName, redirects - 1)
                .then(resolve)
                .catch(reject)
            } else if (response.statusCode === 200) {
              const totalBytes = parseInt(String(response.headers['content-length'] || '0'), 10) || null
              let downloadedBytes = 0
              const fileStream = fs.createWriteStream(dest)
              response.on('data', (chunk: Buffer) => {
                downloadedBytes += chunk.length
                onProgress?.({ key, file: fileName, downloadedBytes, totalBytes, fileIndex, fileCount })
              })
              response.pipe(fileStream)
              fileStream.on('finish', () => {
                fileStream.close()
                resolve(true)
              })
              fileStream.on('error', (err) => {
                fs.unlink(dest, () => {})
                reject(err)
              })
            } else if (response.statusCode === 404) {
              resolve(false)
            } else {
              reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage} (${url})`))
            }
          })
          .on('error', reject)
      })

    const baseUrl = `https://huggingface.co/${model.downloadRepo || model.key}/resolve/main`
    let downloadedCount = 0
    for (let i = 0; i < filesToDownload.length; i++) {
      const file = filesToDownload[i]
      onProgress?.({ key, file, downloadedBytes: 0, totalBytes: null, fileIndex: i, fileCount: filesToDownload.length })
      try {
        if (await fetchWithRedirects(`${baseUrl}/${file}`, path.join(cacheDir, file), i, filesToDownload.length, file)) {
          downloadedCount++
        }
      } catch (err) {
        console.error(`[knowledge] Failed to download embedding model file ${file}:`, err)
      }
    }

    if (downloadedCount === 0) {
      return { success: false, error: '未能下载任何模型文件，请检查网络连接' }
    }
    if (!hasVisibleFiles(cacheDir)) {
      return { success: false, error: '模型文件不完整：缺少 ONNX 模型文件，请重新下载' }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
