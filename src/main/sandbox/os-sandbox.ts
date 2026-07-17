import { spawn } from 'node:child_process'
import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import type { BashOperations } from '@earendil-works/pi-coding-agent'
import { createNativeWorkspacePermissionBroker } from './workspace-permission-broker.ts'
import {
  WorkspaceSandbox,
  type FileAccessMode,
  type WorkspaceFileGrant
} from './workspace-sandbox.ts'

const unrestrictedNetworkConfig: SandboxRuntimeConfig = {
  network: { allowedDomains: ['*'], deniedDomains: [], strictAllowlist: true },
  filesystem: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [], disabled: true }
}

let initialization: Promise<void> | undefined

const initializeSandboxRuntime = async (): Promise<void> => {
  if (!SandboxManager.isSupportedPlatform()) {
    throw new Error(`Workspace sandbox is not supported on ${process.platform}`)
  }
  initialization ??= SandboxManager.initialize(unrestrictedNetworkConfig)
  try {
    await initialization
  } catch (error) {
    initialization = undefined
    throw error
  }
}

const systemReadPaths = process.platform === 'win32' ? [] : ['/bin', '/usr', '/System', '/dev']

const createCommandConfig = (
  workspacePath: string,
  grants: WorkspaceFileGrant[]
): Partial<SandboxRuntimeConfig> => {
  const readableGrants = grants.map((grant) => grant.path)
  const writableGrants = grants
    .filter((grant) => grant.access === 'write')
    .map((grant) => grant.path)
  return {
    // The product deliberately permits networking. The runtime still routes it through
    // its boundary so filesystem isolation cannot be bypassed by a child process.
    network: { allowedDomains: ['*'], deniedDomains: [], strictAllowlist: true },
    filesystem: {
      // Reads are deny-then-allow in sandbox-runtime. Start at filesystem root, then
      // re-allow just the workspace, explicit grants, and the OS executable paths required
      // to launch normal developer tools. This blocks sibling projects and credentials.
      denyRead: ['/'],
      allowRead: [workspacePath, ...readableGrants, ...systemReadPaths],
      allowWrite: [workspacePath, ...writableGrants],
      denyWrite: []
    }
  }
}

const kill = (child: ReturnType<typeof spawn>) => {
  if (child.exitCode !== null || child.killed) return
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
      return
    } catch {
      // Fall through to child.kill when the process group is already gone.
    }
  }
  child.kill('SIGTERM')
}

const absolutePathsInCommand = (command: string): string[] =>
  Array.from(
    command.matchAll(/(?:^|[\s'\"=:(])((?:\/[^\s'\";|&()<>]+)+)/g),
    (match) => match[1]
  ).filter((value): value is string => Boolean(value))

const commandMayWrite = (command: string): boolean =>
  /(^|[;|&]\s*|\s)(?:rm|mv|cp|touch|mkdir|rmdir|tee|dd|install)\b|(?:>|>>|\bsed\s+-i\b)/.test(
    command
  )

const loadGrants = async (workspacePath: string): Promise<WorkspaceFileGrant[]> => {
  const { listWorkspaceSandboxGrants } = await import('../db/config-db.ts')
  return listWorkspaceSandboxGrants(workspacePath).map((grant) => ({
    path: grant.granted_path,
    access: grant.access_mode
  }))
}

const requestCommandPathGrants = async (
  workspacePath: string,
  command: string,
  grantLoader: (workspacePath: string) => Promise<WorkspaceFileGrant[]> = loadGrants
): Promise<void> => {
  const access: FileAccessMode = commandMayWrite(command) ? 'write' : 'read'
  for (const candidate of absolutePathsInCommand(command)) {
    const sandbox = new WorkspaceSandbox({
      workspacePath,
      mode: 'sandbox',
      grants: await grantLoader(workspacePath)
    })
    const decision = sandbox.decideFileAccess(candidate, access)
    if (
      decision.allowed ||
      systemReadPaths.some(
        (systemPath) =>
          decision.resolvedPath === systemPath || decision.resolvedPath.startsWith(`${systemPath}/`)
      )
    ) {
      continue
    }
    const approved = await createNativeWorkspacePermissionBroker().requestAccess({
      workspacePath,
      targetPath: decision.resolvedPath,
      access,
      source: 'bash'
    })
    if (!approved) throw new Error(`Sandbox access was denied for: ${decision.resolvedPath}`)
  }
}

export const createSandboxedBashOperations = (
  workspacePath: string,
  grantLoader: (workspacePath: string) => Promise<WorkspaceFileGrant[]> = loadGrants
): BashOperations => ({
  exec: async (command, cwd, { onData, signal, timeout }) => {
    await requestCommandPathGrants(workspacePath, command, grantLoader)
    await initializeSandboxRuntime()
    const { argv, env } = await SandboxManager.wrapWithSandboxArgv(
      command,
      '/bin/bash',
      createCommandConfig(workspacePath, await grantLoader(workspacePath)),

      signal,
      cwd
    )
    if (argv.length === 0) throw new Error('Sandbox runtime returned no command to execute')

    return await new Promise<{ exitCode: number | null }>((resolve, reject) => {
      const child = spawn(argv[0], argv.slice(1), {
        cwd,
        detached: process.platform !== 'win32',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      let timer: NodeJS.Timeout | undefined
      const onAbort = () => kill(child)
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        SandboxManager.cleanupAfterCommand()
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.once('error', (error) => {
        cleanup()
        reject(error)
      })
      child.once('close', (code) => {
        cleanup()
        if (signal?.aborted) return reject(new Error('aborted'))
        resolve({ exitCode: code })
      })
      if (signal) {
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
      if (timeout) {
        timer = setTimeout(() => {
          kill(child)
          reject(new Error(`timeout:${timeout}`))
        }, timeout * 1000)
      }
    })
  }
})
