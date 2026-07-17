<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Wrench,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  CircleX,
  Search,
  Globe,
  Clock3,
  Brain
} from 'lucide-vue-next'
import type { ToolRenderBlock, QuestionPromptRenderBlock } from './flow-blocks'
import type { ChatToolStep } from './types'
import { formatToolCommand } from './tool-command-format'

const props = defineProps<{
  block: ToolRenderBlock | QuestionPromptRenderBlock
}>()

const emit = defineEmits<{
  (e: 'widget-layout-change'): void
}>()

const step = computed((): ChatToolStep => props.block.step)

const isExpanded = ref(step.value.status === 'running')

watch(
  () => step.value.status,
  (status) => {
    if (status === 'running') {
      isExpanded.value = true
    }
  }
)

const toggleExpanded = (): void => {
  isExpanded.value = !isExpanded.value
  emit('widget-layout-change')
}

const normalizeToolName = (name: string): string => (name || '').trim().toLowerCase()

const extractCommand = (): string => formatToolCommand(step.value)

const extractOutput = (): string => (step.value.summary || '').trim()

const getToolStatusLabel = (): string => {
  if (step.value.status === 'running') return 'Running'
  if (step.value.status === 'done') return 'Completed'
  return 'Failed'
}

const getToolHeaderLabel = (): string => {
  const name = (step.value.toolName || '').trim()
  if (!name) return 'Tool'

  const norm = name.toLowerCase()
  if (norm === 'websearchtool') {
    if (step.value.status === 'running') return '正在搜索 Google...'
    if (step.value.status === 'done') return '搜索 Google 已完成'
    return '搜索 Google'
  }
  if (norm === 'webfetchtool') {
    if (step.value.status === 'running') return '正在读取网页内容...'
    if (step.value.status === 'done') return '网页内容读取完成'
    return '读取网页内容'
  }

  return name.slice(0, 1).toUpperCase() + name.slice(1)
}

const shouldShowToolDuration = (): boolean =>
  step.value.toolKind !== 'question' &&
  normalizeToolName(step.value.toolName) !== 'questionnairetool' &&
  step.value.durationMs != null

const shouldShowToolStatusIcon = (): boolean =>
  normalizeToolName(step.value.toolName) !== 'questionnairetool'

const formatThinkingDuration = (durationMs: number): string => {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  const seconds = durationMs / 1000
  return `${Number(seconds.toFixed(1))} s`
}
</script>

