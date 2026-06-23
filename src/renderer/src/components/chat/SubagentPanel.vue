<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  LoaderCircle,
  RefreshCw,
  SquareStack,
  X,
  XCircle
} from 'lucide-vue-next'
import type { SubagentPanelState, SubagentPanelWorker } from '@shared/subagent-panel'

const props = defineProps<{
  state: SubagentPanelState
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const workers = computed(() => props.state.group.workers)
const completedCount = computed(
  () => workers.value.filter((worker) => worker.status === 'completed').length
)

const statusText = (worker: SubagentPanelWorker): string => {
  if (worker.status === 'cancel_requested') return '取消中'
  const labels: Record<string, string> = {
    queued: '排队',
    starting: '启动中',
    running: '运行中',
    completed: '完成',
    failed: '失败',
    blocked: '阻塞',
    timed_out: '超时',
    canceled: '已取消',
    interrupted: '中断'
  }
  return labels[worker.status] ?? worker.status
}

const statusClass = (worker: SubagentPanelWorker): string => {
  if (worker.status === 'completed') return 'text-emerald-500'
  if (worker.status === 'failed' || worker.status === 'blocked' || worker.status === 'timed_out') {
    return 'text-red-500'
  }
  if (worker.status === 'running' || worker.status === 'starting' || worker.status === 'cancel_requested') {
    return 'text-(--theme-accent)'
  }
  return 'text-(--theme-text-dim)'
}
</script>

<template>
  <section
    class="mb-3 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar)/90 px-3.5 py-3 shadow-sm"
    data-testid="subagent-panel"
  >
    <div class="mb-2 flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <SquareStack :size="14" class="shrink-0 text-(--theme-accent)" />
        <div class="truncate text-xs font-semibold uppercase tracking-normal text-(--theme-text-main)">
          Workers
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="text-[11px] tabular-nums text-(--theme-text-dim)">
          {{ completedCount }}/{{ workers.length }}
        </div>
        <button
          type="button"
          class="inline-flex h-6 w-6 items-center justify-center rounded-md text-(--theme-text-dim) transition-colors hover:bg-(--theme-bg-hover-btn) hover:text-(--theme-text-main)"
          title="隐藏 Workers"
          @click="emit('close')"
        >
          <X :size="14" />
        </button>
      </div>
    </div>

    <ol class="space-y-2">
      <li
        v-for="worker in workers"
        :key="worker.taskId"
        class="grid grid-cols-[18px_1fr] items-start gap-2 text-sm leading-5"
      >
        <span class="mt-0.5 inline-flex h-[18px] w-[18px] items-center justify-center">
          <CheckCircle2
            v-if="worker.status === 'completed'"
            :size="15"
            class="shrink-0 text-emerald-500"
          />
          <LoaderCircle
            v-else-if="worker.status === 'running' || worker.status === 'starting'"
            :size="15"
            class="shrink-0 animate-spin text-(--theme-accent)"
          />
          <RefreshCw
            v-else-if="worker.status === 'cancel_requested'"
            :size="14"
            class="shrink-0 text-(--theme-accent)"
          />
          <AlertCircle
            v-else-if="worker.status === 'blocked' || worker.status === 'timed_out'"
            :size="15"
            class="shrink-0 text-red-500"
          />
          <XCircle
            v-else-if="worker.status === 'failed' || worker.status === 'canceled' || worker.status === 'interrupted'"
            :size="15"
            class="shrink-0 text-(--theme-text-dim)"
          />
          <Circle v-else :size="14" class="shrink-0 text-(--theme-text-dim)" />
        </span>
        <div class="min-w-0">
          <div class="flex min-w-0 items-baseline gap-2">
            <span
              class="min-w-0 truncate font-medium text-(--theme-text-main)"
              :class="worker.status === 'completed' || worker.status === 'canceled' ? 'opacity-80' : ''"
            >
              {{ worker.title }}
            </span>
            <span class="shrink-0 text-[11px] tabular-nums" :class="statusClass(worker)">
              {{ statusText(worker) }}
            </span>
          </div>
          <div
            v-if="worker.latestProgress || worker.resultSummary || worker.error"
            class="mt-0.5 min-w-0 break-words text-xs leading-4 text-(--theme-text-dim)"
          >
            {{ worker.latestProgress || worker.resultSummary || worker.error }}
          </div>
        </div>
      </li>
    </ol>
  </section>
</template>
