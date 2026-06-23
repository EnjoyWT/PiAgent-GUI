import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveSkillSearchPaths } from '../../../src/main/skills/skill-path-service.ts'

const writeJson = (filePath: string, value: unknown): void => {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

test('resolves base skill paths with enabled agent plugin skill paths', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-skill-paths-'))

  try {
    const managedSkillsDir = path.join(tempRoot, 'managed-skills')
    const sharedSkillsDir = path.join(tempRoot, 'shared-skills')
    const extraSkillsDir = path.join(tempRoot, 'extra-skills')
    const pluginRoot = path.join(tempRoot, 'plugins', 'agent-pack')
    const pluginSkillsDir = path.join(pluginRoot, 'skills')
    mkdirSync(managedSkillsDir, { recursive: true })
    mkdirSync(sharedSkillsDir, { recursive: true })
    mkdirSync(extraSkillsDir, { recursive: true })
    mkdirSync(pluginSkillsDir, { recursive: true })
    writeJson(path.join(pluginRoot, '.piagent-agent-plugin', 'plugin.json'), {
      id: 'agent-pack',
      domain: 'agent-plugin',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Agent Pack',
      components: {
        skills: './skills'
      }
    })

    const paths = resolveSkillSearchPaths({
      managedSkillsDir,
      extraDirs: [extraSkillsDir],
      sharedSkillDirs: [sharedSkillsDir],
      pluginDirectories: [path.join(tempRoot, 'plugins')]
    })

    assert.deepEqual(paths, [managedSkillsDir, extraSkillsDir, sharedSkillsDir, pluginSkillsDir])
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('does not include IM transport plugin directories as skill paths', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-skill-paths-'))

  try {
    const managedSkillsDir = path.join(tempRoot, 'managed-skills')
    const pluginRoot = path.join(tempRoot, 'plugins', 'feishu')
    mkdirSync(managedSkillsDir, { recursive: true })
    mkdirSync(path.join(pluginRoot, 'skills'), { recursive: true })
    writeJson(path.join(pluginRoot, '.piagent-plugin', 'plugin.json'), {
      id: 'feishu',
      kind: 'transport',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Feishu Transport',
      entry: './dist/index.mjs'
    })

    const paths = resolveSkillSearchPaths({
      managedSkillsDir,
      sharedSkillDirs: [],
      pluginDirectories: [path.join(tempRoot, 'plugins')]
    })

    assert.deepEqual(paths, [managedSkillsDir])
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('excludes disabled agent plugin skill paths through the component predicate', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'piagent-skill-paths-'))

  try {
    const managedSkillsDir = path.join(tempRoot, 'managed-skills')
    const pluginRoot = path.join(tempRoot, 'plugins', 'agent-pack')
    mkdirSync(managedSkillsDir, { recursive: true })
    mkdirSync(path.join(pluginRoot, 'skills'), { recursive: true })
    writeJson(path.join(pluginRoot, '.piagent-agent-plugin', 'plugin.json'), {
      id: 'agent-pack',
      domain: 'agent-plugin',
      apiVersion: '1',
      version: '0.1.0',
      displayName: 'Agent Pack',
      components: {
        skills: './skills'
      }
    })

    const paths = resolveSkillSearchPaths({
      managedSkillsDir,
      sharedSkillDirs: [],
      pluginDirectories: [path.join(tempRoot, 'plugins')],
      isAgentPluginComponentEnabled: (pluginId, componentType, componentId) =>
        !(pluginId === 'agent-pack' && componentType === 'skills' && componentId === './skills')
    })

    assert.deepEqual(paths, [managedSkillsDir])
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
