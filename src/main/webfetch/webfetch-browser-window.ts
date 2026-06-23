import { BrowserWindow } from 'electron'
import { WEBFETCH_DEFAULT_URL, WEBFETCH_SESSION_PARTITION } from './webfetch-session.ts'
import { assertSafeWebFetchUrl } from './url-safety.ts'

let webfetchWindow: BrowserWindow | null = null

const resolveStartUrl = (rawUrl?: string | null): string => {
  const candidate = String(rawUrl ?? '').trim() || WEBFETCH_DEFAULT_URL
  return assertSafeWebFetchUrl(candidate)
}

const loadWindowUrl = (win: BrowserWindow, url: string): void => {
  void win.loadURL(url).catch(() => undefined)
}

export const openWebFetchBrowser = (rawUrl?: string | null): void => {
  const url = resolveStartUrl(rawUrl)

  if (webfetchWindow && !webfetchWindow.isDestroyed()) {
    if (!webfetchWindow.isVisible()) webfetchWindow.show()
    webfetchWindow.focus()
    loadWindowUrl(webfetchWindow, url)
    return
  }

  webfetchWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'WebFetch Browser',
    autoHideMenuBar: true,
    webPreferences: {
      partition: WEBFETCH_SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })

  webfetchWindow.on('closed', () => {
    webfetchWindow = null
  })

  webfetchWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    try {
      if (webfetchWindow) loadWindowUrl(webfetchWindow, assertSafeWebFetchUrl(nextUrl))
    } catch {
      // Drop unsafe popups instead of opening them externally or in-app.
    }
    return { action: 'deny' }
  })

  loadWindowUrl(webfetchWindow, url)
}
