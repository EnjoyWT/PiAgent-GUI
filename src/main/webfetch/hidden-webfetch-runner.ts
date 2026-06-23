import { BrowserWindow, session } from 'electron'
import { WEBFETCH_SESSION_PARTITION } from './webfetch-session.ts'
import { assertSafeWebFetchUrl } from './url-safety.ts'

export { WEBFETCH_SESSION_PARTITION }

export type HiddenWebFetchInput = {
  url: string
  script: string
  timeoutMs?: number
  waitAfterLoadMs?: number
  signal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 25_000
const DEFAULT_WAIT_AFTER_LOAD_MS = 300

const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve()
      return
    }
    if (signal?.aborted) {
      reject(new Error('WebFetch aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('WebFetch aborted'))
      },
      { once: true }
    )
  })

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> => {
  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('WebFetch aborted'))
      return
    }
    timer = setTimeout(() => reject(new Error('WebFetch timed out')), timeoutMs)
    signal?.addEventListener('abort', () => reject(new Error('WebFetch aborted')), { once: true })
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const runHiddenWebFetch = async <T>({
  url,
  script,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  waitAfterLoadMs = DEFAULT_WAIT_AFTER_LOAD_MS,
  signal
}: HiddenWebFetchInput): Promise<T> => {
  const safeUrl = assertSafeWebFetchUrl(url)
  const webfetchSession = session.fromPartition(WEBFETCH_SESSION_PARTITION)
  webfetchSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      partition: WEBFETCH_SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  try {
    await withTimeout(win.loadURL(safeUrl), timeoutMs, signal)
    const finalUrl = win.webContents.getURL()
    if (finalUrl) assertSafeWebFetchUrl(finalUrl)
    await wait(waitAfterLoadMs, signal)
    return (await withTimeout(
      win.webContents.executeJavaScript(script, true),
      timeoutMs,
      signal
    )) as T
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