<template>
  <div>
    <!-- 工具标题行按钮 -->
    <button
      type="button"
      class="hover-expand-x inline-flex min-w-20 max-w-full items-center gap-1.5 rounded-lg py-1 pr-1.5 text-[12px] text-(--theme-text-dim) hover:bg-(--theme-bg-hover-item) transition-colors"
      :class="{
        'bg-(--theme-accent)/5 border border-(--theme-accent)/20 shadow-sm':
          step.status === 'running' &&
          (normalizeToolName(step.toolName) === 'websearchtool' ||
            normalizeToolName(step.toolName) === 'webfetchtool')
      }"
      @click="toggleExpanded"
    >
      <span class="min-w-0 inline-flex items-center gap-2 truncate">
        <!-- 根据工具类型渲染特定图标 -->
        <Search
          v-if="normalizeToolName(step.toolName) === 'websearchtool'"
          :size="15"
          class="shrink-0"
          :class="
            step.status === 'running'
              ? 'text-(--theme-accent) animate-pulse'
              : 'text-(--theme-text-dim)'
          "
        />
        <Globe
          v-else-if="normalizeToolName(step.toolName) === 'webfetchtool'"
          :size="15"
          class="shrink-0"
          :class="
            step.status === 'running'
              ? 'text-(--theme-accent) animate-pulse'
              : 'text-(--theme-text-dim)'
          "
        />
        <Wrench v-else :size="15" class="shrink-0 text-(--theme-text-dim)" />

        <span
          class="truncate text-[12px] font-medium leading-relaxed"
          :class="
            step.status === 'running' &&
            (normalizeToolName(step.toolName) === 'websearchtool' ||
              normalizeToolName(step.toolName) === 'webfetchtool')
              ? 'thinking-shimmer-text font-semibold'
              : 'text-(--theme-text-main)'
          "
        >
          {{ getToolHeaderLabel() }}
        </span>
      </span>

      <!-- 状态图标 -->
      <Brain
        v-if="block.kind === 'question_prompt' && step.status === 'running'"
        :size="14"
        class="text-(--theme-text-dim)"
      />
      <span
        v-else-if="shouldShowToolStatusIcon()"
        :title="getToolStatusLabel()"
        :aria-label="getToolStatusLabel()"
        class="shrink-0 inline-flex items-center justify-center text-(--theme-text-main)"
      >
        <CircleCheckBig
          v-if="step.status === 'done'"
          :size="14"
          class="text-emerald-600"
        />
        <span
          v-else-if="step.status === 'running'"
          class="tool-running-cursor"
          aria-hidden="true"
        />
        <CircleX v-else :size="14" class="text-rose-500" />
      </span>

      <!-- 耗时展示 -->
      <span
        v-if="shouldShowToolDuration()"
        class="shrink-0 inline-flex items-center gap-1 tabular-nums text-[11px] text-(--theme-text-dim)"
      >
        <Clock3 :size="14" />
        {{ formatThinkingDuration(step.durationMs ?? 0) }}
      </span>

      <ChevronDown
        v-if="isExpanded"
        :size="14"
        class="shrink-0 text-(--theme-text-dim)"
      />
      <ChevronRight v-else :size="14" class="shrink-0 text-(--theme-text-dim)" />
    </button>

    <!-- 展开内容 -->
    <Transition name="flow-expand" @after-enter="emit('widget-layout-change')" @after-leave="emit('widget-layout-change')">
      <div v-if="isExpanded" class="flow-expand-shell">
        <div class="flow-expand-inner">
          <div
            class="mt-2 w-fit max-w-full md:max-w-[70%] min-w-100 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-content)/70 px-3 py-2"
          >
            <div v-if="extractCommand()">
              <div class="text-[11px] font-semibold tracking-wide text-(--theme-text-dim)">
                COMMAND
              </div>
              <pre
                class="mt-1 max-h-24 overflow-auto rounded-md border border-dashed border-(--theme-border-base) bg-(--theme-bg-main) p-2 text-[11px] text-(--theme-text-main)"
              ><code>{{ extractCommand() }}</code></pre>
            </div>

            <div v-if="extractOutput()" class="mt-2">
              <div class="text-[11px] font-semibold tracking-wide text-(--theme-text-dim)">
                OUTPUT
              </div>
              <pre
                class="mt-1 max-h-40 overflow-auto rounded-md border border-dashed border-(--theme-border-base) bg-(--theme-bg-main) p-2 text-[11px] text-(--theme-text-main) whitespace-pre-wrap wrap-break-word"
              ><code>{{ extractOutput() }}</code></pre>
            </div>

            <div
              v-if="!extractCommand() && !extractOutput()"
              class="text-[11px] text-(--theme-text-dim)"
            >
              暂无详情
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- question_prompt 特有的提问正文渲染 -->
    <div v-if="block.kind === 'question_prompt'" class="mt-1.5 pl-0 pb-1">
      <div class="text-sm text-(--theme-text-main) whitespace-pre-wrap leading-relaxed">
        {{ block.prompt }}
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

.tool-running-cursor {
  display: inline-block;
  width: 2px;
  height: 15px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--theme-accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--theme-accent) 35%, transparent);
  animation: tool-running-cursor-blink 1.05s steps(2, start) infinite;
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

@keyframes tool-running-cursor-blink {
  0%,
  46% {
    opacity: 1;
  }
  47%,
  100% {
    opacity: 0.2;
  }
}
</style>
