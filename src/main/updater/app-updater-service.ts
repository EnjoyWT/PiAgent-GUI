import { app, BrowserWindow, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import { is } from '@electron-toolkit/utils'
import {
  APP_UPDATE_RELEASE_PAGE_URL,
  type AppUpdateCheckResult,
  type AppUpdatePhase,
  type AppUpdateProgress,
  type AppUpdateStatus,
  type AppUpdateVersionInfo
} from '../../shared/app-update.ts'

const STATUS_CHANNEL = 'app-update:status'

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

function normalizeReleaseNotes(notes: UpdateInfo['releaseNotes']): string | null {
  if (!notes) return null
  if (typeof notes === 'string') return notes.trim() || null
  if (Array.isArray(notes)) {
    const text = notes
      .map((item) => {
        if (!item) return ''
        if (typeof item === 'string') return item
        return String(item.note ?? '').trim()
      })
      .filter(Boolean)
      .join('\n')
    return text || null
  }
  return null
}

function toVersionInfo(info: UpdateInfo): AppUpdateVersionInfo {
  return {
    version: info.version,
    releaseName: info.releaseName ?? null,
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    releaseDate: info.releaseDate ?? null
  }
}

function toProgress(info: ProgressInfo): AppUpdateProgress {
  return {
    percent: Number.isFinite(info.percent) ? info.percent : 0,
    bytesPerSecond: Number.isFinite(info.bytesPerSecond) ? info.bytesPerSecond : 0,
    transferred: Number.isFinite(info.transferred) ? info.transferred : 0,
    total: Number.isFinite(info.total) ? info.total : 0
  }
}

class AppUpdaterService {
  private phase: AppUpdatePhase = 'idle'
  private updateInfo: AppUpdateVersionInfo | null = null
  private progress: AppUpdateProgress | null = null
  private error: string | null = null
  private checkedAt: string | null = null
  private initialized = false
  private checkInFlight: Promise<AppUpdateCheckResult> | null = null
  private downloadInFlight: Promise<AppUpdateStatus> | null = null

  init(): void {
    if (this.initialized) return
    this.initialized = true

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.fullChangelog = false

    // Packaged builds use app-update.yml from electron-builder.
    // Dev can opt into local config, but default is disabled for day-to-day work.
    autoUpdater.forceDevUpdateConfig = false

    autoUpdater.logger = {
      info: (...args) => console.info('[app-update]', ...args),
      warn: (...args) => console.warn('[app-update]', ...args),
      error: (...args) => console.error('[app-update]', ...args),
      debug: (...args) => console.debug('[app-update]', ...args)
    }

    autoUpdater.on('checking-for-update', () => {
      this.setPhase('checking', { error: null, progress: null })
    })

    autoUpdater.on('update-available', (info) => {
      this.updateInfo = toVersionInfo(info)
      this.setPhase('available', { error: null, progress: null })
    })

    autoUpdater.on('update-not-available', (info) => {
      this.updateInfo = toVersionInfo(info)
      this.setPhase('not-available', { error: null, progress: null })
    })

    autoUpdater.on('download-progress', (info) => {
      this.progress = toProgress(info)
      this.setPhase('downloading', { error: null })
    })

    autoUpdater.on('update-downloaded', (event) => {
      this.updateInfo = toVersionInfo(event)
      this.progress = {
        percent: 100,
        bytesPerSecond: 0,
        transferred: this.progress?.total ?? 0,
        total: this.progress?.total ?? 0
      }
      this.setPhase('downloaded', { error: null })
    })

    autoUpdater.on('error', (error) => {
      this.setPhase('error', { error: toErrorMessage(error) })
    })
  }

  getStatus(): AppUpdateStatus {
    const packaged = app.isPackaged
    return {
      phase: this.phase,
      currentVersion: app.getVersion(),
      isPackaged: packaged,
      // Mac-first release path. Windows/Linux can be enabled later with the same service.
      supported: packaged && process.platform === 'darwin',
      updateInfo: this.updateInfo,
      progress: this.progress,
      error: this.error,
      releasePageUrl: APP_UPDATE_RELEASE_PAGE_URL,
      checkedAt: this.checkedAt
    }
  }

  async checkForUpdates(): Promise<AppUpdateCheckResult> {
    this.init()

    if (this.checkInFlight) return this.checkInFlight

    this.checkInFlight = this.runCheck()
    try {
      return await this.checkInFlight
    } finally {
      this.checkInFlight = null
    }
  }

  async downloadUpdate(): Promise<AppUpdateStatus> {
    this.init()

    if (this.downloadInFlight) return this.downloadInFlight

    this.downloadInFlight = this.runDownload()
    try {
      return await this.downloadInFlight
    } finally {
      this.downloadInFlight = null
    }
  }

  quitAndInstall(): AppUpdateStatus {
    this.init()

    if (!app.isPackaged || process.platform !== 'darwin') {
      this.setPhase('error', {
        error: '当前环境不支持应用内安装更新，请从 GitHub Release 手动下载。'
      })
      return this.getStatus()
    }

    if (this.phase !== 'downloaded') {
      this.setPhase('error', { error: '还没有可安装的更新，请先下载。' })
      return this.getStatus()
    }

    // Mac without notarization may still prompt Gatekeeper after install.
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall()
      } catch (error) {
        this.setPhase('error', { error: toErrorMessage(error) })
      }
    })

    return this.getStatus()
  }

  async openReleasePage(): Promise<{ success: true; url: string }> {
    const url = APP_UPDATE_RELEASE_PAGE_URL
    // Always open in the OS default browser (never navigate in-app).
    await shell.openExternal(url, { activate: true })
    return { success: true, url }
  }

  private async runCheck(): Promise<AppUpdateCheckResult> {
    if (is.dev || !app.isPackaged) {
      this.checkedAt = new Date().toISOString()
      this.setPhase('error', {
        error: '开发模式不检查更新。请使用打包后的 Mac 应用验证。'
      })
      return { status: this.getStatus(), updateAvailable: false }
    }

    if (process.platform !== 'darwin') {
      this.checkedAt = new Date().toISOString()
      this.setPhase('error', {
        error: '当前只启用了 macOS 更新。请从 GitHub Release 手动下载。'
      })
      return { status: this.getStatus(), updateAvailable: false }
    }

    this.error = null
    this.progress = null
    this.setPhase('checking')

    try {
      const result = await autoUpdater.checkForUpdates()
      this.checkedAt = new Date().toISOString()

      // Event handlers usually update phase first; keep a safe fallback.
      if (this.phase === 'checking') {
        if (result?.updateInfo) {
          this.updateInfo = toVersionInfo(result.updateInfo)
          const available = result.updateInfo.version !== app.getVersion()
          this.setPhase(available ? 'available' : 'not-available')
        } else {
          this.setPhase('not-available')
        }
      }

      return {
        status: this.getStatus(),
        updateAvailable: this.phase === 'available' || this.phase === 'downloaded'
      }
    } catch (error) {
      this.checkedAt = new Date().toISOString()
      this.setPhase('error', { error: toErrorMessage(error) })
      return { status: this.getStatus(), updateAvailable: false }
    }
  }

  private async runDownload(): Promise<AppUpdateStatus> {
    if (!app.isPackaged || process.platform !== 'darwin') {
      this.setPhase('error', {
        error: '当前环境不支持应用内下载更新，请打开 GitHub Release 手动下载。'
      })
      return this.getStatus()
    }

    if (this.phase !== 'available' && this.phase !== 'error' && this.phase !== 'downloading') {
      // Allow retry after error if we already know an update exists.
      if (!this.updateInfo) {
        this.setPhase('error', { error: '没有可下载的更新，请先检查更新。' })
        return this.getStatus()
      }
    }

    if (this.phase === 'downloaded') {
      return this.getStatus()
    }

    this.error = null
    this.progress = {
      percent: 0,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0
    }
    this.setPhase('downloading')

    try {
      await autoUpdater.downloadUpdate()
      if (this.phase === 'downloading') {
        this.setPhase('downloaded')
      }
      return this.getStatus()
    } catch (error) {
      this.setPhase('error', { error: toErrorMessage(error) })
      return this.getStatus()
    }
  }

  private setPhase(
    phase: AppUpdatePhase,
    patch?: {
      error?: string | null
      progress?: AppUpdateProgress | null
    }
  ): void {
    this.phase = phase
    if (patch && 'error' in patch) this.error = patch.error ?? null
    if (patch && 'progress' in patch) this.progress = patch.progress ?? null
    this.broadcast()
  }

  private broadcast(): void {
    const status = this.getStatus()
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(STATUS_CHANNEL, status)
    }
  }
}

let singleton: AppUpdaterService | null = null

export function getAppUpdaterService(): AppUpdaterService {
  if (!singleton) singleton = new AppUpdaterService()
  return singleton
}
