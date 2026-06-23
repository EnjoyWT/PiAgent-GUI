import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerPluginsCliModule } from '../../../src/main/cli/modules/plugins-cli-module.ts'
import {
  installExternalPlugin,
  installExternalPluginFromLocalPath,
  installExternalPluginFromPackageSpec
} from '../../../src/main/plugin-system/plugin-management-service.ts'

const createLocalTransportPlugin = (
  rootDir: string,
  options?: { pluginId?: string; body?: string }
): string => {
  const pluginDir = path.join(rootDir, 'local-transport-plugin')
  mkdirSync(path.join(pluginDir, '.piagent-plugin'), { recursive: true })
  mkdirSync(path.join(pluginDir, 'dist'), { recursive: true })

  writeFileSync(
    path.join(pluginDir, '.piagent-plugin', 'plugin.json'),
    JSON.stringify({
      id: options?.pluginId ?? '@acme/transport-local',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Local Transport',
      entry: './dist/index.mjs'
    }),
    'utf8'
  )
  writeFileSync(
    path.join(pluginDir, 'dist', 'index.mjs'),
    options?.body ??
      `
        export const register = async () => ({
          metadata: {
            id: '@acme/transport-local',
            displayName: 'Local Transport',
            version: '0.1.0'
          },
          getCapabilities: () => ({
            canEditMessage: false,
            canStreamByEdit: false,
            canRenderButtons: false,
            canRenderRichCards: false,
            canReplyInThread: true,
            canUploadImage: false,
            canUploadFile: false,
            canCollectStructuredForm: false
          }),
          connect: async () => undefined,
          disconnect: async () => undefined,
          send: async () => ({ status: 'sent', externalMessageId: '1' }),
          onInbound: () => () => undefined
        })
      `,
    'utf8'
  )

  return pluginDir
}

