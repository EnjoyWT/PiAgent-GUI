<script setup lang="ts">
import { computed, reactive } from 'vue'
import {
  Settings2,
  WandSparkles,
  Cpu,
  History,
  MessageSquare,
  Activity,
  ChevronDown,
  ChevronUp
} from 'lucide-vue-next'
import type { ContextDebugEntryPreview, ContextThreadDebugSnapshot } from '@shared/context-engine'
import Tooltip from '@renderer/components/common/Tooltip.vue'

const props = defineProps<{
  threadId: string | null
  snapshot: ContextThreadDebugSnapshot | null
  loading: boolean
  compacting: boolean
  standalone?: boolean
}>()

const emit = defineEmits<{
  (e: 'compact'): void
  (e: 'open-settings'): void
}>()

// 使用 reactive 对象保证响应式
const expandedState = reactive<Record<string, boolean>>({})

const toggleEntry = (id: string) => {
  expandedState[id] = !expandedState[id]
}

const isEntryExpandable = (entry: ContextDebugEntryPreview): boolean =>
  Boolean(entry.fullText && entry.fullText !== entry.preview)

const getEntryText = (entry: ContextDebugEntryPreview): string => {
  if (expandedState[entry.id] && isEntryExpandable(entry)) {
    return entry.fullText || entry.preview || '...'
  }
  return entry.preview || entry.fullText || '...'
}

const pressurePercent = computed(() => {
  const pressure = props.snapshot?.pressure
  if (!pressure || pressure.thresholdTokens <= 0) return 0
  return Math.max(
    0,
    Math.min(100, Math.round((pressure.estimatedPromptTokens / pressure.thresholdTokens) * 100))
  )
})

const pressureTone = computed(() => {
  const level = props.snapshot?.pressure?.warningLevel
  if (level === 'critical') return 'bg-red-500'
  if (level === 'warning') return 'bg-amber-500'
  return 'bg-emerald-500'
})

const compactDisabledReason = computed(() => {
  const snapshot = props.snapshot
  if (!snapshot) return '当前线程还没有上下文快照'
  if (snapshot.managedThread.isStreaming) return '线程正在 streaming'
  if (snapshot.waitingForInput.question || snapshot.waitingForInput.questionnaire) {
    return '线程正在等待问题输入'
  }
  if (!snapshot.manualCompaction.available) return snapshot.manualCompaction.reasonText
  return ''
})

const compactActionHint = computed(() => {
  const snapshot = props.snapshot
  if (!snapshot) return '手动压缩上下文'
  const suffix =
    snapshot.manualCompaction.summarizableCount > 0
      ? `；预计压缩 ${snapshot.manualCompaction.summarizableCount} 条条目`
      : ''
  if (snapshot.managedThread.initialized) return `手动压缩并重建 session${suffix}`
  return `手动压缩上下文；session 会在下次初始化时应用${suffix}`
})

const formatNumber = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
  return value.toLocaleString('zh-CN')
}

const formatTimestamp = (value: string | null | undefined): string => {
  const text = String(value ?? '').trim()
  if (!text) return 'n/a'
  const date = new Date(text.replace(' ', 'T') + (text.endsWith('Z') ? '' : 'Z'))
  if (Number.isNaN(date.getTime())) return text
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}
</script>

