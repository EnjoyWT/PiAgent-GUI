import { BrowserWindow, Menu, clipboard, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getLocalThreadRow } from '../core-v2/local-thread-query.ts'

export type ShowFileContextMenuInput = {
  path?: string
  threadId?: string | null
  workspacePath?: string | null
}

export const resolveFileContextMenuPath = (input: ShowFileContextMenuInput): string => {
  const filePath = String(input.path ?? '').trim()
  if (!filePath) return ''
  if (path.isAbsolute(filePath)) return filePath

  const workspacePath = String(input.workspacePath ?? '').trim() || resolveThreadWorkspace(input)
  return workspacePath ? path.resolve(workspacePath, filePath) : filePath
}

const resolveThreadWorkspace = (input: ShowFileContextMenuInput): string => {
  const threadId = String(input.threadId ?? '').trim()
  return threadId ? (getLocalThreadRow(threadId)?.workspace_path ?? '') : ''
}

const revealFileInFolder = (filePath: string): void => {
  shell.showItemInFolder(filePath)

  const parentPath = path.dirname(filePath)
  if (!existsSync(filePath) && parentPath && parentPath !== filePath && existsSync(parentPath)) {
    void shell.openPath(parentPath)
  }
}

export function setupFileContextMenuHandlers(): void {
  ipcMain.handle('file-context-menu:show', (event, input: ShowFileContextMenuInput) => {
    const resolvedPath = resolveFileContextMenuPath(input)
    if (!resolvedPath) return { success: false, error: 'Missing file path' }

    const canOpenInFinder = path.isAbsolute(resolvedPath)
    const menu = Menu.buildFromTemplate([
      {
        label: '复制路径',
        click: () => clipboard.writeText(resolvedPath)
      },
      {
        label: process.platform === 'darwin' ? '在“访达”中打开' : '在文件管理器中打开',
        enabled: canOpenInFinder,
        click: () => revealFileInFolder(resolvedPath)
      },
      {
        label: '用默认应用打开',
        enabled: canOpenInFinder,
        click: () => {
          void shell.openPath(resolvedPath)
        }
      }
    ])

    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender) ?? undefined
    })

    return { success: true, path: resolvedPath }
  })
}
