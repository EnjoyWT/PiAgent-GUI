import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  Tray,
  nativeImage,
  screen
} from 'electron'
import { join } from 'path'
import { mkdirSync } from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import appIcon from '../../resources/icon.png?asset'
import trayIconTemplate from '../../resources/statusbarTemplate.png?asset'
import { startLocalHttpServer, stopLocalHttpServer } from './http/local-http-server'
import { getDoctorService } from './doctor/doctor-service-singleton.ts'
import { TransportDoctor } from './doctor/transport-doctor.ts'
import { ImRuntimeDoctor } from './doctor/im-runtime-doctor.ts'
import { ComputerUseDoctor } from './computer-use/computer-use-doctor.ts'
import { setupContextHandlers } from './ipc/context-handlers'
import { setupAgentPluginHandlers } from './ipc/agent-plugin-handlers.ts'
import { setupChatAssetHandlers } from './ipc/chat-asset-handlers'
import { setupComputerUseHandlers } from './ipc/computer-use-handlers.ts'
import { setupDoctorHandlers } from './ipc/doctor-handlers'
import { setupDbHandlers } from './ipc/db-handlers'
import { setupFileContextMenuHandlers } from './ipc/file-context-menu-handlers.ts'
import { setupCoreV2Handlers } from './ipc/core-v2-handlers'
import { setupE2EHandlers } from './ipc/e2e-handlers'
import { setupGatewayHandlers } from './ipc/gateway-handlers'
import { setupMcpHandlers } from './ipc/mcp-handlers'
import { setupPluginHandlers } from './ipc/plugin-handlers'
import { setupProviderConfigHandlers } from './ipc/provider-config-handlers'
import { setupRuntimeHandlers } from './ipc/runtime-handlers'
import { setupSkillsHandlers } from './ipc/skills-handlers'
import { setupWorkspaceHandlers } from './ipc/workspace-handlers'
import { setupScheduledTaskHandlers } from './ipc/scheduled-task-handlers'
import { setupWebFetchHandlers } from './ipc/webfetch-handlers.ts'
import { setupKnowledgeHandlers } from './ipc/knowledge-handlers'
import { setupAppUpdateHandlers } from './ipc/app-update-handlers.ts'
import { knowledgeCaptureScheduler } from './knowledge/knowledge-capture-scheduler.ts'
import { knowledgeActiveTaskFinalizeScheduler } from './knowledge/knowledge-active-task-finalize-scheduler.ts'
import { isThreadKnowledgeCaptureEnabled } from './knowledge/knowledge-settings.ts'
import { mcpRuntimeManager } from './mcp/mcp-runtime-manager'
import { closeCoreV2Db, getCoreV2Service } from './core-v2/sqlite-db.ts'
import { getScheduledTaskScheduler } from './scheduled-tasks/scheduled-task-scheduler.ts'
import {
  getEmbeddedGatewayService,
  stopEmbeddedGatewayService
} from './transport/embedded-gateway.ts'
import { getImDoctorPlane } from './im/im-doctor-plane-singleton.ts'
import { notifyRunFinishedIfNeeded } from './runtime/run-finished-notifier.ts'
import { startAgentPluginBackgroundExtensions } from './agent-plugins/agent-plugin-background-service.ts'

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let knowledgeManagerWindow: BrowserWindow | null = null
let runtimeInspectorWindow: BrowserWindow | null = null
let appTray: Tray | null = null
const SETTINGS_WINDOW_OFFSET_X = 48
const SETTINGS_WINDOW_OFFSET_Y = 48
const isE2EMode = process.env.PIAGENT_E2E === '1'
const userDataOverride = String(process.env.PIAGENT_USER_DATA_DIR ?? '').trim()

if (userDataOverride) {
  mkdirSync(userDataOverride, { recursive: true })
  app.setPath('userData', userDataOverride)
}

function positionSettingsWindow(window: BrowserWindow): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const mainBounds = mainWindow.getBounds()
  const settingsBounds = window.getBounds()
  const display = screen.getDisplayMatching(mainBounds)
  const {
    x: workAreaX,
    y: workAreaY,
    width: workAreaWidth,
    height: workAreaHeight
  } = display.workArea

  const targetX = Math.min(
    Math.max(mainBounds.x + SETTINGS_WINDOW_OFFSET_X, workAreaX),
    workAreaX + workAreaWidth - settingsBounds.width
  )
  const targetY = Math.min(
    Math.max(mainBounds.y + SETTINGS_WINDOW_OFFSET_Y, workAreaY),
    workAreaY + workAreaHeight - settingsBounds.height
  )

  window.setPosition(targetX, targetY)
}

function positionInspectorWindow(window: BrowserWindow): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const mainBounds = mainWindow.getBounds()
  const inspectorBounds = window.getBounds()
  const display = screen.getDisplayMatching(mainBounds)
  const {
    x: workAreaX,
    y: workAreaY,
    width: workAreaWidth,
    height: workAreaHeight
  } = display.workArea

  const targetX = Math.min(
    Math.max(mainBounds.x + mainBounds.width - inspectorBounds.width - 32, workAreaX),
    workAreaX + workAreaWidth - inspectorBounds.width
  )
  const targetY = Math.min(
    Math.max(mainBounds.y + 40, workAreaY),
    workAreaY + workAreaHeight - inspectorBounds.height
  )

  window.setPosition(targetX, targetY)
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }

  mainWindow.focus()
}

function ensureMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
  }
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function openThreadInMainWindow(threadId: string): void {
  const targetWindow = ensureMainWindow()
  if (!targetWindow) return

  const sendThreadSelection = () => {
    if (targetWindow.isDestroyed()) return
    targetWindow.webContents.send('main-window:open-thread', threadId)
  }

  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once('did-finish-load', sendThreadSelection)
  } else {
    sendThreadSelection()
  }
}

function notifyFinishedRun(payload: { threadId: string; runId: string; preview: string }): boolean {
  // Trigger Knowledge Memory Layer capture asynchronously
  try {
    const core = getCoreV2Service()
    const run = core.getAgentRun(payload.runId)
    if (run && isThreadKnowledgeCaptureEnabled(payload.threadId)) {
      const conv = core.getConversation(run.conversationId)
      knowledgeCaptureScheduler.scheduleRun({
        conversationId: run.conversationId,
        threadId: payload.threadId,
        agentRunId: payload.runId,
        workspacePath: conv?.workspaceId || null
      })
    }
  } catch (err) {
    console.error('[knowledge] Failed to schedule knowledge capture', err)
  }

  const notificationsSupported = Notification.isSupported()
  return notifyRunFinishedIfNeeded({
    mainWindow,
    threadId: payload.threadId,
    preview: payload.preview,
    NotificationCtor: Notification,
    notificationsSupported,
    showMainWindow,
    openThread: (threadId) => {
      openThreadInMainWindow(threadId)
    }
  })
}

function setRunFinishedBadgeCount(count: number): void {
  const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  if (process.platform === 'darwin') {
    app.dock?.setBadge(normalizedCount > 0 ? String(normalizedCount) : '')
    return
  }
  app.setBadgeCount(normalizedCount)
}

function toggleMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
    return
  }

  showMainWindow()
}