<template>
  <div v-if="loading && !snapshot" class="px-4 py-8 text-center text-sm text-slate-500">
    正在载入上下文快照...
  </div>

  <div v-else-if="snapshot" class="flex flex-col gap-5 pb-8">
    <!-- Top Actions & Engine Info -->
    <div
      class="flex items-center justify-between rounded-2xl border border-slate-200/60 bg-white/50 px-4 py-3 shadow-sm"
    >
      <div class="flex items-center gap-3">
        <div
          class="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shadow-inner"
        >
          <Cpu :size="17" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold text-slate-900 text-[13px] uppercase tracking-tight">{{
              snapshot?.config.engine || 'noop'
            }}</span>
            <span
              class="rounded-full bg-blue-500/10 px-2 py-0.5 text-[9px] font-bold text-blue-600 ring-1 ring-inset ring-blue-500/10"
              >REV {{ snapshot.head?.revision ?? 0 }}</span
            >
          </div>
          <div
            class="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-400 opacity-80"
          >
            {{ snapshot.managedThread.modelKey || '未初始化' }}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="inline-flex h-7.5 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-bold text-slate-600 transition hover:border-slate-300 hover:shadow-sm hover:text-slate-900"
          @click="emit('open-settings')"
        >
          <Settings2 :size="12" />
          配置
        </button>
        <Tooltip :text="compactDisabledReason || compactActionHint" placement="top">
          <button
            type="button"
            class="inline-flex h-7.5 items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 text-[10px] font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            :disabled="Boolean(compactDisabledReason) || compacting"
            @click="emit('compact')"
          >
            <WandSparkles :size="12" :class="compacting ? 'animate-pulse' : ''" />
            {{ compacting ? '压缩中' : '手动压缩' }}
          </button>
        </Tooltip>
      </div>
    </div>

    <!-- Two Column Layout -->
    <div class="flex flex-row items-start gap-5">
      <!-- Left Column: Key Metrics & Pressure (Fixed) -->
      <aside class="sticky top-0 w-52 shrink-0 space-y-4">
        <!-- Tokens & Stats -->
        <div class="space-y-4 rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
          <div
            class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400"
          >
            <Activity :size="12" /> Metrics
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <div
                class="mb-0.5 text-[9px] font-bold uppercase tracking-tight text-slate-400 opacity-70"
              >
                Active
              </div>
              <div class="text-base font-bold text-slate-900">{{ snapshot.entries.active }}</div>
            </div>
            <div>
              <div
                class="mb-0.5 text-[9px] font-bold uppercase tracking-tight text-slate-400 opacity-70"
              >
                Summaries
              </div>
              <div class="text-base font-bold text-blue-600">{{ snapshot.entries.summaries }}</div>
            </div>
          </div>

          <div class="border-t border-slate-100 pt-3.5">
            <div class="mb-2 flex items-center justify-between">
              <div class="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                Pressure
              </div>
              <div class="text-[9px] font-mono font-bold text-slate-600">
                {{ pressurePercent }}%
              </div>
            </div>
            <div
              class="h-2 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/20"
            >
              <div
                class="h-full rounded-full transition-all duration-700 ease-out shadow-[0_0_8px_rgba(0,0,0,0.05)]"
                :class="pressureTone"
                :style="{ width: `${pressurePercent}%` }"
              ></div>
            </div>
            <div class="mt-2.5 flex flex-col gap-1 text-[8px] font-mono text-slate-500">
              <div class="flex justify-between items-center">
                <span class="opacity-60 uppercase">Used</span>
                <span class="font-bold text-slate-700">{{
                  formatNumber(
                    snapshot.pressure?.currentContextTokens ??
                      snapshot.pressure?.estimatedPromptTokens
                  )
                }}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="opacity-60 uppercase">Limit</span>
                <span class="font-bold text-slate-700">{{
                  formatNumber(snapshot.pressure?.thresholdTokens)
                }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Meta Info -->
        <div
          class="space-y-2.5 rounded-2xl border border-slate-200/60 bg-slate-50/50 p-3.5 text-[9px] shadow-sm"
        >
          <div class="flex justify-between items-center text-slate-500">
            <span class="font-bold uppercase tracking-tight opacity-70">Mode</span>
            <span
              class="font-bold text-slate-700 bg-white px-1.5 py-0.5 rounded border border-slate-200/50"
              >{{ snapshot.config.mode }}</span
            >
          </div>
          <div class="flex justify-between items-center">
            <span class="font-bold uppercase tracking-tight opacity-70 text-slate-500">Status</span>
            <span
              :class="
                snapshot.managedThread.initialized ? 'text-emerald-600 font-bold' : 'text-slate-400'
              "
            >
              {{ snapshot.managedThread.initialized ? '● Active' : '○ Idle' }}
            </span>
          </div>
          <div class="flex justify-between items-center text-slate-500">
            <span class="font-bold uppercase tracking-tight opacity-70">Total Entries</span>
            <span class="font-mono font-bold text-slate-700">{{ snapshot.entries.total }}</span>
          </div>
        </div>

        <div class="space-y-3 rounded-2xl border border-slate-200/60 bg-white p-3.5 shadow-sm">
          <div class="flex items-center justify-between">
            <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              手动压缩预判
            </div>
            <span
              class="rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ring-inset"
              :class="
                snapshot.manualCompaction.available
                  ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/10'
                  : 'bg-amber-500/10 text-amber-700 ring-amber-500/10'
              "
            >
              {{ snapshot.manualCompaction.available ? '可执行' : '会跳过' }}
            </span>
          </div>

          <div class="text-[10px] leading-relaxed text-slate-600">
            {{ snapshot.manualCompaction.reasonText }}
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="rounded-lg border border-slate-100 bg-slate-50 p-2">
              <div class="mb-0.5 text-[8px] font-bold uppercase tracking-tight text-slate-400">
                头部保护
              </div>
              <div class="font-bold text-slate-700 font-mono text-[11px] leading-none">
                {{ snapshot.manualCompaction.protectedHeadCount }}
              </div>
            </div>
            <div class="rounded-lg border border-slate-100 bg-slate-50 p-2">
              <div class="mb-0.5 text-[8px] font-bold uppercase tracking-tight text-slate-400">
                尾部保护
              </div>
              <div class="font-bold text-slate-700 font-mono text-[11px] leading-none">
                {{ snapshot.manualCompaction.protectedTailCount }}
              </div>
            </div>
            <div class="rounded-lg border border-slate-100 bg-slate-50 p-2">
              <div class="mb-0.5 text-[8px] font-bold uppercase tracking-tight text-slate-400">
                可压缩
              </div>
              <div class="font-bold text-blue-600 font-mono text-[11px] leading-none">
                {{ snapshot.manualCompaction.summarizableCount }}
              </div>
            </div>
            <div class="rounded-lg border border-slate-100 bg-slate-50 p-2">
              <div class="mb-0.5 text-[8px] font-bold uppercase tracking-tight text-slate-400">
                保护规则
              </div>
              <div class="font-bold text-slate-700 font-mono text-[11px] leading-none">
                首 {{ snapshot.manualCompaction.protectFirstEntries }} / 尾
                {{ snapshot.manualCompaction.protectLastEntries }}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Right Column: Local Scroll Content Groups -->
      <div class="flex min-w-0 flex-1 flex-col gap-5">
        <!-- Active Entries -->
        <section
          class="pl-4 flex flex-col rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden h-115"
        >
          <header
            class="shrink-0 flex items-center justify-between px-6 py-3.5 border-b border-slate-100 bg-slate-50/30"
          >
            <div
              class="flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-slate-500"
            >
              <MessageSquare :size="15" class="text-blue-500" />
              Active Context
              <span
                class="ml-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 text-[10px] font-bold"
                >{{ snapshot.activeEntriesPreview.length }}</span
              >
            </div>
          </header>

          <div class="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-3">
            <div
              v-if="snapshot.activeEntriesPreview.length === 0"
              class="h-full flex flex-col items-center justify-center text-slate-400"
            >
              <MessageSquare :size="24" class="opacity-10 mb-2" />
              <span class="text-[10px] font-medium tracking-wide">无活跃条目</span>
            </div>
            <div
              v-for="entry in snapshot.activeEntriesPreview"
              :key="entry.id"
              class="rounded-xl border border-slate-100 bg-white p-3.5 shadow-sm transition-all duration-200"
              :class="
                isEntryExpandable(entry)
                  ? 'group cursor-pointer hover:border-blue-200 hover:bg-blue-50/5 hover:shadow-md'
                  : ''
              "
              @click="isEntryExpandable(entry) ? toggleEntry(entry.id) : undefined"
            >
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-3">
                  <span
                    class="font-mono text-[10px] font-bold text-slate-300 group-hover:text-blue-400"
                    >#{{ entry.seq }}</span
                  >
                  <span
                    class="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 uppercase tracking-tight group-hover:bg-blue-100 group-hover:text-blue-600"
                  >
                    {{ entry.semanticKind }}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <Tooltip :text="`Compact Policy: ${entry.compactPolicy}`" placement="top">
                    <div class="text-[9px] font-bold text-slate-300 uppercase italic">
                      {{ entry.compactPolicy }}
                    </div>
                  </Tooltip>
                  <component
                    :is="expandedState[entry.id] ? ChevronUp : ChevronDown"
                    v-if="isEntryExpandable(entry)"
                    :size="12"
                    class="text-slate-300 group-hover:text-blue-400"
                  />
                </div>
              </div>
              <div
                class="text-[12px] leading-relaxed text-slate-600 font-normal transition-all duration-300 whitespace-pre-wrap wrap-break-word"
                :class="
                  expandedState[entry.id] && isEntryExpandable(entry)
                    ? 'max-h-64 overflow-y-auto pr-1 custom-scrollbar'
                    : !expandedState[entry.id] && isEntryExpandable(entry)
                      ? 'line-clamp-3'
                      : ''
                "
              >
                {{ getEntryText(entry) }}
              </div>
              <div
                v-if="!expandedState[entry.id] && isEntryExpandable(entry)"
                class="mt-1 text-[9px] font-bold text-blue-400/60 tracking-tight"
              >
                点击展开完整内容
              </div>
            </div>
          </div>
        </section>

        <!-- Recent Compactions -->
        <section
          class="pl-4 flex flex-col rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden h-75"
        >
          <header
            class="shrink-0 flex items-center justify-between px-6 py-3.5 border-b border-slate-100 bg-slate-50/30"
          >
            <div
              class="flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-slate-500"
            >
              <History :size="15" class="text-amber-500" />
              History
              <span
                class="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold"
                >{{ snapshot.recentCompactions.length }}</span
              >
            </div>
          </header>

          <div class="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-3">
            <div
              v-if="snapshot.recentCompactions.length === 0"
              class="h-full flex flex-col items-center justify-center text-slate-400"
            >
              <History :size="24" class="opacity-10 mb-2" />
              <span class="text-[10px] font-medium tracking-wide">无历史压缩记录</span>
            </div>
            <div
              v-for="item in snapshot.recentCompactions"
              :key="item.id"
              class="rounded-xl border border-slate-100 bg-slate-50/20 p-3 text-[11px] transition-all hover:bg-slate-50"
            >
              <div class="flex items-center justify-between mb-3">
                <span class="font-bold text-slate-700 flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-amber-400"></span>
                  {{ item.reason }}
                </span>
                <span class="text-slate-400 font-mono text-[9px] font-medium">{{
                  formatTimestamp(item.createdAt)
                }}</span>
              </div>
              <div class="grid grid-cols-3 gap-3">
                <div class="rounded-lg bg-white p-2 border border-slate-100">
                  <div class="text-[8px] uppercase text-slate-400 font-bold mb-0.5 tracking-tight">
                    Seq
                  </div>
                  <div class="font-bold text-slate-700 font-mono text-[11px] leading-none">
                    {{ item.compactedUntilSeq }}
                  </div>
                </div>
                <div class="rounded-lg bg-white p-2 border border-slate-100">
                  <div class="text-[8px] uppercase text-slate-400 font-bold mb-0.5 tracking-tight">
                    In
                  </div>
                  <div class="font-bold text-slate-700 font-mono text-[11px] leading-none">
                    {{ formatNumber(item.estimatedInputTokens) }}
                  </div>
                </div>
                <div class="rounded-lg bg-white p-2 border border-slate-100">
                  <div class="text-[8px] uppercase text-slate-400 font-bold mb-0.5 tracking-tight">
                    Out
                  </div>
                  <div class="font-bold text-blue-600 font-mono text-[11px] leading-none">
                    {{ formatNumber(item.estimatedOutputTokens) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(15, 23, 42, 0.06);
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(15, 23, 42, 0.12);
}

.line-clamp-3 {
  display: -webkit-box;
  line-clamp: 3;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
