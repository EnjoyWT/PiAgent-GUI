import { existsSync, realpathSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type SandboxMode = 'sandbox' | 'full'
export type FileAccessMode = 'read' | 'write'
export type FileAccessDecision =
  | { allowed: true; reason: 'full_mode' | 'workspace' | 'grant'; resolvedPath: string }
  | { allowed: false; reason: 'outside_workspace'; resolvedPath: string }

export type WorkspaceFileGrant = {
  path: string
  access: FileAccessMode
}

const normalizeAbsolutePath = (value: string): string => path.resolve(value)

export const realpathForCandidate = (candidate: string): string => {
  let current = normalizeAbsolutePath(candidate)
  const missingSegments: string[] = []
  while (!existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    missingSegments.unshift(path.basename(current))
    current = parent
  }

  const resolved = existsSync(current) ? realpathSync.native(current) : current
  return missingSegments.reduce((result, segment) => path.join(result, segment), resolved)
}

const isWithin = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

const grantAllows = (
  grant: WorkspaceFileGrant,
  candidate: string,
  access: FileAccessMode
): boolean =>
  (grant.access === 'write' || access === 'read') &&
  isWithin(realpathForCandidate(grant.path), candidate)

export class WorkspaceSandbox {
  readonly workspacePath: string
  readonly mode: SandboxMode
  private readonly grants: WorkspaceFileGrant[]

  constructor(input: { workspacePath: string; mode: SandboxMode; grants?: WorkspaceFileGrant[] }) {
    this.workspacePath = realpathForCandidate(input.workspacePath)
    this.mode = input.mode
    this.grants = input.grants ?? []
  }

  decideFileAccess(candidatePath: string, access: FileAccessMode): FileAccessDecision {
    const resolvedPath = realpathForCandidate(candidatePath)
    if (this.mode === 'full') return { allowed: true, reason: 'full_mode', resolvedPath }
    if (isWithin(this.workspacePath, resolvedPath)) {
      return { allowed: true, reason: 'workspace', resolvedPath }
    }
    if (this.grants.some((grant) => grantAllows(grant, resolvedPath, access))) {
      return { allowed: true, reason: 'grant', resolvedPath }
    }
    return { allowed: false, reason: 'outside_workspace', resolvedPath }
  }
}

export const normalizeWorkspaceSandboxPath = (workspacePath: string): string =>
  realpathForCandidate(workspacePath)

export function normalizeExternalSandboxGrant(workspacePath: string, grantedPath: string): string {
  const resolvedWorkspace = normalizeWorkspaceSandboxPath(workspacePath)
  const resolvedGrant = realpathForCandidate(grantedPath)
  if (isWithin(resolvedWorkspace, resolvedGrant)) {
    throw new Error('Sandbox grants must point outside the workspace')
  }
  return resolvedGrant
}

export interface WorkspaceSandboxManifest {
  requestedGrants: Array<{
    path: string
    resolvedPath: string
    access: FileAccessMode
  }>
}

export function readProjectSandboxManifest(workspacePath: string): WorkspaceSandboxManifest | null {
  const manifestPath = path.join(workspacePath, '.pi', 'piagent-sandbox.json')
  if (!existsSync(manifestPath)) {
    return null
  }
  try {
    const content = readFileSync(manifestPath, 'utf8')
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') return null

    const requestedGrants: WorkspaceSandboxManifest['requestedGrants'] = []
    if (Array.isArray(parsed.requestedGrants)) {
      for (const entry of parsed.requestedGrants) {
        if (entry && typeof entry === 'object' && typeof entry.path === 'string') {
          const rawPath = entry.path
          const access = entry.access === 'write' ? 'write' : 'read'
          try {
            const resolvedPath = normalizeExternalSandboxGrant(
              workspacePath,
              path.resolve(workspacePath, rawPath)
            )
            requestedGrants.push({
              path: rawPath,
              resolvedPath,
              access
            })
          } catch {
            // A repository manifest may suggest paths, but it cannot grant access to the
            // workspace itself or otherwise bypass the runtime boundary.
          }
        }
      }
    }
    return { requestedGrants }
  } catch (err) {
    console.error('Failed to read or parse .pi/piagent-sandbox.json:', err)
    return null
  }
}
