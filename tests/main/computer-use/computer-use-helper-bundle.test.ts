import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createHelperAppBundle,
  createHelperInfoPlist,
  DEFAULT_HELPER_APP_NAME,
  DEFAULT_HELPER_BUNDLE_ID,
  DEFAULT_HELPER_EXECUTABLE_NAME
} from '../../../scripts/computer-use-helper-bundle.mjs'
import { createComputerUseHelperCandidates } from '../../../src/main/computer-use/native-helper-client.ts'

test('createHelperInfoPlist describes an LSUIElement helper with TCC usage strings', () => {
  const plist = createHelperInfoPlist()

  assert.match(
    plist,
    new RegExp(`<key>CFBundleIdentifier</key>\\s*<string>${DEFAULT_HELPER_BUNDLE_ID}</string>`)
  )
  assert.match(
    plist,
    new RegExp(
      `<key>CFBundleExecutable</key>\\s*<string>${DEFAULT_HELPER_EXECUTABLE_NAME}</string>`
    )
  )
  assert.match(
    plist,
    new RegExp(`<key>CFBundleDisplayName</key>\\s*<string>${DEFAULT_HELPER_APP_NAME}</string>`)
  )
  assert.match(plist, /<key>LSUIElement<\/key>\s*<true\/>/)
  assert.match(plist, /<key>LSMinimumSystemVersion<\/key>\s*<string>13.0<\/string>/)
  assert.match(plist, /<key>NSAccessibilityUsageDescription<\/key>/)
  assert.match(plist, /<key>NSScreenCaptureUsageDescription<\/key>/)
  assert.match(plist, /<key>NSAppleEventsUsageDescription<\/key>/)
})

test('createHelperAppBundle copies the helper executable into a deterministic app bundle', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'piagent-cu-helper-'))
  const executablePath = path.join(tempDir, 'PiAgentComputerUseHelper')
  const outputDir = path.join(tempDir, 'out')

  try {
    writeFileSync(executablePath, '#!/bin/sh\nexit 0\n')

    const appPath = createHelperAppBundle({
      executablePath,
      outputDir
    })

    const bundledExecutable = path.join(
      appPath,
      'Contents',
      'MacOS',
      DEFAULT_HELPER_EXECUTABLE_NAME
    )
    const infoPlist = path.join(appPath, 'Contents', 'Info.plist')

    assert.equal(appPath, path.join(outputDir, `${DEFAULT_HELPER_APP_NAME}.app`))
    assert.equal(existsSync(bundledExecutable), true)
    assert.equal(existsSync(infoPlist), true)
    assert.equal(readFileSync(path.join(appPath, 'Contents', 'PkgInfo'), 'utf8'), 'APPL????')
    assert.match(readFileSync(infoPlist, 'utf8'), /<key>LSUIElement<\/key>\s*<true\/>/)
    assert.equal((statSync(bundledExecutable).mode & 0o100) !== 0, true)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('createComputerUseHelperCandidates prefers the app-bundled helper executable', () => {
  const candidates = createComputerUseHelperCandidates({
    resourcesPath: '/Applications/PiAgent.app/Contents/Resources',
    appPath: '<piagent-repo>',
    cwd: '<piagent-repo>'
  })

  assert.equal(
    candidates[0],
    '/Applications/PiAgent.app/Contents/Resources/computer-use-helper/mac/PiAgent Computer Use.app/Contents/MacOS/PiAgentComputerUseHelper'
  )
  assert.equal(
    candidates[1],
    '/Applications/PiAgent.app/Contents/Resources/computer-use-helper/mac/PiAgentComputerUseHelper'
  )
})
