<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, Circle, LoaderCircle, X, XCircle } from 'lucide-vue-next'
import type { ThreadPlanItem, ThreadPlanState } from '@shared/thread-plan'

const props = defineProps<{
  state: ThreadPlanState
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const items = computed(() => props.state.items)
const completedCount = computed(
  () => items.value.filter((item) => item.status === 'completed').length
)

const statusClass = (item: ThreadPlanItem): string => {
  if (item.status === 'completed') return 'text-emerald-500'
  if (item.status === 'in_progress') return 'text-(--theme-accent)'
  if (item.status === 'cancelled') return 'text-(--theme-text-dim)'
  return 'text-(--theme-text-dim)'
}
</script>

<template>
  <section
    class="mb-3 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar)/90 px-3.5 py-3 shadow-sm"
    data-testid="todo-panel"
  >
    <div class="mb-2 flex items-center justify-between gap-3">
      <div class="text-xs font-semibold uppercase tracking-normal text-(--theme-text-main)">
        Todo
      </div>
      <div class="flex items-center gap-2">
        <div class="text-[11px] tabular-nums text-(--theme-text-dim)">
          {{ completedCount }}/{{ items.length }}
        </div>
        <button
          type="button"
          class="inline-flex h-6 w-6 items-center justify-center rounded-md text-(--theme-text-dim) transition-colors hover:bg-(--theme-bg-hover-btn) hover:text-(--theme-text-main)"
          title="隐藏 Todo"
          @click="emit('close')"
        >
          <X :size="14" />
        </button>
      </div>
    </div>

    <ol class="space-y-1.5">
      <li
        v-for="(item, index) in items"
        :key="item.id || index"
        class="grid grid-cols-[18px_1fr] items-start gap-2 text-sm leading-5"
      >
        <span class="mt-0.5 inline-flex h-[18px] w-[18px] items-center justify-center">
          <CheckCircle2
            v-if="item.status === 'completed'"
            :size="15"
            class="shrink-0 text-emerald-500"
          />
          <LoaderCircle
            v-else-if="item.status === 'in_progress'"
            :size="15"
            class="shrink-0 animate-spin text-(--theme-accent)"
          />
          <XCircle
            v-else-if="item.status === 'cancelled'"
            :size="15"
            class="shrink-0 text-(--theme-text-dim)"
          />
          <Circle v-else :size="14" class="shrink-0 text-(--theme-text-dim)" />
        </span>
        <span
          class="min-w-0 break-words text-(--theme-text-main)"
          :class="[
            statusClass(item),
            item.status === 'completed' || item.status === 'cancelled' ? 'opacity-75' : ''
          ]"
        >
          <span class="mr-1 text-xs tabular-nums text-(--theme-text-dim)">{{ index + 1 }}.</span>
          {{ item.text }}
        </span>
      </li>
    </ol>
  </section>
</template>
