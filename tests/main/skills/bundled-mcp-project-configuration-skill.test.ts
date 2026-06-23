import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../../..')
const skillPath = resolve(repoRoot, 'resources/skills/mcp-project-configuration/SKILL.md')

test('bundles an MCP project configuration skill with current PiAgent install guidance', () => {
  assert.equal(existsSync(skillPath), true)

  const skill = readFileSync(skillPath, 'utf8')
  assert.match(skill, /^name:\s*mcp-project-configuration$/m)
  assert.match(skill, /^description:\s*Use when .*MCP/m)
  assert.match(skill, /piagent mcp install-preset/)
  assert.doesNotMatch(skill, /sqlite3|config\.db|mcp_servers|workspace_mcp_servers/)
  assert.doesNotMatch(
    skill,
    /playwright|filesystem|context7|github-remote|@modelcontextprotocol|@playwright|mcp\.context7|api\.githubcopilot/i
  )
  assert.doesNotMatch(skill, /Recommended Servers|Current Project Shortlist/)
})
