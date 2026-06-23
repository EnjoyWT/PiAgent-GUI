import { execFile } from 'node:child_process'

export type SystemCommandResult = {
  stdout: string
  stderr: string
}

export type SystemCommandOptions = {
  timeoutMs?: number
  maxBufferBytes?: number
}

export type SystemCommandRunner = (
  command: string,
  args: string[],
  options?: SystemCommandOptions
) => Promise<SystemCommandResult>

export const runSystemCommand: SystemCommandRunner = async (command, args, options = {}) =>
  await new Promise<SystemCommandResult>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: options.timeoutMs ?? 3000,
        maxBuffer: options.maxBufferBytes ?? 256 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
