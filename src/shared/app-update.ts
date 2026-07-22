export type AppUpdatePhase =
  'idle' | 'checking' | 'not-available' | 'available' | 'downloading' | 'downloaded' | 'error'

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

export type AppUpdatePrimaryAction = 'check' | 'download' | 'install' | 'open-release' | 'none'

export interface AppUpdatePrimaryControl {
  action: AppUpdatePrimaryAction
  label: string
  disabled: boolean
  progressPercent: number | null
}

export type AppUpdateSidebarBadgeTone = 'available' | 'downloading' | 'downloaded' | 'error'

export interface AppUpdateSidebarBadge {
  label: string
  tone: AppUpdateSidebarBadgeTone
  progressPercent: number | null
}

export const APP_UPDATE_RELEASE_OWNER = 'EnjoyWT'
export const APP_UPDATE_RELEASE_REPO = 'PiAgent-GUI'
export const APP_UPDATE_RELEASE_PAGE_URL = `https://github.com/${APP_UPDATE_RELEASE_OWNER}/${APP_UPDATE_RELEASE_REPO}/releases`

const canUseInAppUpdate = (status: AppUpdateStatus): boolean =>
  status.supported && status.isPackaged

export const clampAppUpdateProgressPercent = (percent: number | null | undefined): number => {
  if (!Number.isFinite(percent)) return 0
  return Math.max(0, Math.min(100, Number(percent)))
}

const formatWholePercent = (percent: number | null | undefined): string =>
  `${Math.floor(clampAppUpdateProgressPercent(percent))}%`

export function buildAppUpdatePrimaryControl(status: AppUpdateStatus): AppUpdatePrimaryControl {
  const version = status.updateInfo?.version
  const checkLabel = `检查更新 · v${status.currentVersion || '—'}`

  if (status.phase === 'checking') {
    return {
      action: 'none',
      label: '检查中…',
      disabled: true,
      progressPercent: null
    }
  }

  if (status.phase === 'downloading') {
    const progressPercent = clampAppUpdateProgressPercent(status.progress?.percent)
    return {
      action: 'none',
      label: `下载中 ${formatWholePercent(progressPercent)}`,
      disabled: true,
      progressPercent
    }
  }

  if (status.phase === 'downloaded') {
    return {
      action: canUseInAppUpdate(status) ? 'install' : 'open-release',
      label: canUseInAppUpdate(status) ? '重启安装' : '打开 Release',
      disabled: false,
      progressPercent: 100
    }
  }

  if (status.phase === 'available') {
    if (!canUseInAppUpdate(status)) {
      return {
        action: 'open-release',
        label: '打开 Release',
        disabled: false,
        progressPercent: null
      }
    }
    return {
      action: 'download',
      label: version ? `下载 v${version}` : '下载更新',
      disabled: false,
      progressPercent: null
    }
  }

  if (status.phase === 'error') {
    if (version && canUseInAppUpdate(status)) {
      return {
        action: 'download',
        label: '重试下载',
        disabled: false,
        progressPercent: null
      }
    }
    return {
      action: 'open-release',
      label: '打开 Release',
      disabled: false,
      progressPercent: null
    }
  }

  return {
    action: 'check',
    label: checkLabel,
    disabled: false,
    progressPercent: null
  }
}

export function buildAppUpdateSidebarBadge(
  status: AppUpdateStatus | null | undefined
): AppUpdateSidebarBadge | null {
  if (!status) return null

  if (status.phase === 'available') {
    return {
      label: '更新',
      tone: 'available',
      progressPercent: null
    }
  }

  if (status.phase === 'downloading') {
    const progressPercent = clampAppUpdateProgressPercent(status.progress?.percent)
    return {
      label: `下载 ${formatWholePercent(progressPercent)}`,
      tone: 'downloading',
      progressPercent
    }
  }

  if (status.phase === 'downloaded') {
    return {
      label: '可安装',
      tone: 'downloaded',
      progressPercent: 100
    }
  }

  if (status.phase === 'error' && status.updateInfo?.version) {
    return {
      label: '重试',
      tone: 'error',
      progressPercent: null
    }
  }

  return null
}

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
