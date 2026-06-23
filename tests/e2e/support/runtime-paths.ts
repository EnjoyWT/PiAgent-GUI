import fs from 'node:fs/promises'
import path from 'node:path'
import type { TestInfo } from '@playwright/test'

export type E2ERuntimePaths = {
  runtimeRoot: string
  userDataDir: string
  workspaceRoot: string
}

export async function createE2ERuntimePaths(testInfo: TestInfo): Promise<E2ERuntimePaths> {
  const runtimeRoot = path.join(testInfo.outputDir, 'runtime')
  const userDataDir = path.join(runtimeRoot, 'user-data')
  const workspaceRoot = path.join(runtimeRoot, 'workspaces')

  await fs.mkdir(userDataDir, { recursive: true })
  await fs.mkdir(workspaceRoot, { recursive: true })

  return {
    runtimeRoot,
    userDataDir,
    workspaceRoot
  }
}
