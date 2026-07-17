<script setup lang="ts">
import { ref, watch } from 'vue'
import { ChevronDown, ChevronRight, CircleX } from 'lucide-vue-next'
import Tooltip from '../common/Tooltip.vue'
import GitDiffView from './GitDiffView.vue'
import type { MessageRenderBlock } from './flow-blocks'

type FileBlock = Extract<MessageRenderBlock, { kind: 'file' }>

const props = defineProps<{
  block: FileBlock
  threadId?: string | null
  workspacePath?: string
}>()

const emit = defineEmits<{
  (e: 'widget-layout-change'): void
}>()

const isExpanded = ref(props.block.step.status === 'running')

watch(
  () => props.block.step.status,
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

const isAbsolutePath = (filePath: string): boolean =>
  filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\')

const joinWorkspacePath = (workspacePath: string, filePath: string): string =>
  `${workspacePath.replace(/[\\/]+$/, '')}/${filePath.replace(/^[\\/]+/, '')}`

const resolveFileDisplayPath = (filePath: string): string => {
  const path = filePath.trim()
  if (!path || isAbsolutePath(path)) return path

  const workspace = String(props.workspacePath ?? '').trim()
  return workspace ? joinWorkspacePath(workspace, path) : path
}

const openFileContextMenu = (filePath: string): void => {
  const path = filePath.trim()
  if (!path) return
  void window.api.showFileContextMenu({
    path,
    threadId: props.threadId ?? null,
    workspacePath: props.workspacePath ?? null
  })
}

const getToolStatusLabel = (): string => {
  if (props.block.step.status === 'running') return 'Running'
  if (props.block.step.status === 'done') return 'Completed'
  return 'Failed'
}
</script>

<template>
  <div class="w-full">
    <button
      type="button"
      class="hover-expand-x inline-flex min-w-20 max-w-full items-center gap-1.5 rounded-lg py-1 pr-1.5 text-[12px] text-(--theme-text-dim) hover:bg-(--theme-bg-hover-item) transition-colors"
      @click="toggleExpanded"
    >
      <span class="min-w-0 inline-flex items-center gap-1.5 truncate">
        <span class="text-[12px] text-gray-600">{{ block.entry.actionLabel }}</span>
        <Tooltip :text="resolveFileDisplayPath(block.entry.path)" multiline :max-width="420">
          <span
            class="cursor-context-menu truncate text-[12px] font-semibold text-blue-600"
            @contextmenu.prevent.stop="openFileContextMenu(block.entry.path)"
          >
            {{ block.entry.fileName }}
          </span>
        </Tooltip>
        <span v-if="block.entry.addedLines" class="tabular-nums font-semibold text-emerald-600"
          >+{{ block.entry.addedLines }}</span
        >
        <span v-if="block.entry.removedLines" class="tabular-nums font-semibold text-rose-600"
          >-{{ block.entry.removedLines }}</span
        >
      </span>

      <span class="shrink-0 inline-flex items-center justify-center">
        <span
          v-if="block.step.status === 'running'"
          class="tool-running-cursor"
          :title="getToolStatusLabel()"
          :aria-label="getToolStatusLabel()"
        />
        <CircleX
          v-else-if="block.step.status === 'error'"
          :size="14"
          class="shrink-0 text-rose-500"
        />
      </span>

      <ChevronDown
        v-if="isExpanded"
        :size="14"
        class="shrink-0 text-(--theme-text-dim)"
      />
      <ChevronRight v-else :size="14" class="shrink-0 text-(--theme-text-dim)" />
    </button>

    <Transition name="flow-expand" @after-enter="emit('widget-layout-change')" @after-leave="emit('widget-layout-change')">
      <div v-if="isExpanded" class="flow-expand-shell">
        <div class="flow-expand-inner">
          <div
            class="mt-2 w-fit max-w-full md:max-w-[70%] min-w-100 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-content)/70 px-3 py-2"
          >
            <div
              class="mb-2 flex items-center justify-between gap-2 text-[12px] text-(--theme-text-main)"
            >
              <div class="min-w-0 truncate font-medium">{{ block.entry.fileName }}</div>
              <div class="shrink-0 tabular-nums text-[12px] text-(--theme-text-dim)">
                <span v-if="block.entry.addedLines" class="text-emerald-600"
                  >+{{ block.entry.addedLines }}</span
                >
                <span v-if="block.entry.removedLines" class="ml-1 text-rose-600"
                  >-{{ block.entry.removedLines }}</span
                >
              </div>
            </div>
            <GitDiffView v-if="block.entry.diff?.trim()" :diff="block.entry.diff" />
            <div v-else class="text-[11px] text-(--theme-text-dim)">暂无 diff</div>
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
