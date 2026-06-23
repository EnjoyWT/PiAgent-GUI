/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  adHocSignAppBundle,
  createMacAppBundle,
  escapePlistValue
} from './computer-use-helper-bundle.mjs'

const APP_NAME = 'PiAgent EchoApp'
const BUNDLE_ID = 'com.piagent.computer-use.echo'
const EXECUTABLE_NAME = 'PiAgentEchoApp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'native', 'computer-use-helper', 'mac', 'EchoApp', 'main.swift')
const buildDir = path.join(root, 'native', 'computer-use-helper', 'mac', '.build', 'verification')
const executablePath = path.join(buildDir, EXECUTABLE_NAME)
const outputDir = path.join(root, 'resources', 'computer-use-helper', 'verification')
const isMac = process.platform === 'darwin'

function createEchoInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${escapePlistValue(APP_NAME)}</string>
  <key>CFBundleExecutable</key>
  <string>${escapePlistValue(EXECUTABLE_NAME)}</string>
  <key>CFBundleIdentifier</key>
  <string>${escapePlistValue(BUNDLE_ID)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${escapePlistValue(APP_NAME)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleSignature</key>
  <string>????</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`
}

if (!isMac) {
  console.log('Skipping Computer Use EchoApp build: macOS only.')
  process.exit(0)
}

mkdirSync(buildDir, { recursive: true })
mkdirSync(outputDir, { recursive: true })

const build = spawnSync('xcrun', ['swiftc', sourcePath, '-o', executablePath], {
  cwd: root,
  stdio: 'inherit'
})

if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

const appPath = createMacAppBundle({
  appName: APP_NAME,
  executableName: EXECUTABLE_NAME,
  executablePath,
  outputDir,
  infoPlist: createEchoInfoPlist()
})
const signResult = adHocSignAppBundle(appPath)

console.log(`Computer Use EchoApp created at ${appPath}`)
if (!signResult.ok) {
  console.warn('Computer Use EchoApp was not ad-hoc signed.')
}
