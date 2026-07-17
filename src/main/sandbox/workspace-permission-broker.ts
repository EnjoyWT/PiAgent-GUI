import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { WorkspaceSandboxPermissionPrompt } from '../../shared/workspace-sandbox-permission.ts'
import {
  normalizeExternalSandboxGrant,
  normalizeWorkspaceSandboxPath,
  type FileAccessMode
} from './workspace-sandbox.ts'

export type WorkspacePermissionRequest = {
  workspacePath: string
  targetPath: string
  access: FileAccessMode
  source: 'file-tool' | 'bash'
}

export type WorkspacePermissionBroker = {
  requestAccess(request: WorkspacePermissionRequest): Promise<boolean>
}

const pendingRequests = new Map<string, (approved: boolean) => void>()

ipcMain.handle(
  'workspace-sandbox:respond-permission-prompt',
  (_event, requestId: string, approved: boolean) => {
    const resolve = pendingRequests.get(requestId)
    if (!resolve) return { success: false }
    pendingRequests.delete(requestId)
    resolve(Boolean(approved))
    return { success: true }
  }
)

const requestRendererApproval = (prompt: WorkspaceSandboxPermissionPrompt): Promise<boolean> => {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
  if (!window) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    pendingRequests.set(prompt.requestId, resolve)
    window.webContents.send('workspace-sandbox:permission-prompt', prompt)
  })
}

/**
 * The only authority that turns an out-of-workspace request into a persistent grant.
 * Repository configuration may suggest paths, but only this user-mediated broker can grant them.
 */
export const createNativeWorkspacePermissionBroker = (): WorkspacePermissionBroker => ({
  async requestAccess({ workspacePath, targetPath, access, source }): Promise<boolean> {
    const normalizedWorkspacePath = normalizeWorkspaceSandboxPath(workspacePath)
    const normalizedTargetPath = normalizeExternalSandboxGrant(normalizedWorkspacePath, targetPath)
    const approved = await requestRendererApproval({
      requestId: randomUUID(),
      workspacePath: normalizedWorkspacePath,
      targetPath: normalizedTargetPath,
      access,
      source
    })
    if (!approved) return false

    const { upsertWorkspaceSandboxGrant } = await import('../db/config-db.ts')
    upsertWorkspaceSandboxGrant(normalizedWorkspacePath, normalizedTargetPath, access)
    return true
  }
})
