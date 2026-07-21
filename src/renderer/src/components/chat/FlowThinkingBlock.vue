<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { Brain, ChevronDown, ChevronRight } from 'lucide-vue-next'
import MarkdownContent from './MarkdownContent.vue'
import { useThinkingScroll } from './useThinkingScroll'
import type { MessageRenderBlock } from './flow-blocks'

type ThinkingBlock = Extract<MessageRenderBlock, { kind: 'thinking' }>

const props = defineProps<{
  block: ThinkingBlock
}>()

const formatThinkingDuration = (durationMs: number): string => {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  const seconds = durationMs / 1000
  return `${Number(seconds.toFixed(1))} s`
}

const nowMs = ref(Date.now())
let nowTimer: number | null = null

const isBlockActive = computed(() => props.block.isActive)

watch(
  isBlockActive,
  (active) => {
    if (active) {
      nowMs.value = Date.now()
      if (nowTimer == null) {
        nowTimer = window.setInterval(() => {
          nowMs.value = Date.now()
        }, 100)
      }
      return
    }
    if (nowTimer != null) {
      window.clearInterval(nowTimer)
      nowTimer = null
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (nowTimer != null) {
    window.clearInterval(nowTimer)
    nowTimer = null
  }
})

const getThinkingDurationMs = (): number =>
  Math.max(0, (props.block.endedAt ?? nowMs.value) - props.block.startedAt)

const getThinkingStatusText = (): string =>
  props.block.endedAt == null && !props.block.thinking.trim()
    ? '思考中'
    : `思考了 ${formatThinkingDuration(getThinkingDurationMs())}`

const rootRef = ref<HTMLElement | null>(null)

// 折叠/展开逻辑，初始化：如果已经结束了，默认折叠，未结束则展开
const isExpanded = ref(props.block.endedAt == null)

// 区分自动折叠（思考结束）和手动折叠（用户点击），只在自动折叠时滚动
const isAutoCollapse = ref(false)

// 当思考块结束时自动折叠
watch(
  () => props.block.endedAt,
  (endedAt, prevEndedAt) => {
    if (prevEndedAt == null && endedAt != null) {
      isAutoCollapse.value = true
      isExpanded.value = false
    }
  }
)

// 折叠过渡动画完成后，将聊天容器滚动到底部
const onThinkingCollapsed = (): void => {
  if (!isAutoCollapse.value) return
  isAutoCollapse.value = false
  const chatEl = rootRef.value?.closest('.chat-flow-container')
  if (chatEl) {
    chatEl.scrollTop = chatEl.scrollHeight
  }
}

const toggleThinking = (): void => {
  isAutoCollapse.value = false
  isExpanded.value = !isExpanded.value
}

// 自动滚动跟随
const { handleScroll, setupAutoScroll, setContainerRef } = useThinkingScroll(
  () => props.block.isActive
)
setupAutoScroll(() => props.block.thinking)
</script>

<template>
  <div ref="rootRef" class="w-fit max-w-full">
    <button
      type="button"
      class="hover-expand-x inline-flex items-center gap-2 rounded-lg py-1 pr-2 text-(--theme-text-dim) transition-colors hover:bg-(--theme-bg-hover-btn) flex-nowrap whitespace-nowrap"
      @click="toggleThinking"
    >
      <Brain :size="15" class="shrink-0 text-(--theme-text-dim)" />
      <span
        class="text-[13px] font-medium leading-relaxed shrink-0"
        :class="{ 'thinking-shimmer-text': block.isActive }"
      >
        {{ getThinkingStatusText() }}
      </span>
      <ChevronDown
        v-if="isExpanded"
        :size="14"
        class="shrink-0 text-(--theme-text-dim)"
      />
      <ChevronRight v-else :size="14" class="shrink-0 text-(--theme-text-dim)" />
    </button>
    <Transition name="flow-expand" @after-leave="onThinkingCollapsed">
      <div v-if="isExpanded" class="flow-expand-shell">
        <div class="flow-expand-inner">
          <div
            class="mt-2 w-fit min-w-100 max-w-full border-l-3 border-(--theme-text-dim)/60 pl-4 md:max-w-[70%]"
          >
            <MarkdownContent
              :ref="setContainerRef"
              :content="block.thinking || '模型正在思考...'"
              :is-streaming="block.isActive"
              class="thinking-markdown max-h-80 overflow-auto text-[12px] text-(--theme-text-main)"
              @scroll="handleScroll"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hover-expand-x {
  --thinking-hover-pad-x: 0.5rem;
  margin-inline: calc(var(--thinking-hover-pad-x) * -1);
  padding-inline: var(--thinking-hover-pad-x);
}

.flow-expand-shell {
  display: grid;
  grid-template-rows: 1fr;
}

.flow-expand-inner {
  min-height: 0;
  overflow: hidden;
}

.flow-expand-enter-active,
.flow-expand-leave-active {
  transition:
    grid-template-rows 220ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 180ms ease;
}

.flow-expand-enter-active > .flow-expand-inner,
.flow-expand-leave-active > .flow-expand-inner {
  transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.flow-expand-enter-from,
.flow-expand-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

.flow-expand-enter-from > .flow-expand-inner,
.flow-expand-leave-to > .flow-expand-inner {
  transform: translateY(-4px);
}

.flow-expand-enter-to,
.flow-expand-leave-from {
  grid-template-rows: 1fr;
  opacity: 1;
}

.flow-expand-enter-to > .flow-expand-inner,
.flow-expand-leave-from > .flow-expand-inner {
  transform: translateY(0);
}

.thinking-markdown {
  overflow-anchor: auto;
}

.thinking-markdown :deep(*:first-child) {
  margin-top: 0;
}

.thinking-markdown :deep(*:last-child) {
  margin-bottom: 0;
}

.thinking-markdown :deep(code:not(pre code)) {
  border-radius: 0.5rem;
  background: #eef2f7;
  padding: 0.12rem 0.42rem;
}

.thinking-shimmer-text {
  background-image: linear-gradient(
    90deg,
    var(--theme-text-dim) 0%,
    var(--theme-text-dim) 40%,
    var(--theme-text-bright) 50%,
    var(--theme-text-dim) 60%,
    var(--theme-text-dim) 100%
  );
  background-size: 400% 100%;
  animation: thinking-text-sweep 3s linear infinite;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

@keyframes thinking-text-sweep {
  0% {
    background-position: 100% 0%;
  }
  100% {
    background-position: 0% 0%;
  }
}
</style>
