import { Marked, type MarkedExtension } from 'marked'

export type StreamingMarkdownNode =
  | { kind: 'text'; text: string }
  | { kind: 'fade-word'; key: string; text: string }
  | {
      kind: 'element'
      tag: string
      key: string
      props?: Record<string, string | boolean | undefined>
      children: StreamingMarkdownNode[]
    }

export type SmoothStreamState = {
  targetText: string
  displayedText: string
  displayedCount: number
  emaCps: number
  lastFrameAt: number
  lastTargetAt: number
}

type TextPart = { value: string; fade: boolean }

const adjacentPunctuationStrongExtension = {
  name: 'adjacentPunctuationStrong',
  level: 'inline' as const,
  start(src: string) {
    return src.indexOf('**')
  },
  tokenizer(this: any, src: string, tokens: any[]) {
    if (!src.startsWith('**')) return undefined

    const previousToken = tokens.at(-1)
    if (
      !previousToken ||
      previousToken.type !== 'text' ||
      typeof previousToken.text !== 'string' ||
      !/[^\s]$/.test(previousToken.text)
    ) {
      return undefined
    }

    const match = /^\*\*([\s\S]+?)\*\*(?!\*)/.exec(src)
    if (!match) return undefined

    const text = match[1]
    if (!text || /^\s/.test(text) || !/^[\p{P}\p{S}]/u.test(text)) return undefined

    return {
      type: 'strong',
      raw: match[0],
      text,
      tokens: this.lexer.inlineTokens(text)
    }
  }
}

export const createChatMarkdownParser = (options: MarkedExtension = {}): Marked =>
  new Marked({
    ...options,
    extensions: [adjacentPunctuationStrongExtension, ...(options.extensions ?? [])]
  })

const streamingMarked = createChatMarkdownParser()

const SegmenterCtor = (globalThis as any).Intl?.Segmenter
const segmenter = SegmenterCtor ? new SegmenterCtor('zh', { granularity: 'word' }) : null
const isWhitespace = (value: string): boolean => /^\s+$/.test(value)
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const createSmoothStreamState = (initialText = '', nowMs = 0): SmoothStreamState => ({
  targetText: initialText,
  displayedText: initialText,
  displayedCount: initialText.length,
  emaCps: 80,
  lastFrameAt: nowMs,
  lastTargetAt: nowMs
})

export const setSmoothStreamTarget = (
  state: SmoothStreamState,
  nextTargetText: string,
  nowMs: number
): void => {
  if (nextTargetText === state.targetText) return

  if (!nextTargetText.startsWith(state.displayedText)) {
    state.targetText = nextTargetText
    state.displayedText = nextTargetText
    state.displayedCount = nextTargetText.length
    state.lastFrameAt = nowMs
    state.lastTargetAt = nowMs
    return
  }

  const appendedCount = Math.max(0, nextTargetText.length - state.targetText.length)
  const elapsedSeconds = Math.max((nowMs - state.lastTargetAt) / 1000, 0.016)
  if (appendedCount > 0) {
    const instantCps = appendedCount / elapsedSeconds
    state.emaCps = clamp(state.emaCps * 0.72 + instantCps * 0.28, 36, 360)
  }

  state.targetText = nextTargetText
  state.lastTargetAt = nowMs
  state.lastFrameAt = nowMs
  state.displayedCount = Math.min(state.displayedCount, nextTargetText.length)
  state.displayedText = nextTargetText.slice(0, Math.floor(state.displayedCount))
}

export const advanceSmoothStreamState = (state: SmoothStreamState, nowMs: number): boolean => {
  const targetCount = state.targetText.length
  if (state.displayedCount >= targetCount) {
    state.displayedCount = targetCount
    state.displayedText = state.targetText
    state.lastFrameAt = nowMs
    return false
  }

  const elapsedSeconds = Math.max((nowMs - state.lastFrameAt) / 1000, 0.016)
  const pendingCount = targetCount - state.displayedCount
  const cps = clamp(state.emaCps + pendingCount * 7, 48, 520)
  const step = Math.max(1, cps * elapsedSeconds)

  state.displayedCount = Math.min(targetCount, state.displayedCount + step)
  state.displayedText = state.targetText.slice(0, Math.floor(state.displayedCount))
  state.lastFrameAt = nowMs

  if (state.displayedText.length === targetCount) {
    state.displayedCount = targetCount
    state.displayedText = state.targetText
  }

  return state.displayedText.length < targetCount
}

