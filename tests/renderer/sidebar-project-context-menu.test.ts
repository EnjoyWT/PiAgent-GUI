import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

const readSource = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8')

test('AppSidebar opens a project context menu from the workspace header row', () => {
  const source = readSource('src/renderer/src/components/layout/AppSidebar.vue')

  assert.match(
    source,
    /@contextmenu\.prevent="openWorkspaceContextMenu\(\$event,\s*group\.workspacePath\)"/
  )
  assert.match(source, /workspaceContextMenu/)
  assert.match(source, /deleteWorkspaceFromContextMenu/)
  assert.match(source, /Trash2[\s\S]*删除|删除[\s\S]*Trash2/)
  assert.match(source, /w-32/)
  assert.match(source, /px-2 py-1\.5 text-xs/)
  assert.match(source, /<Trash2 :size="13" \/>/)
  assert.match(source, /\(e:\s*'deleteWorkspace',\s*workspacePath:\s*string\):\s*void/)
})

test('App handles project context menu deletion through workspace data deletion', () => {
  const source = readSource('src/renderer/src/App.vue')

  assert.match(source, /@delete-workspace="deleteWorkspaceByPath"/)
  assert.match(source, /const deleteWorkspaceByPath = async \(workspacePath: string\)/)
  assert.match(source, /await window\.api\.db\.workspaces\.delete\(workspacePath\)/)
  assert.match(source, /await reloadWorkspaceSnapshot\(\)/)
})

test('AppSidebar pins temporary session group before normal workspace sorting', () => {
  const source = readSource('src/renderer/src/components/layout/AppSidebar.vue')
  const sortIndex = source.indexOf('groups.sort((a, b) => {')
  const tempPinIndex = source.indexOf(
    'a.workspacePath === TEMP_WORKSPACE_KEY && b.workspacePath !== TEMP_WORKSPACE_KEY',
    sortIndex
  )
  const threadedSortIndex = source.indexOf('Workspaces with threads come first', sortIndex)

  assert.ok(sortIndex >= 0, 'expected thread group sorting logic')
  assert.ok(tempPinIndex > sortIndex, 'expected temporary group pinning inside sort')
  assert.ok(threadedSortIndex > tempPinIndex, 'temporary group should be pinned before regular sorting')
  assert.match(
    source,
    /if \(b\.workspacePath === TEMP_WORKSPACE_KEY && a\.workspacePath !== TEMP_WORKSPACE_KEY\) return 1/
  )
})
