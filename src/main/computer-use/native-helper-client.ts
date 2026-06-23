import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import electron from 'electron'
import type { ComputerUseAction, ComputerUseRequest } from './computer-use-types.ts'

const { app } = electron as typeof import('electron')

const helperAppName = 'PiAgent Computer Use.app'
const helperExecutableName = 'PiAgentComputerUseHelper'
const helperResourceParts = ['computer-use-helper', 'mac']

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export const createComputerUseHelperCandidates = (paths: {
  resourcesPath?: string
  appPath: string
  cwd: string
}): string[] => {
  const resourceCandidate = (basePath: string | undefined, bundled: boolean): string | null => {
    if (!basePath) return null
    return path.join(
      basePath,
      ...helperResourceParts,
      ...(bundled ? [helperAppName, 'Contents', 'MacOS'] : []),
      helperExecutableName
    )
  }

  return Array.from(
    new Set(
      [
        resourceCandidate(paths.resourcesPath, true),
        resourceCandidate(paths.resourcesPath, false),
        resourceCandidate(path.join(paths.appPath, 'resources'), true),
        resourceCandidate(path.join(paths.appPath, 'resources'), false),
        resourceCandidate(path.join(paths.cwd, 'resources'), true),
        resourceCandidate(path.join(paths.cwd, 'resources'), false),
        path.join(
          paths.cwd,
          'native',
          'computer-use-helper',
          'mac',
          '.build',
          'release',
          helperExecutableName
        ),
        path.join(
          paths.cwd,
          'native',
          'computer-use-helper',
          'mac',
          '.build',
          'debug',
          helperExecutableName
        )
      ].filter((candidate): candidate is string => Boolean(candidate))
    )
  )
}

const helperCandidates = (): string[] => {
  const appPath = app.getAppPath()
  return createComputerUseHelperCandidates({
    resourcesPath: process.resourcesPath,
    appPath,
    cwd: process.cwd()
  })
}

export const resolveComputerUseHelperPath = (): string | null =>
  helperCandidates().find((candidate) => existsSync(candidate)) ?? null

export class NativeHelperClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private stdoutBuffer = ''
  private readonly pending = new Map<number, PendingRequest>()

  async request(action: ComputerUseAction, params: ComputerUseRequest): Promise<unknown> {
    const child = this.ensureStarted()
    const id = this.nextId++
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id)
          reject(new Error(`Computer Use helper request timed out: ${action}`))
        },
        Math.max(1_000, params.timeoutMs ?? 30_000)
      )

      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, method: action, params })}\n`, (error) => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  dispose(): void {
    const child = this.process
    this.process = null
    if (child && !child.killed) child.kill()
    this.rejectAll(new Error('Computer Use helper disposed.'))
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) return this.process
    const helperPath = resolveComputerUseHelperPath()
    if (!helperPath) {
      throw new Error(
        'Computer Use native helper is not installed. Run npm run build:computer-use-helper on macOS.'
      )
    }

    const child = spawn(helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.process = child
    this.stdoutBuffer = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.handleStdout(String(chunk)))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) console.warn('[computer-use-helper]', text)
    })
    child.on('error', (error) => {
      this.process = null
      this.rejectAll(error)
    })
    child.on('exit', (code, signal) => {
      this.process = null
      this.rejectAll(new Error(`Computer Use helper exited (${code ?? signal ?? 'unknown'}).`))
    })

    return child
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    while (true) {
      const index = this.stdoutBuffer.indexOf('\n')
      if (index < 0) return
      const line = this.stdoutBuffer.slice(0, index).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1)
      if (line) this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      console.warn('[computer-use-helper] Non-JSON response:', line)
      return
    }
    if (!parsed || typeof parsed !== 'object') return
    const id = Number((parsed as Record<string, unknown>).id)
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)

    const error = (parsed as Record<string, unknown>).error
    if (typeof error === 'string' && error) {
      pending.reject(new Error(error))
      return
    }
    pending.resolve((parsed as Record<string, unknown>).result)
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

let nativeHelperClientSingleton: NativeHelperClient | null = null

export const getNativeHelperClient = (): NativeHelperClient => {
  if (nativeHelperClientSingleton) return nativeHelperClientSingleton
  nativeHelperClientSingleton = new NativeHelperClient()
  return nativeHelperClientSingleton
}
