import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import {
  getSetting,
  setSetting,
  getAllSettings,
  listProviders,
  upsertProvider,
  getProviderApiKey,
  setProviderApiKey,
  deleteProvider,
  listProviderModels,
  replaceProviderModels,
  setProviderModelEnabled,
  listMcpServers,
  upsertMcpServer,
  deleteMcpServer,
  listWorkspaces,
  upsertWorkspace,
  deleteWorkspace,
  getWorkspaceSettings,
  setWorkspaceSettings,
  listWorkspaceMcpServerBindings,
  setWorkspaceMcpServerEnabled,
  clearWorkspaceMcpServerBindings
} from '../db/config-db'
import { getLocalThreadHostService } from '../core-v2/local-thread-host.ts'
import { listLocalThreadRows } from '../core-v2/local-thread-query.ts'
import {
  deleteRegisteredWidget,
  deleteRegisteredWidgetsByThreadId,
  registerWidgetHtml,
  setRegisteredWidgetInactive
} from '../widgets/widget-registry'

export function setupDbHandlers(): void {
  const notifyWorkspacesChanged = (change: {
    action: 'upsert' | 'delete'
    workspacePath: string
  }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('db:workspaces:changed', change)
      }
    }
  }

  // ── global settings ────────────────────────────────────────────
  ipcMain.handle('db:settings:get', (_, key: string) => getSetting(key))
  ipcMain.handle('db:settings:set', (_, key: string, value: string) => setSetting(key, value))
  ipcMain.handle('db:settings:all', () => getAllSettings())

  // ── providers ──────────────────────────────────────────────────
  ipcMain.handle('db:providers:list', () => listProviders())
  ipcMain.handle(
    'db:providers:upsert',
    (
      _,
      provider: {
        id: string
        displayName: string
        runtimeProvider: string
        enabled?: boolean
        baseUrl?: string | null
        settingsJson?: string | null
      }
    ) => upsertProvider(provider)
  )
  ipcMain.handle('db:providers:get-api-key', (_, providerId: string) =>
    getProviderApiKey(providerId)
  )
  ipcMain.handle('db:providers:set-api-key', (_, providerId: string, apiKey: string) =>
    setProviderApiKey(providerId, apiKey)
  )
  ipcMain.handle('db:providers:delete', (_, providerId: string) => deleteProvider(providerId))

  ipcMain.handle('db:providers:models:list', (_, providerId: string) =>
    listProviderModels(providerId)
  )
  ipcMain.handle(
    'db:providers:models:replace',
    (
      _,
      providerId: string,
      models: Array<{
        modelId: string
        label: string
        contextWindowTokens?: number | null
        capabilitiesJson?: string | null
        rawJson?: string | null
      }>,
      enabledByDefault?: boolean
    ) => replaceProviderModels(providerId, models, Boolean(enabledByDefault))
  )
  ipcMain.handle(
    'db:providers:models:set-enabled',
    (_, providerId: string, modelId: string, enabled: boolean) =>
      setProviderModelEnabled(providerId, modelId, enabled)
  )

  // ── mcp servers ────────────────────────────────────────────────
  ipcMain.handle('db:mcp-servers:list', () => listMcpServers())
  ipcMain.handle(
    'db:mcp-servers:upsert',
    (
      _,
      server: {
        id: string
        name: string
        command: string
        args?: string | null
        env?: string | null
        enabled?: boolean
      }
    ) => upsertMcpServer(server)
  )
  ipcMain.handle('db:mcp-servers:delete', (_, id: string) => deleteMcpServer(id))

  // ── workspaces ────────────────────────────────────────────────
  ipcMain.handle('db:workspaces:list', () => listWorkspaces())
  ipcMain.handle('db:workspaces:upsert', (_, workspacePath: string, name?: string) => {
    upsertWorkspace(workspacePath, name)
    notifyWorkspacesChanged({ action: 'upsert', workspacePath })
  })
  ipcMain.handle('db:workspaces:delete', (_, workspacePath: string) => {
    const threadIds = listLocalThreadRows()
      .filter((thread) => thread.workspace_path === workspacePath)
      .map((thread) => thread.id)
    for (const threadId of threadIds) deleteRegisteredWidgetsByThreadId(threadId)
    return Promise.all(
      threadIds.map((threadId) =>
        getLocalThreadHostService().then((host) => host.deleteThread(threadId))
      )
    ).then(() => {
      deleteWorkspace(workspacePath)
      notifyWorkspacesChanged({ action: 'delete', workspacePath })
    })
  })

  // ── workspace settings ────────────────────────────────────────
  ipcMain.handle('db:workspace-settings:get', (_, workspacePath: string) =>
    getWorkspaceSettings(workspacePath)
  )
  ipcMain.handle(
    'db:workspace-settings:set',
    (_, workspacePath: string, settings: { model?: string; mcp_enabled?: string }) =>
      setWorkspaceSettings(workspacePath, settings)
  )

  ipcMain.handle('db:workspace-mcp-servers:list', (_, workspacePath: string) =>
    listWorkspaceMcpServerBindings(workspacePath)
  )
  ipcMain.handle(
    'db:workspace-mcp-servers:set-enabled',
    (_, workspacePath: string, serverId: string, enabled: boolean) =>
      setWorkspaceMcpServerEnabled(workspacePath, serverId, enabled)
  )
  ipcMain.handle('db:workspace-mcp-servers:clear', (_, workspacePath: string) =>
    clearWorkspaceMcpServerBindings(workspacePath)
  )

  ipcMain.handle('widget:register-html', (_, payload: { threadId: string; html: string }) =>
    registerWidgetHtml(payload.threadId, payload.html)
  )
  ipcMain.handle('widget:delete', (_, id: string) => deleteRegisteredWidget(id))
  ipcMain.handle('widget:set-inactive', (_, id: string, inactive: boolean) =>
    setRegisteredWidgetInactive(id, inactive)
  )

  // ── file picker dialog ────────────────────────────────────────
  ipcMain.handle('dialog:open-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:open-file-or-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(
    'dialog:save-file',
    async (_, payload: { content: string; defaultPath?: string; filters?: any[] }) => {
      const result = await dialog.showSaveDialog({
        defaultPath: payload.defaultPath,
        filters: payload.filters
      })
      if (result.canceled || !result.filePath) return null
      writeFileSync(result.filePath, payload.content, 'utf8')
      return result.filePath
    }
  )
}
