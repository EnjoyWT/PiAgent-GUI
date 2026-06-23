import { ipcMain, shell, app } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const getTempWorkspacesRootDir = () => path.join(app.getPath('userData'), 'temp-workspaces')

const ensureDir = (dir: string) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

const createTempWorkspaceName = () => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const yy = String(now.getFullYear()).slice(-2)
  const mm = pad(now.getMonth() + 1)
  const dd = pad(now.getDate())
  const rand = Math.random().toString(16).slice(2, 8).padEnd(6, '0')
  return `ws-${yy}${mm}${dd}-${rand}`
}

export function setupWorkspaceHandlers(): void {
  ipcMain.handle('workspace:get-temp-root', async () => {
    const rootDir = getTempWorkspacesRootDir()
    ensureDir(rootDir)
    return { rootDir }
  })

  ipcMain.handle('workspace:open-temp-root', async () => {
    const rootDir = getTempWorkspacesRootDir()
    ensureDir(rootDir)
    await shell.openPath(rootDir)
    return { success: true, rootDir }
  })

  ipcMain.handle('workspace:create-temp', async () => {
    const rootDir = getTempWorkspacesRootDir()
    ensureDir(rootDir)
    const workspacePath = path.join(rootDir, createTempWorkspaceName())
    ensureDir(workspacePath)
    return { workspacePath, rootDir }
  })

  ipcMain.handle('workspace:delete-directory', async (_, workspacePath: string) => {
    const rootDir = getTempWorkspacesRootDir()
    // Safety check: ensure the path is within the temp-workspaces root
    if (workspacePath.startsWith(rootDir) && existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true })
      return { success: true }
    }
    return { success: false, error: 'Invalid workspace path or directory does not exist' }
  })
}
