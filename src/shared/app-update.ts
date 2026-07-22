export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface AppUpdateVersionInfo {
  version: string
  releaseName: string | null
  releaseNotes: string | null
  releaseDate: string | null
}

export interface AppUpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface AppUpdateStatus {
  phase: AppUpdatePhase
  currentVersion: string
  isPackaged: boolean
  supported: boolean
  updateInfo: AppUpdateVersionInfo | null
  progress: AppUpdateProgress | null
  error: string | null
  releasePageUrl: string
  checkedAt: string | null
}

export interface AppUpdateCheckResult {
  status: AppUpdateStatus
  updateAvailable: boolean
}

export const APP_UPDATE_RELEASE_OWNER = 'EnjoyWT'
export const APP_UPDATE_RELEASE_REPO = 'PiAgent-GUI'
export const APP_UPDATE_RELEASE_PAGE_URL = `https://github.com/${APP_UPDATE_RELEASE_OWNER}/${APP_UPDATE_RELEASE_REPO}/releases`

/**
 * Convert raw update errors to user-friendly Chinese messages.
 * Pure function, no Electron dependency.
 */
export function toUserFacingUpdateError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message || error.name : String(error)
  const message = rawMessage.toLowerCase()

  if (message.includes('unable to find latest version on github')) {
    return '暂时找不到可用的正式版本，请稍后重试，或前往 GitHub Release 手动下载。'
  }
  if (message.includes('latest-mac.yml') || message.includes('latest.yml')) {
    return '更新文件尚未准备完成，请稍后重试，或前往 GitHub Release 手动下载。'
  }
  if (
    message.includes('network') ||
    message.includes('econn') ||
    message.includes('enotfound') ||
    message.includes('etimedout')
  ) {
    return '无法连接更新服务，请检查网络后重试。'
  }

  return '检查更新时发生错误，请稍后重试，或前往 GitHub Release 手动下载。'
}
