import fs from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import type { E2ERuntimePaths } from '../support/runtime-paths'
import {
  seedHistoryThread,
  type SeededHistoryThread,
  type SeedHistoryThreadOptions
} from '../support/chat-seed'

type SeedThreadInput = Omit<SeedHistoryThreadOptions, 'workspacePath'> & {
  workspaceDirName?: string
}

const sanitizePathSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace'

export class AppShellPage {
  constructor(
    private readonly page: Page,
    private readonly runtimePaths: E2ERuntimePaths
  ) {}

  readonly shell = this.page.getByTestId('app-shell')

  async waitUntilReady(): Promise<void> {
    await this.shell.waitFor()
    await this.page.waitForLoadState('domcontentloaded')
  }

  async reload(): Promise<void> {
    await this.page.reload()
    await this.waitUntilReady()
  }

  async seedHistoryThread(input: SeedThreadInput): Promise<SeededHistoryThread> {
    const workspaceDirName = input.workspaceDirName ?? sanitizePathSegment(input.threadTitle)
    const workspacePath = path.join(this.runtimePaths.workspaceRoot, workspaceDirName)
    await fs.mkdir(workspacePath, { recursive: true })
    return await seedHistoryThread(this.page, {
      ...input,
      workspacePath
    })
  }
}
