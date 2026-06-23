<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch, h } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  advanceSmoothStreamState,
  createChatMarkdownParser,
  createSmoothStreamState,
  createStreamingMarkdownTree,
  setSmoothStreamTarget,
  type StreamingMarkdownNode
} from './stream-markdown'

const props = withDefaults(
  defineProps<{
    content: string
    isStreaming?: boolean
  }>(),
  {
    content: '',
    isStreaming: false
  }
)

const renderer = new marked.Renderer()
// @ts-ignore
const originalCode = renderer.code.bind(renderer)

// @ts-ignore
renderer.code = function (token: any) {
  const { text } = token
  // @ts-ignore
  const codeHtml = originalCode(token)
  return `
    <div class="code-block-wrapper group/code relative">
      <button 
        class="code-copy-btn absolute top-2 right-2 p-1.5 rounded-md bg-gray-200/50 hover:bg-gray-200 text-gray-500 opacity-0 group-hover/code:opacity-100 transition-all duration-200"
        title="复制代码"
        data-copy-content="${encodeURIComponent(text)}"
      >
        <svg class="w-3.5 h-3.5 copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        <svg class="w-3.5 h-3.5 check-icon hidden text-green-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      ${codeHtml}
    </div>
  `
}

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true
})
const chatMarked = createChatMarkdownParser({
  renderer,
  gfm: true,
  breaks: true
})

const renderedHtml = shallowRef('')
const hasVisibleContent = ref(false)
const streamingDisplayContent = ref('')
const smoothStreamState = createSmoothStreamState('', 0)
let smoothStreamRaf: number | null = null

const nowMs = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now())

const cancelSmoothStreamRaf = (): void => {
  if (smoothStreamRaf == null) return
  window.cancelAnimationFrame(smoothStreamRaf)
  smoothStreamRaf = null
}

const scheduleSmoothStreamAdvance = (): void => {
  if (smoothStreamRaf != null) return
  smoothStreamRaf = window.requestAnimationFrame((timestamp) => {
    smoothStreamRaf = null
    const shouldContinue = advanceSmoothStreamState(smoothStreamState, timestamp)
    streamingDisplayContent.value = smoothStreamState.displayedText
    if (shouldContinue && props.isStreaming) scheduleSmoothStreamAdvance()
  })
}

const updateRenderedHtml = () => {
  const html = chatMarked.parse(props.content || '')
  const raw = typeof html === 'string' ? html : ''
  const sanitized = DOMPurify.sanitize(raw, {
    ADD_ATTR: [
      'data-copy-content',
      'target',
      'rel',
      'viewBox',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'points'
    ],
    ADD_TAGS: ['button', 'svg', 'path', 'rect', 'polyline']
  })

  renderedHtml.value = sanitized
  hasVisibleContent.value = sanitized.length > 0
}

watch(() => props.content, updateRenderedHtml, { immediate: true })

watch(
  [() => props.content, () => props.isStreaming],
  ([content, isStreaming]) => {
    if (!isStreaming) {
      cancelSmoothStreamRaf()
      streamingDisplayContent.value = ''
      return
    }

    setSmoothStreamTarget(smoothStreamState, content || '', nowMs())
    streamingDisplayContent.value = smoothStreamState.displayedText
    if (smoothStreamState.displayedText.length < smoothStreamState.targetText.length) {
      scheduleSmoothStreamAdvance()
    }
  },
  { immediate: true }
)

const showCopyFeedback = (button: HTMLButtonElement) => {
  const copyIcon = button.querySelector<SVGElement>('.copy-icon')
  const checkIcon = button.querySelector<SVGElement>('.check-icon')

  copyIcon?.classList.add('hidden')
  checkIcon?.classList.remove('hidden')

  window.setTimeout(() => {
    copyIcon?.classList.remove('hidden')
    checkIcon?.classList.add('hidden')
  }, 1200)
}

