export type WorkspaceSandboxPermissionPrompt = {
  requestId: string
  workspacePath: string
  targetPath: string
  access: 'read' | 'write'
  source: 'file-tool' | 'bash'
}
