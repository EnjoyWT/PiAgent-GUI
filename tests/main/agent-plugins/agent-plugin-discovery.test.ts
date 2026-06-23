import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  discoverAgentPlugins,
  resolveAgentPluginSkillPaths
} from '../../../src/main/agent-plugins/agent-plugin-discovery.ts'

const writeJson = (filePath: string, value: unknown): void => {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

test('discovers native PiAgent agent plugins and resolves declared skill paths', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-agent-plugin-'))

  try {
    const pluginRoot = path.join(tempRoot, 'github-review')
    mkdirSync(path.join(pluginRoot, 'skills', 'code-review'), { recursive: true })
    writeFileSync(
      path.join(pluginRoot, 'skills', 'code-review', 'SKILL.md'),
      '---\nname: code-review\ndescription: Review code\n---\n',
      'utf8'
    )
    writeJson(path.join(pluginRoot, '.piagent-agent-plugin', 'plugin.json'), {
      id: 'github-review',
      domain: 'agent-plugin',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'GitHub Review',
      components: {
        skills: './skills'
      }
    })

    const result = discoverAgentPlugins({ directories: [tempRoot] })

    assert.equal(result.plugins.length, 1)
    assert.equal(result.plugins[0]?.manifest.id, 'github-review')
    assert.deepEqual(resolveAgentPluginSkillPaths(result.plugins[0]!), [
      path.join(pluginRoot, 'skills')
    ])
    assert.deepEqual(result.diagnostics, [])
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('routes legacy transport manifests away from agent plugins', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-agent-plugin-'))

  try {
    const pluginRoot = path.join(tempRoot, 'feishu')
    writeJson(path.join(pluginRoot, '.piagent-plugin', 'plugin.json'), {
      id: 'feishu',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Feishu Transport',
      entry: './dist/index.mjs'
    })

    const result = discoverAgentPlugins({ directories: [tempRoot] })

    assert.equal(result.plugins.length, 0)
    assert.equal(result.diagnostics.length, 1)
    assert.equal(result.diagnostics[0]?.code, 'routed-to-im-transport')
    assert.equal(result.diagnostics[0]?.pluginId, 'feishu')
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('adapts Codex plugin manifests with declared skills path', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-agent-plugin-'))

  try {
    const pluginRoot = path.join(tempRoot, 'codex-review')
    mkdirSync(path.join(pluginRoot, 'skills'), { recursive: true })
    writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
      name: 'codex-review',
      version: '1.2.0',
      description: 'Codex review helpers',
      skills: './skills',
      interface: {
        displayName: 'Codex Review'
      }
    })

    const result = discoverAgentPlugins({ directories: [tempRoot] })

    assert.equal(result.plugins.length, 1)
    assert.equal(result.plugins[0]?.manifest.id, 'codex-review')
    assert.equal(result.plugins[0]?.manifest.displayName, 'Codex Review')
    assert.equal(result.plugins[0]?.manifest.compatibilitySource, 'codex')
    assert.deepEqual(resolveAgentPluginSkillPaths(result.plugins[0]!), [
      path.join(pluginRoot, 'skills')
    ])
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