test('plugin management service installs a local transport plugin into the plugins directory', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-plugin-install-'))
  const sourceRoot = path.join(tempRoot, 'source')
  const pluginsRoot = path.join(tempRoot, 'installed')
  mkdirSync(sourceRoot, { recursive: true })

  try {
    const pluginDir = createLocalTransportPlugin(sourceRoot)
    const result = installExternalPluginFromLocalPath({
      sourcePath: pluginDir,
      pluginsDir: pluginsRoot
    })

    assert.equal(result.manifest.id, '@acme/transport-local')
    assert.equal(result.replaced, false)
    assert.equal(result.targetDir, path.join(pluginsRoot, '@acme', 'transport-local'))
    assert.ok(existsSync(path.join(result.targetDir, '.piagent-plugin', 'plugin.json')))
    assert.ok(existsSync(path.join(result.targetDir, 'dist', 'index.mjs')))
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('plugin management service replaces an existing install only when force is enabled', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-plugin-reinstall-'))
  const sourceRoot = path.join(tempRoot, 'source')
  const pluginsRoot = path.join(tempRoot, 'installed')
  mkdirSync(sourceRoot, { recursive: true })

  try {
    const pluginDir = createLocalTransportPlugin(sourceRoot, {
      body: `export const register = async () => ({ version: 'v1' })`
    })

    installExternalPluginFromLocalPath({
      sourcePath: pluginDir,
      pluginsDir: pluginsRoot
    })

    writeFileSync(
      path.join(pluginDir, 'dist', 'index.mjs'),
      `export const register = async () => ({ version: 'v2' })`,
      'utf8'
    )

    assert.throws(
      () =>
        installExternalPluginFromLocalPath({
          sourcePath: pluginDir,
          pluginsDir: pluginsRoot
        }),
      /already installed/
    )

    const replaced = installExternalPluginFromLocalPath({
      sourcePath: pluginDir,
      pluginsDir: pluginsRoot,
      force: true
    })

    assert.equal(replaced.replaced, true)
    assert.match(readFileSync(path.join(replaced.targetDir, 'dist', 'index.mjs'), 'utf8'), /v2/)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('plugins cli install installs a local plugin using cwd-relative paths', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-plugin-cli-'))
  const sourceRoot = path.join(tempRoot, 'workspace')
  const pluginsRoot = path.join(tempRoot, 'plugins-home')
  mkdirSync(sourceRoot, { recursive: true })

  try {
    createLocalTransportPlugin(sourceRoot)
    const handlers = new Map<string, (request: any) => Promise<any>>()
    registerPluginsCliModule({
      register(moduleName, actionName, handler) {
        handlers.set(`${moduleName}:${actionName}`, handler as (request: any) => Promise<any>)
      }
    } as any)

    const installHandler = handlers.get('plugins:install')
    assert.ok(installHandler)

    const result = await installHandler!({
      module: 'plugins',
      action: 'install',
      args: ['./local-transport-plugin'],
      flags: {
        target: pluginsRoot
      },
      cwd: sourceRoot
    })

    assert.equal(result.ok, true)
    assert.match(result.stdout, /Installed transport plugin @acme\/transport-local@0.1.0/)
    assert.ok(existsSync(path.join(pluginsRoot, '@acme', 'transport-local', 'dist', 'index.mjs')))
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('plugin management service installs a package-spec plugin via injected pack/extract helpers', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-plugin-package-'))
  const sourceRoot = path.join(tempRoot, 'source')
  const pluginsRoot = path.join(tempRoot, 'installed')
  mkdirSync(sourceRoot, { recursive: true })

  try {
    const pluginDir = createLocalTransportPlugin(sourceRoot, {
      pluginId: '@acme/transport-package'
    })
    const packedSpecs: string[] = []
    const extractedTarballs: string[] = []

    const result = installExternalPluginFromPackageSpec(
      {
        packageSpec: '@acme/transport-package',
        pluginsDir: pluginsRoot
      },
      {
        packPackage: (packageSpec) => {
          packedSpecs.push(packageSpec)
          return path.join(tempRoot, 'fake.tgz')
        },
        extractPackageTarball: (tarballPath, unpackDir) => {
          extractedTarballs.push(tarballPath)
          const extractedRoot = path.join(unpackDir, 'package')
          mkdirSync(path.dirname(extractedRoot), { recursive: true })
          cpSync(pluginDir, extractedRoot, { recursive: true, force: true })
          return extractedRoot
        }
      }
    )

    assert.deepEqual(packedSpecs, ['@acme/transport-package'])
    assert.deepEqual(extractedTarballs, [path.join(tempRoot, 'fake.tgz')])
    assert.equal(result.installSource, 'package_spec')
    assert.equal(result.sourceReference, '@acme/transport-package')
    assert.equal(result.targetDir, path.join(pluginsRoot, '@acme', 'transport-package'))
    assert.ok(existsSync(path.join(result.targetDir, 'dist', 'index.mjs')))
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('installExternalPlugin auto-detects local paths and package specs', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-plugin-detect-'))
  const sourceRoot = path.join(tempRoot, 'source')
  const pluginsRoot = path.join(tempRoot, 'installed')
  mkdirSync(sourceRoot, { recursive: true })

  try {
    createLocalTransportPlugin(sourceRoot)

    const localResult = installExternalPlugin({
      source: './local-transport-plugin',
      cwd: sourceRoot,
      pluginsDir: pluginsRoot
    })

    assert.equal(localResult.installSource, 'local_path')

    const packageResult = installExternalPlugin(
      {
        source: '@acme/transport-remote',
        pluginsDir: pluginsRoot,
        force: true
      },
      {
        packPackage: () => path.join(tempRoot, 'fake.tgz'),
        extractPackageTarball: (_tarballPath, unpackDir) => {
          const pluginDir = createLocalTransportPlugin(path.join(tempRoot, 'package-source'), {
            pluginId: '@acme/transport-remote'
          })
          const extractedRoot = path.join(unpackDir, 'package')
          mkdirSync(path.dirname(extractedRoot), { recursive: true })
          cpSync(pluginDir, extractedRoot, { recursive: true, force: true })
          return extractedRoot
        }
      }
    )

    assert.equal(packageResult.installSource, 'package_spec')
    assert.equal(packageResult.sourceReference, '@acme/transport-remote')
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
