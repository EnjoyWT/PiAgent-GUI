<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { Download } from 'lucide-vue-next'
import { KFrame } from 'kframe'
import 'kframe/dist/kframe.css'

const MAX_EMBEDDED_WIDGET_HEIGHT = 800
const props = defineProps<{
  kind: 'html'
  uid?: string
  html?: string
  url?: string
  widgetId?: string
  title?: string
  placement: 'inline' | 'main'
  config?: {
    showHeader?: boolean
    fullWidth?: boolean
  }
}>()

const emit = defineEmits<{
  (e: 'action', payload: { action: string; text: string }): void
  (e: 'close'): void
  (e: 'layout-change'): void
}>()

const iframeHeight = ref(0)
const frameUid = computed(() => props.uid || props.widgetId || 'default-widget')
const rootRef = ref<HTMLElement | null>(null)
let visibilityObserver: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null
let layoutChangeRafId: number | null = null
const embeddedFrameHeight = computed(() => {
  if (props.placement === 'main') return null
  const measured = iframeHeight.value > 0 ? iframeHeight.value : null
  if (!measured) return null
  // 如果配置了 fullWidth，则不限制最大高度，或者给一个更大的上限
  if (props.config?.fullWidth) return measured
  return Math.min(measured, MAX_EMBEDDED_WIDGET_HEIGHT)
})

const scheduleLayoutChange = (): void => {
  if (props.placement !== 'inline') return
  if (layoutChangeRafId != null) return
  layoutChangeRafId = window.requestAnimationFrame(() => {
    layoutChangeRafId = null
    emit('layout-change')
  })
}

const setWidgetInactiveState = (inactive: boolean): void => {
  if (!props.widgetId) return
  void window.api.widget.setInactive(props.widgetId, inactive)
}

const downloadHtml = async () => {
  if (!props.html) return

  // 确保 html 包含完整的文档结构
  let content = props.html.trim()
  if (
    !content.toLowerCase().startsWith('<!doctype') &&
    !content.toLowerCase().startsWith('<html')
  ) {
    content = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${props.title || 'Widget'}</title>
</head>
<body>
${content}
</body>
</html>`
  }

  const defaultName = (props.title || 'widget').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.html'

  await window.api.dialog.saveFile({
    content,
    defaultPath: defaultName,
    filters: [{ name: 'HTML Files', extensions: ['html'] }]
  })
}

const handleMessage = (event: MessageEvent) => {
  const data = event.data as
    | { type?: string; payload?: { height?: number; action?: string; text?: string }; uid?: string }
    | undefined
  if (!data || data.uid !== frameUid.value) return

  if (data.type === 'WIDGET_INTERNAL_ACTION' && data.payload?.action === 'SEND_MESSAGE') {
    console.warn(
      '[widgetRenderer] Ignored SEND_MESSAGE widget action. ' +
        'widgetRenderer is presentation-only; use questionTool for blocking input.'
    )
    return
  }

  if (data.type === 'WIDGET_RESIZE' && props.placement === 'inline') {
    iframeHeight.value = data.payload?.height ?? 0
  }
}

window.addEventListener('message', handleMessage)

const setupVisibilityObserver = (): void => {
  if (visibilityObserver) {
    visibilityObserver.disconnect()
    visibilityObserver = null
  }

  if (!props.widgetId || !props.url || !rootRef.value) return
  if (props.placement !== 'inline') {
    setWidgetInactiveState(false)
    return
  }

  const scrollRoot = rootRef.value.closest('.chat-flow-container') as Element | null
  visibilityObserver = new IntersectionObserver(
    (entries) => {
      const isVisible = entries.some((entry) => entry.isIntersecting)
      setWidgetInactiveState(!isVisible)
    },
    {
      root: scrollRoot,
      threshold: 0.05,
      rootMargin: '120px 0px'
    }
  )
  visibilityObserver.observe(rootRef.value)
}

const setupResizeObserver = (): void => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }

  if (props.placement !== 'inline' || !rootRef.value) return
  resizeObserver = new ResizeObserver(() => {
    scheduleLayoutChange()
  })
  resizeObserver.observe(rootRef.value)
}

onMounted(() => {
  setupVisibilityObserver()
  setupResizeObserver()
})

watch([() => props.widgetId, () => props.url, () => props.placement] as const, () => {
  setupVisibilityObserver()
  setupResizeObserver()
})

onUnmounted(() => {
  window.removeEventListener('message', handleMessage)
  if (visibilityObserver) {
    visibilityObserver.disconnect()
    visibilityObserver = null
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (layoutChangeRafId != null) {
    window.cancelAnimationFrame(layoutChangeRafId)
    layoutChangeRafId = null
  }
  setWidgetInactiveState(true)
})
</script>

<template>
  <div
    ref="rootRef"
    class="widget-placeholder group overflow-hidden relative"
    :class="[placement === 'inline' ? 'w-full bg-transparent' : 'h-full w-full bg-white']"
    :style="{
      maxWidth: placement === 'inline' ? 'none' : undefined,
      width: placement === 'inline' ? '100%' : undefined,
      height:
        placement === 'main' ? '100%' : embeddedFrameHeight ? embeddedFrameHeight + 'px' : '120px',
      minHeight: placement === 'inline' ? '120px' : undefined
    }"
  >
    <div
      v-if="config?.showHeader && placement !== 'inline'"
      class="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50/50 shrink-0"
    >
      <span class="text-xs font-medium text-gray-500">{{ title || 'Widget' }}</span>
      <div class="flex items-center gap-2">
        <button
          v-if="html"
          class="text-gray-400 hover:text-gray-600 cursor-pointer p-1 rounded-md hover:bg-gray-200/50 transition-all duration-200 opacity-0 group-hover:opacity-100"
          title="保存为 HTML"
          @click="downloadHtml"
        >
          <Download :size="14" />
        </button>
        <button
          class="text-gray-400 hover:text-gray-600 cursor-pointer p-1 rounded-md hover:bg-gray-200/50 transition-colors"
          @click="emit('close')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 针对 Inline 模式的悬浮下载按钮 -->
    <button
      v-if="html && placement === 'inline'"
      class="absolute top-3 right-5 z-20 p-1.5 rounded-md bg-gray-200/50 hover:bg-gray-200 text-gray-500 opacity-0 group-hover:opacity-100 transition-all duration-200"
      title="保存为 HTML"
      @click="downloadHtml"
    >
      <Download :size="14" />
    </button>

    <KFrame
      v-if="url"
      :uid="frameUid"
      :src="`${url}${url.includes('?') ? '&' : '?'}uid=${encodeURIComponent(frameUid)}`"
      :keep-alive="true"
      :render-mode="placement === 'inline' ? 'inline' : 'portal'"
      :z-index="1"
      :container="placement === 'inline' ? '.chat-flow-container' : undefined"
      sandbox="allow-scripts allow-same-origin allow-forms"
      class="w-full border-0 bg-transparent"
      :class="placement === 'main' ? 'h-full' : ''"
      :style="
        placement === 'main'
          ? undefined
          : embeddedFrameHeight
            ? { height: `${embeddedFrameHeight}px` }
            : undefined
      "
    />
  </div>
</template>
