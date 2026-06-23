import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, extname, resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolve(repoRoot, 'tests/main/runtime-host/electron-stub.mjs')).href
      }
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:')
        ? fileURLToPath(context.parentURL)
        : ''
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) {
        return nextResolve(`${specifier}.ts`, context)
      }
    }
    return nextResolve(specifier, context)
  }
})

const { getImTransportIpcChannelAliases } = await import('../../../src/main/ipc/plugin-handlers.ts')

test('plugin handlers expose IM transport channels separately from legacy plugin channels', () => {
  assert.deepEqual(getImTransportIpcChannelAliases(), [
    ['plugins:list-installed', 'imTransports:listInstalled'],
    ['plugins:get-manifest', 'imTransports:getManifest'],
    ['plugins:set-enabled', 'imTransports:setEnabled'],
    ['plugins:list-transport-accounts', 'imTransports:listAccounts'],
    ['plugins:get-transport-account', 'imTransports:getAccount'],
    ['plugins:save-transport-account', 'imTransports:saveAccount'],
    ['plugins:test-transport-account', 'imTransports:testAccount'],
    ['plugins:list-transport-setup-methods', 'imTransports:listSetupMethods'],
    ['plugins:start-transport-account-setup', 'imTransports:startAccountSetup'],
    ['plugins:cancel-transport-account-setup', 'imTransports:cancelAccountSetup'],
    ['plugins:delete-transport-account', 'imTransports:deleteAccount']
  ])
})
