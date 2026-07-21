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
