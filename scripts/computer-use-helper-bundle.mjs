/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

export const DEFAULT_HELPER_APP_NAME = 'PiAgent Computer Use'
export const DEFAULT_HELPER_BUNDLE_ID = 'com.piagent.computer-use'
export const DEFAULT_HELPER_EXECUTABLE_NAME = 'PiAgentComputerUseHelper'

const DEFAULT_MINIMUM_SYSTEM_VERSION = '13.0'

const DEFAULT_USAGE_DESCRIPTIONS = {
  accessibility:
    'PiAgent Computer Use needs Accessibility access to inspect and control application windows at your request.',
  screenCapture:
    'PiAgent Computer Use captures application windows so it can understand the current screen state at your request.',
  appleEvents:
    'PiAgent Computer Use may send Apple Events to raise or inspect application windows at your request.'
}

export function escapePlistValue(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function createHelperInfoPlist(options = {}) {
  const appName = options.appName ?? DEFAULT_HELPER_APP_NAME
  const bundleId = options.bundleId ?? DEFAULT_HELPER_BUNDLE_ID
  const executableName = options.executableName ?? DEFAULT_HELPER_EXECUTABLE_NAME
  const minimumSystemVersion = options.minimumSystemVersion ?? DEFAULT_MINIMUM_SYSTEM_VERSION
  const usage = {
    ...DEFAULT_USAGE_DESCRIPTIONS,
    ...(options.usageDescriptions ?? {})
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${escapePlistValue(appName)}</string>
  <key>CFBundleExecutable</key>
  <string>${escapePlistValue(executableName)}</string>
  <key>CFBundleIdentifier</key>
  <string>${escapePlistValue(bundleId)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${escapePlistValue(appName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleSignature</key>
  <string>????</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>${escapePlistValue(minimumSystemVersion)}</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSAccessibilityUsageDescription</key>
  <string>${escapePlistValue(usage.accessibility)}</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>${escapePlistValue(usage.appleEvents)}</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>${escapePlistValue(usage.screenCapture)}</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`
}

export function createMacAppBundle(options) {
  const appName = options.appName
  const executableName = options.executableName
  const executablePath = options.executablePath
  const outputDir = options.outputDir
  const appPath = path.join(outputDir, `${appName}.app`)
  const contentsPath = path.join(appPath, 'Contents')
  const macOSPath = path.join(contentsPath, 'MacOS')
  const resourcesPath = path.join(contentsPath, 'Resources')
  const bundledExecutablePath = path.join(macOSPath, executableName)

  rmSync(appPath, { recursive: true, force: true })
  mkdirSync(macOSPath, { recursive: true })
  mkdirSync(resourcesPath, { recursive: true })

  copyFileSync(executablePath, bundledExecutablePath)
  chmodSync(bundledExecutablePath, 0o755)
  writeFileSync(path.join(contentsPath, 'Info.plist'), options.infoPlist)
  writeFileSync(path.join(contentsPath, 'PkgInfo'), 'APPL????')

  return appPath
}

export function createHelperAppBundle(options) {
  const appName = options.appName ?? DEFAULT_HELPER_APP_NAME
  const bundleId = options.bundleId ?? DEFAULT_HELPER_BUNDLE_ID
  const executableName = options.executableName ?? DEFAULT_HELPER_EXECUTABLE_NAME

  return createMacAppBundle({
    appName,
    executableName,
    executablePath: options.executablePath,
    outputDir: options.outputDir,
    infoPlist: createHelperInfoPlist({
      appName,
      bundleId,
      executableName,
      minimumSystemVersion: options.minimumSystemVersion,
      usageDescriptions: options.usageDescriptions
    })
  })
}

export function adHocSignAppBundle(appPath, options = {}) {
  const result = spawnSync(
    options.codesign ?? 'codesign',
    ['--force', '--deep', '--sign', '-', appPath],
    {
      encoding: 'utf8',
      stdio: options.stdio ?? 'pipe'
    }
  )

  if (result.status === 0) {
    return { ok: true, status: 0 }
  }

  if (options.strict) {
    throw new Error(
      result.stderr || result.stdout || `codesign failed with status ${result.status}`
    )
  }

  return {
    ok: false,
    status: result.status ?? 1,
    stderr: result.stderr,
    stdout: result.stdout
  }
}
