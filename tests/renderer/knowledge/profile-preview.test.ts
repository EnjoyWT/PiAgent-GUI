import test from 'node:test'
import assert from 'node:assert/strict'

const { buildKnowledgeProfilePreview, KNOWLEDGE_PROFILE_PREVIEW_LIMIT } =
  await import('../../../src/renderer/src/windows/settings/components/knowledge-profile-preview.ts')

test('buildKnowledgeProfilePreview normalizes whitespace before truncating long profile bodies', () => {
  const body = `第一行内容

第二行内容    with extra spacing and a very long tail that should not make the L4 item uneven`

  assert.equal(
    buildKnowledgeProfilePreview(body, 36),
    '第一行内容 第二行内容 with extra spacing and...'
  )
})

test('buildKnowledgeProfilePreview keeps short profile bodies unchanged', () => {
  assert.equal(buildKnowledgeProfilePreview('短内容', KNOWLEDGE_PROFILE_PREVIEW_LIMIT), '短内容')
})
