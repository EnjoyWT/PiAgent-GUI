import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { adHocSignAppBundle, createHelperAppBundle } from './computer-use-helper-bundle.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const helperDir = path.join(root, 'native', 'computer-use-helper', 'mac')
const outputDir = path.join(root, 'resources', 'computer-use-helper', 'mac')
const isMac = process.platform === 'darwin'

mkdirSync(outputDir, { recursive: true })

if (!isMac) {
  console.log('Skipping Computer Use helper build: macOS only.')
  process.exit(0)
}

const build = spawnSync('swift', ['build', '-c', 'release'], {
  cwd: helperDir,
  stdio: 'inherit'
})

if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

const outputPath = path.join(outputDir, 'PiAgentComputerUseHelper')
copyFileSync(path.join(helperDir, '.build', 'release', 'PiAgentComputerUseHelper'), outputPath)
chmodSync(outputPath, 0o755)

const appPath = createHelperAppBundle({
  executablePath: outputPath,
  outputDir
})
const signResult = adHocSignAppBundle(appPath)

console.log(`Computer Use helper copied to ${outputPath}`)
console.log(`Computer Use helper app created at ${appPath}`)
if (!signResult.ok) {
  console.warn(
    'Computer Use helper app was not ad-hoc signed; TCC may treat rebuilt copies as different clients.'
  )
}