const handleContentClick = async (event: MouseEvent) => {
  const target = event.target
  if (!(target instanceof Element)) return

  const button = target.closest<HTMLButtonElement>('[data-copy-content]')
  if (button) {
    event.preventDefault()
    event.stopPropagation()

    const encoded = button.getAttribute('data-copy-content')
    if (!encoded) return

    try {
      const text = decodeURIComponent(encoded)
      await navigator.clipboard.writeText(text)
      showCopyFeedback(button)
    } catch (error) {
      console.error('Failed to copy markdown code block', error)
    }
    return
  }

  const anchor = target.closest<HTMLAnchorElement>('a[href]')
  if (anchor) {
    event.preventDefault()
    event.stopPropagation()
    const url = anchor.getAttribute('href')
    if (url) {
      window.api.openExternal(url)
    }
  }
}

const renderStreamingNode = (node: StreamingMarkdownNode): any => {
  if (node.kind === 'text') return node.text
  if (node.kind === 'fade-word') {
    return h('span', { key: node.key, class: 'alma-fade-word' }, node.text)
  }
  return h(
    node.tag,
    { key: node.key, ...(node.props || {}) },
    node.children.map((child) => renderStreamingNode(child))
  )
}

const VStreamRenderer = (props: { content: string }) => {
  const tree = createStreamingMarkdownTree(props.content || '')
  return h(
    'div',
    {
      class:
        'md-content prose prose-sm max-w-none text-(--theme-text-main) wrap-break-word leading-relaxed',
      onClick: handleContentClick
    },
    tree.map((node) => renderStreamingNode(node))
  )
}

onBeforeUnmount(cancelSmoothStreamRaf)
</script>

<template>
  <VStreamRenderer
    v-if="props.isStreaming && streamingDisplayContent"
    :content="streamingDisplayContent"
  />
  <div
    v-else-if="hasVisibleContent"
    class="md-content prose prose-sm max-w-none text-(--theme-text-main) wrap-break-word leading-relaxed"
    @click="handleContentClick"
    v-html="renderedHtml"
  ></div>
</template>

<style scoped>
.md-content {
  --tw-prose-body: var(--theme-text-main);
  --tw-prose-headings: var(--theme-text-bright);
  --tw-prose-lead: var(--theme-text-main);
  --tw-prose-links: var(--theme-accent);
  --tw-prose-bold: var(--theme-text-main);
  --tw-prose-counters: var(--theme-text-dim);
  --tw-prose-bullets: var(--theme-text-dim);
  --tw-prose-hr: var(--theme-border-base);
  --tw-prose-quotes: var(--theme-text-main);
  --tw-prose-quote-borders: var(--theme-border-base);
  --tw-prose-captions: var(--theme-text-dim);
  --tw-prose-code: var(--theme-text-main);
  --tw-prose-pre-code: var(--theme-text-main);
  --tw-prose-pre-bg: var(--theme-bg-content);
  --tw-prose-th-borders: var(--theme-border-base);
  --tw-prose-td-borders: var(--theme-border-base);
}

.md-content :deep(pre) {
  margin-top: 0;
  margin-bottom: 0;
  background: var(--theme-bg-content);
  border: 1px solid var(--theme-border-base);
  border-radius: 0.5rem;
  padding: 0.75rem;
  overflow-x: auto;
  color: var(--theme-text-main);
}

@keyframes almaWordFadeIn {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

.md-content :deep(.alma-fade-word) {
  display: inline;
  opacity: 1;
  animation: 0.6s ease-out almaWordFadeIn both;
}

.md-content :deep(.code-block-wrapper) {
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
}

.md-content :deep(p) {
  margin: 0.35em 0;
}

.md-content :deep(*:first-child) {
  margin-top: 0;
}

.md-content :deep(*:last-child) {
  margin-bottom: 0;
}

.md-content :deep(pre code) {
  font-size: 0.85em;
}

.md-content :deep(code:not(pre code)) {
  background: color-mix(in srgb, var(--theme-bg-content) 72%, white);
  border-radius: 0.45rem;
  color: var(--theme-text-main) / 32%;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 0.82em;
  font-weight: 400;
  padding: 0.34em 0.34em;
}

.md-content :deep(code:not(pre code)::before),
.md-content :deep(code:not(pre code)::after) {
  content: none;
}
</style>
