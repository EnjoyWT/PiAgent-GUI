import fs from 'node:fs/promises'
import { test as base, expect, type Page } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { AppShellPage } from '../pages/app-shell.page'
import { ChatPage } from '../pages/chat.page'
import { SidebarPage } from '../pages/sidebar.page'
import { builtMainEntry, repoRoot } from '../support/paths'
import { createE2ERuntimePaths, type E2ERuntimePaths } from '../support/runtime-paths'

type Fixtures = {
  electronApp: ElectronApplication
  page: Page
  runtimePaths: E2ERuntimePaths
  appShell: AppShellPage
  sidebarPage: SidebarPage
  chatPage: ChatPage
}

const assertBuiltElectronApp = async (): Promise<void> => {
  try {
    await fs.access(builtMainEntry)
  } catch {
    throw new Error(
      `Built Electron entry not found at ${builtMainEntry}. Run "npm run build" first.`
    )
  }
}

export const test = base.extend<Fixtures>({
  runtimePaths: async ({}, use, testInfo) => {
    const paths = await createE2ERuntimePaths(testInfo)
    await use(paths)
  },

  electronApp: async ({ runtimePaths }, use) => {
    await assertBuiltElectronApp()

    const electronApp = await electron.launch({
      args: [repoRoot],
      cwd: repoRoot,
      env: {
        ...process.env,
        PIAGENT_E2E: '1',
        PIAGENT_USER_DATA_DIR: runtimePaths.userDataDir
      }
    })

    try {
      await use(electronApp)
    } finally {
      await electronApp.close()
    }
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  },

  appShell: async ({ page, runtimePaths }, use) => {
    const appShell = new AppShellPage(page, runtimePaths)
    await appShell.waitUntilReady()
    await use(appShell)
  },

  sidebarPage: async ({ page }, use) => {
    await use(new SidebarPage(page))
  },

  chatPage: async ({ page }, use) => {
    await use(new ChatPage(page))
  }
})

export { expect }
