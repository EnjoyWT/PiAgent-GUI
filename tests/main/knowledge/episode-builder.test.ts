import test from 'node:test'
import assert from 'node:assert/strict'
import { buildKnowledgeEpisode } from '../../../src/main/knowledge/episode-builder.ts'

test('buildKnowledgeEpisode correctly aggregates messages, truncates tools, and respects 12,000 limit', () => {
  const result = buildKnowledgeEpisode({
    conversationId: 'conv-123',
    threadId: 'thread-456',
    agentRunId: 'run-789',
    workspacePath: '/path/to/PiAgent',
    messages: [
      { id: 'm1', role: 'user', text: '这个项目叫 PiAgent' },
      { id: 'm2', role: 'assistant', text: '我会记录为项目背景' },
      { id: 'm3', role: 'tool', text: 'a'.repeat(500) }, // should be truncated to 300
      { id: 'm4', role: 'system', text: '' } // ignored empty text
    ]
  })

  assert.equal(result.conversationId, 'conv-123')
  assert.equal(result.threadId, 'thread-456')
  assert.equal(result.agentRunId, 'run-789')
  assert.equal(result.workspacePath, '/path/to/PiAgent')
  assert.equal(result.userText, '这个项目叫 PiAgent')
  assert.equal(result.assistantText, '我会记录为项目背景')
  assert.equal(result.toolSummaries, 'a'.repeat(300))
  assert.deepEqual(result.sourceMessageIds, ['m1', 'm2', 'm3'])
})

test('buildKnowledgeEpisode truncates older messages when total character count exceeds 12,000', () => {
  const largeText1 = 'b'.repeat(10000)
  const largeText2 = 'c'.repeat(5000)

  const result = buildKnowledgeEpisode({
    conversationId: 'conv-123',
    messages: [
      { id: 'm1', role: 'user', text: largeText2 }, // older, should be truncated/ignored
      { id: 'm2', role: 'assistant', text: largeText1 } // newer, fits under 12,000 limit
    ]
  })

  assert.equal(result.userText, '') // m1 was dropped because we exceed 12,000 starting from the newest
  assert.equal(result.assistantText, largeText1)
  assert.deepEqual(result.sourceMessageIds, ['m2'])
})
