<script setup lang="ts">
import { ref } from 'vue'
import { CircleX, ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { MessageRenderBlock } from './flow-blocks'

type ErrorBlock = Extract<MessageRenderBlock, { kind: 'turn_error' }>

defineProps<{
  block: ErrorBlock
}>()

const emit = defineEmits<{
  (e: 'widget-layout-change'): void
}>()

const isExpanded = ref(false)

const toggleExpanded = (): void => {
  isExpanded.value = !isExpanded.value
  emit('widget-layout-change')
}
</script>

<template>
  <div class="w-fit min-w-120 max-w-full">
    <button
      type="button"
      class="hover-expand-x inline-flex max-w-full items-center gap-2 rounded-lg py-1 text-rose-700/80 transition-colors hover:bg-rose-50/70"
      @click="toggleExpanded"
    >
      <CircleX :size="14" class="shrink-0 text-rose-500" />
      <span class="text-[13px] font-medium">上一轮执行已中断</span>
      <ChevronDown v-if="isExpanded" :size="14" class="shrink-0 text-rose-400" />
      <ChevronRight v-else :size="14" class="shrink-0 text-rose-400" />
    </button>
    <Transition name="flow-expand" @after-enter="emit('widget-layout-change')" @after-leave="emit('widget-layout-change')">
      <div v-if="isExpanded" class="flow-expand-shell">
        <div class="flow-expand-inner">
          <div
            class="mt-2 w-fit min-w-120 max-w-full rounded-xl border border-rose-100 bg-rose-50/55 px-3 py-2 md:max-w-[58%]"
          >
            <div class="text-[11px] font-medium text-rose-700/80">中断详情</div>
            <div
              class="mt-1 max-h-48 overflow-auto text-[12px] leading-relaxed text-rose-900/80 whitespace-pre-wrap"
            >
              {{ block.errorMessage || '请求中断，未返回可继续使用的结果。' }}
            </div>
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
</style>