function createTray(): void {
  if (process.platform !== 'darwin' || appTray) {
    return
  }

  const trayImage = nativeImage.createFromPath(trayIconTemplate).resize({ height: 16 })
  trayImage.setTemplateImage(true)

  appTray = new Tray(trayImage)
  appTray.setToolTip('PiAgent')
  appTray.setIgnoreDoubleClickEvents(true)
  appTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => showMainWindow()
      },
      {
        label: '打开设置',
        click: () => createSettingsWindow()
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit()
      }
    ])
  )
  appTray.on('click', () => toggleMainWindow())
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    autoHideMenuBar: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    titleBarStyle: 'hidden', // 隐藏原生标题栏
    trafficLightPosition: { x: 20, y: 18 }, // 调整红绿灯位置（如果使用原生的化）
    ...(process.platform === 'linux' ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createSettingsWindow(category?: string): void {
  if (settingsWindow) {
    positionSettingsWindow(settingsWindow)
    if (category) {
      settingsWindow.webContents.send('set-settings-category', category)
    }
    if (!settingsWindow.isVisible()) {
      settingsWindow.show()
    }
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    autoHideMenuBar: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    title: '设置',
    titleBarStyle: 'hidden', // 隐藏原生标题栏（macOS）
    trafficLightPosition: { x: 20, y: 18 },
    ...(process.platform === 'linux' ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  settingsWindow.on('ready-to-show', () => {
    if (settingsWindow) {
      positionSettingsWindow(settingsWindow)
    }
    settingsWindow?.show()
    if (category) {
      settingsWindow?.webContents.send('set-settings-category', category)
    }
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  const settingsUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? `${process.env['ELECTRON_RENDERER_URL']}#settings${category ? `?category=${category}` : ''}`
      : `file://${join(__dirname, '../renderer/index.html')}#settings${category ? `?category=${category}` : ''}`

  settingsWindow.loadURL(settingsUrl)
}

function createKnowledgeManagerWindow(): void {
  if (knowledgeManagerWindow) {
    positionSettingsWindow(knowledgeManagerWindow)
    if (!knowledgeManagerWindow.isVisible()) knowledgeManagerWindow.show()
    knowledgeManagerWindow.focus()
    return
  }

  knowledgeManagerWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    title: '记忆管理',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 20, y: 18 },
    ...(process.platform === 'linux' ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  knowledgeManagerWindow.on('ready-to-show', () => {
    if (knowledgeManagerWindow) positionSettingsWindow(knowledgeManagerWindow)
    knowledgeManagerWindow?.show()
  })

  knowledgeManagerWindow.on('closed', () => {
    knowledgeManagerWindow = null
  })

  const url =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? `${process.env['ELECTRON_RENDERER_URL']}#knowledge-manager`
      : `file://${join(__dirname, '../renderer/index.html')}#knowledge-manager`

  knowledgeManagerWindow.loadURL(url)
}

function createRuntimeInspectorWindow(threadId?: string | null): void {
  if (runtimeInspectorWindow) {
    positionInspectorWindow(runtimeInspectorWindow)
    if (threadId) runtimeInspectorWindow.webContents.send('runtime-inspector:set-thread', threadId)
    if (!runtimeInspectorWindow.isVisible()) runtimeInspectorWindow.show()
    runtimeInspectorWindow.focus()
    return
  }

  runtimeInspectorWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    title: 'Runtime Inspector',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 20, y: 18 },
    ...(process.platform === 'linux' ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  runtimeInspectorWindow.on('ready-to-show', () => {
    if (runtimeInspectorWindow) positionInspectorWindow(runtimeInspectorWindow)
    runtimeInspectorWindow?.show()
    if (threadId) runtimeInspectorWindow?.webContents.send('runtime-inspector:set-thread', threadId)
  })

  runtimeInspectorWindow.on('closed', () => {
    runtimeInspectorWindow = null
  })

  const encodedThread = threadId ? `?threadId=${encodeURIComponent(threadId)}` : ''
  const inspectorUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? `${process.env['ELECTRON_RENDERER_URL']}#runtime-inspector${encodedThread}`
      : `file://${join(__dirname, '../renderer/index.html')}#runtime-inspector${encodedThread}`

  runtimeInspectorWindow.loadURL(inspectorUrl)
}

// IPC test
ipcMain.on('ping', () => console.log('pong'))

ipcMain.on('open-settings', (_, category?: string) => {
  createSettingsWindow(category)
})

ipcMain.on('open-knowledge-manager', () => {
  createKnowledgeManagerWindow()
})

ipcMain.on('open-runtime-inspector', (_, threadId?: string | null) => {
  createRuntimeInspectorWindow(threadId ?? null)
})

ipcMain.on('runtime-inspector:set-thread', (_, threadId?: string | null) => {
  if (!runtimeInspectorWindow || runtimeInspectorWindow.isDestroyed() || !threadId) return
  runtimeInspectorWindow.webContents.send('runtime-inspector:set-thread', threadId)
})

app.whenReady().then(async () => {
  app.setName('PiAgent')

  // Windows 10+ notification support
  electronApp.setAppUserModelId('com.piagent.app')

  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(appIcon))
  }

  // Default open/close behavior
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Setup IPC handlers once (before any window is created)
  setupDbHandlers()
  setupFileContextMenuHandlers()
  setupChatAssetHandlers()
  setupComputerUseHandlers()
  setupDoctorHandlers()
  setupProviderConfigHandlers()
  setupCoreV2Handlers()
  setupContextHandlers()
  setupGatewayHandlers()
  setupAgentPluginHandlers()
  setupPluginHandlers()
  if (isE2EMode) setupE2EHandlers()
  setupKnowledgeHandlers()
  setupMcpHandlers()
  setupRuntimeHandlers({
    notifyRunFinished: (payload) => notifyFinishedRun(payload),
    setRunFinishedBadgeCount
  })
  setupSkillsHandlers()
  setupWorkspaceHandlers()
  setupScheduledTaskHandlers()
  setupWebFetchHandlers()
  setupAppUpdateHandlers()

  if (!isE2EMode) {
    try {
      await startLocalHttpServer()
    } catch (error) {
      console.error('Start local HTTP server failed', error)
    }

    void startAgentPluginBackgroundExtensions().catch((error) => {
      console.error('Start agent plugin background extensions failed', error)
    })
  }

  try {
    getDoctorService().register(new ComputerUseDoctor())
    getDoctorService().register(new ImRuntimeDoctor(getImDoctorPlane()))
    const embeddedGateway = await getEmbeddedGatewayService()
    getDoctorService().register(new TransportDoctor(embeddedGateway.getTransportHost()))
    getDoctorService().register(
      new TransportDoctor(embeddedGateway.getTransportHost(), {
        domainId: 'im-transport',
        displayName: 'IM Transport',
        sourceKind: 'im'
      })
    )
    await embeddedGateway.start()
  } catch (error) {
    console.error('Start embedded gateway failed', error)
  }

  if (!isE2EMode) {
    try {
      await getScheduledTaskScheduler().start()
    } catch (error) {
      console.error('Start scheduled task scheduler failed', error)
    }
    try {
      await knowledgeActiveTaskFinalizeScheduler.start()
    } catch (error) {
      console.error('Start knowledge active-task finalize scheduler failed', error)
    }
  }

  if (!isE2EMode) createTray()
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    const allWindows = BrowserWindow.getAllWindows()
    if (allWindows.length === 0) {
      createWindow()
      return
    }

    // macOS 默认行为：恢复所有窗口，保持之前的窗口层级顺序
    // 而不是强行 focus 主窗口（否则 settings 窗口被压到后面）
    for (const win of allWindows) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  appTray?.destroy()
  appTray = null
  runtimeInspectorWindow = null
  getScheduledTaskScheduler().stop()
  knowledgeActiveTaskFinalizeScheduler.stop()
  void stopEmbeddedGatewayService()
    .catch((error) => console.error('Stop embedded gateway failed', error))
    .finally(() => closeCoreV2Db())
  void mcpRuntimeManager.disposeAll()
  void stopLocalHttpServer()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