const splitText = (value: string): TextPart[] => {
  if (!value) return []
  if (!segmenter) {
    return value
      .split(/(\s+)/)
      .filter(Boolean)
      .map((part) => ({ value: part, fade: !isWhitespace(part) }))
  }

  const parts: TextPart[] = []
  for (const seg of segmenter.segment(value)) {
    if (!seg.segment) continue
    parts.push({ value: seg.segment, fade: !isWhitespace(seg.segment) })
  }
  return parts
}

const textNode = (text: string): StreamingMarkdownNode => ({ kind: 'text', text })

const elementNode = (
  tag: string,
  key: string,
  children: StreamingMarkdownNode[],
  props?: Record<string, string | boolean | undefined>
): StreamingMarkdownNode => ({
  kind: 'element',
  tag,
  key,
  props,
  children
})

const renderTextAsNodes = (text: string, parentKey: string): StreamingMarkdownNode[] => {
  const parts = splitText(text)
  if (parts.length === 0) return [textNode(text)]

  let fadeIndex = 0
  return parts.map((part) => {
    if (!part.fade) return textNode(part.value)
    return { kind: 'fade-word', key: `${parentKey}-w${fadeIndex++}`, text: part.value }
  })
}

const renderTokens = (tokens: any[], parentKey = 'root'): StreamingMarkdownNode[] => {
  if (!tokens) return []

  return tokens
    .map((token, index): StreamingMarkdownNode | null => {
      const key = `${parentKey}-${index}`

      switch (token.type) {
        case 'heading':
          return elementNode(`h${token.depth}`, key, renderTokens(token.tokens || [], key))
        case 'paragraph':
          if ((token.tokens || []).some((child: any) => child.type === 'html')) {
            return elementNode('p', key, [textNode(token.raw || token.text || '')])
          }
          return elementNode('p', key, renderTokens(token.tokens || [], key))
        case 'strong':
          return elementNode('strong', key, renderTokens(token.tokens || [], key))
        case 'em':
          return elementNode('em', key, renderTokens(token.tokens || [], key))
        case 'del':
          return elementNode('del', key, renderTokens(token.tokens || [], key))
        case 'link':
          return elementNode('a', key, renderTokens(token.tokens || [], key), {
            href: token.href,
            target: '_blank',
            rel: 'noopener noreferrer'
          })
        case 'image':
          return elementNode('img', key, [], { src: token.href, alt: token.text || '' })
        case 'codespan':
          return elementNode('code', key, [textNode(token.text || '')])
        case 'br':
          return elementNode('br', key, [])
        case 'hr':
          return elementNode('hr', key, [])
        case 'text':
          if (token.tokens) {
            return elementNode('span', key, renderTokens(token.tokens, key))
          }
          return elementNode('span', key, renderTextAsNodes(token.text || '', key))
        case 'list': {
          const tag = token.ordered ? 'ol' : 'ul'
          return elementNode(
            tag,
            key,
            (token.items || []).map((item: any, itemIndex: number) => {
              const itemKey = `${key}-li-${itemIndex}`
              return elementNode('li', itemKey, renderTokens(item.tokens || [], itemKey))
            })
          )
        }
        case 'blockquote':
          return elementNode('blockquote', key, renderTokens(token.tokens || [], key))
        case 'code':
          return elementNode('pre', key, [
            elementNode('code', `${key}-code`, [textNode(token.text || '')], {
              class: token.lang ? `language-${token.lang}` : undefined
            })
          ])
        case 'html':
          return textNode(token.raw || token.text || '')
        case 'space':
          return null
        default:
          return textNode(token.raw || token.text || '')
      }
    })
    .filter((node): node is StreamingMarkdownNode => Boolean(node))
}

export const createStreamingMarkdownTree = (content: string): StreamingMarkdownNode[] =>
  renderTokens(streamingMarked.lexer(content || ''))
