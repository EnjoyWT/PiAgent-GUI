import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const repoRoot = resolve(import.meta.dirname, '../../..')

test('MCP SDK runtime dependencies are declared for Electron packaging', () => {
  const appPackageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const sdkPackageJson = JSON.parse(
    readFileSync(resolve(repoRoot, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8')
  ) as { dependencies?: Record<string, string> }

  const appDependencies = appPackageJson.dependencies ?? {}
  const sdkDependencies = sdkPackageJson.dependencies ?? {}
  const missingDependencies = Object.keys(sdkDependencies)
    .filter((dependencyName) => !(dependencyName in appDependencies))
    .sort()

  assert.deepEqual(missingDependencies, [])
})
