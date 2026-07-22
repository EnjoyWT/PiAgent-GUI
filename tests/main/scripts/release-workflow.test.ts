import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflowPath = '.github/workflows/release.yml'

test('release workflow publishes an existing draft release before uploading assets', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const editIndex = workflow.indexOf('gh release edit "${TAG}"')
  const uploadIndex = workflow.indexOf('gh release upload "${TAG}"')

  assert.notEqual(editIndex, -1, 'workflow must edit the GitHub release')
  assert.notEqual(uploadIndex, -1, 'workflow must upload assets to the GitHub release')
  assert.ok(editIndex < uploadIndex, 'workflow must publish draft releases before uploading assets')

  const editBlock = workflow.slice(editIndex, uploadIndex)
  assert.match(
    editBlock,
    /--draft=false/,
    'workflow must publish draft releases as formal releases'
  )
  assert.match(editBlock, /--latest/, 'workflow must keep the published release marked as latest')
})
