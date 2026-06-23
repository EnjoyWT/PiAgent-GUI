import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFallbackConversationTitle,
  generateConversationTitle,
  sanitizeConversationTitle
} from '../../../src/main/conversation-title/conversation-title-service.ts'

test('conversation title fallback truncates text like the existing renderer behavior', () => {
  assert.equal(
    buildFallbackConversationTitle({ text: '帮我实现一个根据第一条消息生成对话标题的新功能' }),
    '帮我实现一个根据第一条消息生成对话标题的...'
  )
  assert.equal(buildFallbackConversationTitle({ text: '短标题' }), '短标题')
})

test('conversation title fallback names image-only messages', () => {
  assert.equal(buildFallbackConversationTitle({ text: '', imageCount: 1 }), '图片消息')
  assert.equal(buildFallbackConversationTitle({ text: '' }), '新对话')
})

test('sanitizeConversationTitle keeps the first clean plain-text title', () => {
  assert.equal(sanitizeConversationTitle('"生成对话标题"\n解释文字'), '生成对话标题')
  assert.equal(sanitizeConversationTitle('### Refactor Thread Titles'), 'Refactor Thread Titles')
})

test('generateConversationTitle returns sanitized model output when tool model is configured', async () => {
  const result = await generateConversationTitle(
    { text: '现在每次对话thread产生对话标题是写死的截取字段，现在要让模型生成标题' },
    {
      getToolModelKey: () => 'google::gemini-2.5-flash',
      runOneShotText: async () => ({
        modelKey: 'google::gemini-2.5-flash',
        text: '"智能标题生成"'
      })
    }
  )

  assert.deepEqual(result, {
    title: '智能标题生成',
    source: 'model',
    modelKey: 'google::gemini-2.5-flash'
  })
})

test('generateConversationTitle falls back when no usable model is available', async () => {
  const result = await generateConversationTitle(
    { text: '帮我修复 CLI 对话标题' },
    {
      getToolModelKey: () => '',
      runOneShotText: async () => {
        throw new Error('should not call model')
      }
    }
  )

  assert.deepEqual(result, {
    title: '帮我修复 CLI 对话标题',
    source: 'fallback',
    modelKey: null
  })
})

test('generateConversationTitle falls back when the model returns no usable text', async () => {
  const result = await generateConversationTitle(
    { text: '', imageCount: 2 },
    {
      getToolModelKey: () => 'openai::gpt-5.4-mini',
      runOneShotText: async () => null
    }
  )

  assert.deepEqual(result, {
    title: '图片消息',
    source: 'fallback',
    modelKey: null
  })
})
