import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceSmoothStreamState,
  createChatMarkdownParser,
  createSmoothStreamState,
  createStreamingMarkdownTree,
  setSmoothStreamTarget,
  type StreamingMarkdownNode
} from '../../../src/renderer/src/components/chat/stream-markdown.ts'

const flatten = (nodes: StreamingMarkdownNode[]): StreamingMarkdownNode[] =>
  nodes.flatMap((node) =>
    node.kind === 'element' ? [node, ...flatten(node.children)] : [node]
  )

test('smooth stream state reveals appended target content over animation frames', () => {
  const state = createSmoothStreamState('', 0)

  setSmoothStreamTarget(state, 'Alpha beta gamma delta', 100)

  assert.equal(state.displayedText, '')
  assert.equal(state.targetText, 'Alpha beta gamma delta')

  advanceSmoothStreamState(state, 116)
  assert.notEqual(state.displayedText, '')
  assert.notEqual(state.displayedText, state.targetText)

  for (let now = 132; now <= 1200; now += 16) {
    advanceSmoothStreamState(state, now)
  }

  assert.equal(state.displayedText, state.targetText)
})

test('smooth stream state resets safely when target text is replaced', () => {
  const state = createSmoothStreamState('Existing answer', 0)

  setSmoothStreamTarget(state, 'New answer', 16)

  assert.equal(state.displayedText, 'New answer')
  assert.equal(state.targetText, 'New answer')
})

test('streaming markdown tree wraps ordinary words with stable fade keys', () => {
  const tree = createStreamingMarkdownTree('Hello **bold** world')
  const flat = flatten(tree)
  const fadedWords = flat.filter((node) => node.kind === 'fade-word')

  assert.deepEqual(
    fadedWords.map((node) => (node.kind === 'fade-word' ? node.text : '')),
    ['Hello', 'bold', 'world']
  )
  assert.deepEqual(
    fadedWords.map((node) => (node.kind === 'fade-word' ? node.key : '')),
    ['root-0-0-w0', 'root-0-1-0-w0', 'root-0-2-w0']
  )
})

test('streaming markdown tree preserves inline markdown inside list text tokens', () => {
  const tree = createStreamingMarkdownTree('- 普通 **加粗文本** 和 `code`')
  const flat = flatten(tree)

  assert.ok(flat.some((node) => node.kind === 'element' && node.tag === 'strong'))
  assert.ok(flat.some((node) => node.kind === 'element' && node.tag === 'code'))
  assert.equal(
    flat
      .filter((node) => node.kind === 'fade-word')
      .map((node) => (node.kind === 'fade-word' ? node.text : ''))
      .includes('**'),
    false
  )
})

test('streaming markdown tree recognizes strong text after adjacent CJK text and opening quote', () => {
  const tree = createStreamingMarkdownTree('为你奉上**"Aether Audio（以太空间音频）"** 落地页！')
  const flat = flatten(tree)

  const strong = flat.find((node) => node.kind === 'element' && node.tag === 'strong')
  assert.ok(strong)
  assert.equal(
    flat
      .filter((node) => node.kind === 'fade-word')
      .map((node) => (node.kind === 'fade-word' ? node.text : ''))
      .includes('**'),
    false
  )
})

test('chat markdown parser renders adjacent quoted strong text without inserting a visible space', () => {
  const parser = createChatMarkdownParser({ gfm: true, breaks: true })
  const html = parser.parse('为你奉上**"Aether Audio（以太空间音频）"** 落地页！')

  assert.equal(
    html,
    '<p>为你奉上<strong>&quot;Aether Audio（以太空间音频）&quot;</strong> 落地页！</p>\n'
  )
})

test('streaming markdown tree does not fade code or raw html content', () => {
  const tree = createStreamingMarkdownTree('`inline` <span>raw</span>\n\n```ts\nconst x = 1\n```')
  const flat = flatten(tree)
  const fadedText = flat
    .filter((node) => node.kind === 'fade-word')
    .map((node) => (node.kind === 'fade-word' ? node.text : ''))

  assert.equal(fadedText.includes('inline'), false)
  assert.equal(fadedText.includes('raw'), false)
  assert.equal(fadedText.includes('const'), false)
  assert.ok(flat.some((node) => node.kind === 'element' && node.tag === 'code'))
})
