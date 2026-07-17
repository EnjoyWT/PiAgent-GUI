import { ref, watch, onBeforeUnmount } from 'vue'

export function useThinkingScroll(isActive: () => boolean) {
  const containerRef = ref<HTMLElement | null>()
  const isPinned = ref(true)

  const handleScroll = (): void => {
    const el = containerRef.value
    if (!el) return
    // 距离底部 30px 以内即认为钉在底部
    isPinned.value = el.scrollHeight - el.scrollTop - el.clientHeight <= 30
  }

  let rafId: number | null = null

  const scrollContainerToBottom = (behavior: 'auto' | 'smooth' = 'auto'): void => {
    const el = containerRef.value
    if (!el) return

    if (behavior === 'auto') {
      el.scrollTop = el.scrollHeight
      isPinned.value = true
      return
    }

    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior
      })
      isPinned.value = true
      rafId = null
    })
  }

  const setupAutoScroll = (textRef: () => string): void => {
    watch(textRef, () => {
      if (!isActive() || !isPinned.value) return
      scrollContainerToBottom('auto')
    }, { flush: 'post' })
  }

  const setContainerRef = (el: unknown): void => {
    const dom =
      el && typeof el === 'object' && '$el' in el ? (el as { $el?: unknown }).$el : el
    if (dom instanceof HTMLElement) {
      containerRef.value = dom
      // 初次加载或激活时自动滚动到底部
      if (isActive()) {
        scrollContainerToBottom()
      }
    } else {
      containerRef.value = null
    }
  }

  onBeforeUnmount(() => {
    if (rafId !== null) cancelAnimationFrame(rafId)
  })

  return {
    containerRef,
    isPinned,
    handleScroll,
    setupAutoScroll,
    setContainerRef,
    scrollContainerToBottom
  }
}
