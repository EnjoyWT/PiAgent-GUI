import path from 'node:path'
import { defineConfig } from '@playwright/test'

const repoRoot = process.cwd()

export default defineConfig({
  testDir: path.join(repoRoot, 'tests/e2e/specs'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  expect: {
    timeout: 10_000
  },
  reporter: [
    ['list'],
    [
      'html',
      {
        open: 'never',
        outputFolder: path.join(repoRoot, 'playwright-report/e2e')
      }
    ]
  ],
  outputDir: path.join(repoRoot, 'test-results/e2e'),
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  }
})
