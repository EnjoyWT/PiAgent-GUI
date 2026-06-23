import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { inspect } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { discoverExternalPluginModules } from '../../../src/main/plugin-system/external-plugin-loader.ts'
import { PluginHost } from '../../../src/main/plugin-system/plugin-host.ts'
import {
  createConsolePluginLogger,
  validatePluginManifest
} from '../../../src/main/plugin-system/plugin-types.ts'

test('plugin manifest validation rejects unsupported api versions', () => {
  assert.throws(
    () =>
      validatePluginManifest({
        id: 'bad',
        kind: 'transport',
        apiVersion: '2',
        version: '0.1.0',
        displayName: 'Bad'
      }),
    /Unsupported plugin apiVersion/
  )
})

test('console plugin logger redacts Telegram bot tokens in metadata', () => {
  const token = '123456789:ABCdefGHI-secret_token'
  const originalConsoleError = console.error
  const calls: unknown[][] = []
  console.error = (...args: unknown[]) => {
    calls.push(args)
  }

  try {
    createConsolePluginLogger('telegram').error('Telegram polling failed', {
      error: new Error(`request to https://api.telegram.org/bot${token}/getUpdates failed`)
    })
  } finally {
    console.error = originalConsoleError
  }

  const rendered = calls
    .flat()
    .map((arg) => inspect(arg, { depth: 10 }))
    .join('\n')
  assert.match(rendered, /Telegram polling failed/)
  assert.equal(rendered.includes(token), false)
  assert.match(rendered, /\[REDACTED_TELEGRAM_BOT_TOKEN\]/)
})

test('plugin host discovers and activates builtin plugin modules', async () => {
  const host = new PluginHost<{ value: number }>({ kind: 'transport' })

  host.discoverBuiltin({
    manifest: {
      id: 'test-transport',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Test Transport'
    },
    register: () => ({ value: 42 })
  })

  const plugin = await host.activate('test-transport')
  const registrations = host.list()

  assert.equal(plugin.value, 42)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0]?.state, 'activated')
})

test('plugin manifest validation accepts empty transport contribution metadata', () => {
  const manifest = validatePluginManifest({
    id: 'external-transport',
    kind: 'transport',
    apiVersion: '1',
    version: '0.1.0',
    displayName: 'External Transport',
    entry: './dist/index.mjs',
    contributes: {
      transport: {}
    }
  })

  assert.deepEqual(manifest.contributes?.transport, {})
})

test('plugin manifest validation accepts transport settings schema metadata', () => {
  const manifest = validatePluginManifest({
    id: 'external-transport',
    kind: 'transport',
    apiVersion: '1',
    version: '0.1.0',
    displayName: 'External Transport',
    entry: './dist/index.mjs',
    contributes: {
      settings: {
        scope: 'transport_account',
        supportsMultipleAccounts: true,
        fields: [
          {
            key: 'appId',
            type: 'text',
            label: 'App ID',
            required: true
          },
          {
            key: 'appSecret',
            type: 'secret',
            label: 'App Secret',
            required: true
          }
        ]
      }
    }
  })

  assert.equal(manifest.contributes?.settings?.scope, 'transport_account')
  assert.equal(manifest.contributes?.settings?.supportsMultipleAccounts, true)
  assert.equal(manifest.contributes?.settings?.fields.length, 2)
  assert.equal(manifest.contributes?.settings?.fields[0]?.key, 'appId')
  assert.equal(manifest.contributes?.settings?.fields[1]?.type, 'secret')
})

test('plugin manifest validation preserves transport account setup methods', () => {
  const manifest = validatePluginManifest({
    id: 'wechat',
    kind: 'transport',
    apiVersion: '1',
    version: '0.1.0',
    displayName: 'WeChat',
    entry: './dist/index.mjs',
    contributes: {
      settings: {
        scope: 'transport_account',
        supportsMultipleAccounts: false,
        setupMethods: [
          {
            id: 'wechat_qr_login',
            kind: 'qr',
            label: '扫码登录',
            description: '使用微信扫描二维码完成 iLink 登录。',
            recommended: true,
            outputConfigKeys: ['accountExternalId', 'baseUrl', 'userId'],
            outputSecretKeys: ['token']
          },
          {
            id: 'manual_ilink_config',
            kind: 'form',
            label: '手动填写 iLink 配置',
            fields: ['accountExternalId', 'token', 'baseUrl']
          }
        ],
        fields: [
          {
            key: 'accountExternalId',
            type: 'text',
            label: 'iLink Bot ID',
            required: true
          },
          {
            key: 'token',
            type: 'secret',
            label: 'iLink Bot Token',
            required: true
          }
        ]
      }
    }
  })

  const setupMethods = (manifest.contributes?.settings as any)?.setupMethods ?? []
  assert.equal(setupMethods.length, 2)
  assert.equal(setupMethods[0]?.id, 'wechat_qr_login')
  assert.equal(setupMethods[0]?.kind, 'qr')
  assert.equal(setupMethods[0]?.recommended, true)
  assert.deepEqual(setupMethods[0]?.outputSecretKeys, ['token'])
  assert.equal(setupMethods[1]?.kind, 'form')
  assert.deepEqual(setupMethods[1]?.fields, ['accountExternalId', 'token', 'baseUrl'])
})

test('external plugin loader discovers manifest and injects plugin context', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-plugin-host-'))
  const pluginRoot = path.join(tempRoot, '@acme', 'transport-example')
  mkdirSync(path.join(pluginRoot, '.piagent-plugin'), { recursive: true })
  mkdirSync(path.join(pluginRoot, 'dist'), { recursive: true })
  writeFileSync(
    path.join(pluginRoot, '.piagent-plugin', 'plugin.json'),
    JSON.stringify({
      id: 'external-example',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'External Example',
      entry: './dist/index.mjs'
    }),
    'utf8'
  )
  writeFileSync(
    path.join(pluginRoot, 'dist', 'index.mjs'),
    `
      export const register = async (ctx) => ({
        seenContext: {
          pluginId: ctx.pluginId,
          sourceKind: ctx.sourceKind,
          pluginRootDir: ctx.pluginRootDir,
          pluginConfigDir: ctx.pluginConfigDir,
          appConfigDir: ctx.appConfigDir
        }
      })
    `,
    'utf8'
  )

  try {
    const discovered = await discoverExternalPluginModules<{
      seenContext: Record<string, string | undefined>
    }>({
      kind: 'transport',
      directories: [tempRoot]
    })

    assert.equal(discovered.length, 1)
    assert.equal(discovered[0]?.manifest.id, 'external-example')

    const plugin = await discovered[0]!.module.register({
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      }
    })

    assert.equal(plugin.seenContext.pluginId, 'external-example')
    assert.equal(plugin.seenContext.sourceKind, 'user')
    assert.equal(plugin.seenContext.pluginRootDir, pluginRoot)
    assert.match(String(plugin.seenContext.pluginConfigDir ?? ''), /plugin-data/)
    assert.match(String(plugin.seenContext.appConfigDir ?? ''), /piagent/)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
