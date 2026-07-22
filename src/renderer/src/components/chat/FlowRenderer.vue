<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, ChevronDown } from 'lucide-vue-next'
import WidgetContainer from './WidgetContainer.vue'
import TransportSetupQrBlock from './TransportSetupQrBlock.vue'
import FlowThinkingBlock from './FlowThinkingBlock.vue'
import FlowTextBlock from './FlowTextBlock.vue'
import FlowAnswerBlock from './FlowAnswerBlock.vue'
import FlowToolBlock from './FlowToolBlock.vue'
import FlowFileBlock from './FlowFileBlock.vue'
import FlowErrorBlock from './FlowErrorBlock.vue'
import FlowImageBlock from './FlowImageBlock.vue'
import type { MessageRenderBlock } from './flow-blocks'
import type { TransportSetupQrProjection } from '@shared/agent-runtime'

const props = defineProps<{
  blocks: MessageRenderBlock[]
  threadId?: string | null
  workspacePath?: string
  showIntermediateSummary?: boolean
}>()

const emit = defineEmits<{
  (e: 'widget-action', payload: { action: string; text: string }): void
  (e: 'transport-setup-regenerate', payload: TransportSetupQrProjection): void
  (e: 'widget-layout-change'): void
}>()

const intermediateProcessCollapsed = ref(false)
const intermediateProcessUserToggled = ref(false)

// Only the dedicated run-final block can collapse prior turns. Ordinary `text`
// blocks are streaming output owned by individual turns and must remain visible.
const finalAnswerBlockId = computed(
  () => props.blocks.find((block) => block.kind === 'run_final_text')?.id ?? null
)

const hasFinalAnswer = computed(() => finalAnswerBlockId.value != null)
const hasIntermediateProcess = computed(
  () =>
    props.showIntermediateSummary !== false &&
    hasFinalAnswer.value &&
    props.blocks.some((block) => block.id !== finalAnswerBlockId.value)
)

const formatThinkingDuration = (durationMs: number): string => {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  const seconds = durationMs / 1000
  return `${Number(seconds.toFixed(1))} s`
}

const processedDurationMs = computed(() => {
  const thinkingDuration = props.blocks.reduce((total, block) => {
    if (block.kind !== 'thinking') return total
    return total + Math.max(0, (block.endedAt ?? Date.now()) - block.startedAt)
  }, 0)
  if (thinkingDuration > 0) return thinkingDuration

  return props.blocks.reduce((total, block) => {
    if ((block.kind !== 'tool' && block.kind !== 'file') || block.step.durationMs == null) {
      return total
    }
    return total + block.step.durationMs
  }, 0)
})

const toggleIntermediateProcess = (): void => {
  intermediateProcessUserToggled.value = true
  intermediateProcessCollapsed.value = !intermediateProcessCollapsed.value
}

const isFinalAnswerBlock = (block: MessageRenderBlock): boolean =>
  block.id === finalAnswerBlockId.value

watch(
  finalAnswerBlockId,
  (blockId, previousBlockId) => {
    if (!blockId || blockId === previousBlockId || intermediateProcessUserToggled.value) return
    intermediateProcessCollapsed.value = true
  },
  { immediate: true }
)

// 当中间过程自动折叠时（最终回答出现），通知父组件滚动到底部
watch(intermediateProcessCollapsed, (collapsed) => {
  if (collapsed && !intermediateProcessUserToggled.value) {
    emit('widget-layout-change')
  }
})

const onWidgetAction = (payload: { action: string; text: string }): void => {
  emit('widget-action', payload)
}

const onTransportSetupRegenerate = (payload: TransportSetupQrProjection): void => {
  emit('transport-setup-regenerate', payload)
}

// 监听流式正文更新，向外派发布局更新通知
const activeTextBlock = computed(
  () =>
    props.blocks.find(
      (b) => (b.kind === 'text' || b.kind === 'questionnaire_question') && b.isActive
    ) as Extract<MessageRenderBlock, { kind: 'text' | 'questionnaire_question' }> | undefined
)

watch(
  () => activeTextBlock.value?.text,
  () => {
    emit('widget-layout-change')
  },
  { flush: 'post' }
)
</script>

<template>
  <div v-if="blocks.length > 0" class="space-y-1">
    <button
      v-if="hasIntermediateProcess"
      type="button"
      class="hover-expand-x inline-flex items-center gap-2 rounded-lg py-1 pr-2 text-(--theme-text-dim) transition-colors hover:bg-(--theme-bg-hover-btn)"
      :aria-expanded="!intermediateProcessCollapsed"
      @click="toggleIntermediateProcess"
    >
      <span class="text-[15px] font-medium leading-relaxed"
        >已处理 {{ formatThinkingDuration(processedDurationMs) }}</span
      >
      <ChevronDown v-if="!intermediateProcessCollapsed" :size="14" class="shrink-0" />
      <ChevronRight v-else :size="14" class="shrink-0" />
    </button>

    <div
      v-for="block in blocks"
      v-show="!intermediateProcessCollapsed || isFinalAnswerBlock(block)"
      :key="block.id"
    >
      <FlowThinkingBlock
        v-if="block.kind === 'thinking'"
        :block="block"
        @widget-layout-change="emit('widget-layout-change')"
      />

      <FlowTextBlock
        v-else-if="
          block.kind === 'text' ||
          block.kind === 'run_final_text' ||
          block.kind === 'questionnaire_question'
        "
        :block="block"
      />

      <FlowAnswerBlock
        v-else-if="block.kind === 'question_answer' || block.kind === 'questionnaire_answer'"
        :block="block"
      />

      <FlowFileBlock
        v-else-if="block.kind === 'file'"
        :block="block"
        :thread-id="threadId"
        :workspace-path="workspacePath"
        @widget-layout-change="emit('widget-layout-change')"
      />

      <FlowToolBlock
        v-else-if="block.kind === 'tool' || block.kind === 'question_prompt'"
        :block="block"
        @widget-layout-change="emit('widget-layout-change')"
      />

      <FlowErrorBlock
        v-else-if="block.kind === 'turn_error'"
        :block="block"
        @widget-layout-change="emit('widget-layout-change')"
      />

      <FlowImageBlock
        v-else-if="block.kind === 'tool_image'"
        :block="block"
        @widget-layout-change="emit('widget-layout-change')"
      />

      <div v-else-if="block.kind === 'widget'" class="w-full">
        <WidgetContainer
          :kind="block.widget.kind"
          :uid="block.id"
          :placement="block.widget.placement"
          :html="block.widget.html"
          :url="block.widget.url"
          :widget-id="block.widget.widgetId"
          :title="block.widget.title"
          :config="block.widget.config"
          @action="onWidgetAction"
          @layout-change="emit('widget-layout-change')"
        />
      </div>

      <div v-else-if="block.kind === 'transport_setup_qr'" class="w-full">
        <TransportSetupQrBlock :qr="block.qr" @regenerate="onTransportSetupRegenerate" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.hover-expand-x {
  --thinking-hover-pad-x: 0.5rem;
  margin-inline: calc(var(--thinking-hover-pad-x) * -1);
  padding-inline: var(--thinking-hover-pad-x);
}
</style>
