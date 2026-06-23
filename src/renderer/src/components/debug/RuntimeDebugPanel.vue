<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  RefreshCw,
  X,
  Bot,
  Hammer,
  MessageSquareText,
  GitBranch,
  Sparkles,
  Layers3,
  Clock
} from 'lucide-vue-next'
import type { ContextThreadDebugSnapshot } from '@shared/context-engine'
import type { ConversationEventRow } from '../../../../preload/db-types'
import ContextDebugPanel from './ContextDebugPanel.vue'

type RunOption = {
  id: string
  label: string
  status: string
}

const props = defineProps<{
  isOpen: boolean
  standalone?: boolean
  threadId: string | null
  events: ConversationEventRow[]
  loading: boolean
  contextSnapshot: ContextThreadDebugSnapshot | null
  contextLoading: boolean
  contextCompacting: boolean
  selectedRunId: string | null
  runOptions: RunOption[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
  (e: 'compact-context'): void
  (e: 'open-context-settings'): void
  (e: 'select-run', runId: string | null): void
}>()

const activeTab = ref<'context' | 'events'>('events')
const scrollContainer = ref<HTMLElement | null>(null)

const categoryMeta = (eventType: string) => {
  if (eventType.startsWith('debugQueue')) {
    return {
      label: 'Queue',
      chip: 'bg-fuchsia-500/12 text-fuchsia-700 ring-1 ring-fuchsia-500/15',
      icon: Hammer
    }
  }
  if (eventType.startsWith('debugUi')) {
    return {
      label: 'UI',
      chip: 'bg-violet-500/12 text-violet-700 ring-1 ring-violet-500/15',
      icon: Sparkles
    }
  }
  if (eventType.startsWith('context.')) {
    return {
      label: 'Context',
      chip: 'bg-cyan-500/12 text-cyan-700 ring-1 ring-cyan-500/15',
      icon: Sparkles
    }
  }
  if (eventType.startsWith('agentQueue')) {
    return {
      label: 'Queue',
      chip: 'bg-fuchsia-500/12 text-fuchsia-700 ring-1 ring-fuchsia-500/15',
      icon: Hammer
    }
  }
  if (eventType.startsWith('agentTool')) {
    return {
      label: 'Tool',
      chip: 'bg-slate-900 text-white',
      icon: Hammer
    }
  }
  if (eventType.startsWith('agentMessage')) {
    return {
      label: 'Message',
      chip: 'bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/15',
      icon: MessageSquareText
    }
  }
  if (eventType.startsWith('agentTurn')) {
    return {
      label: 'Turn',
      chip: 'bg-amber-500/12 text-amber-700 ring-1 ring-amber-500/15',
      icon: GitBranch
    }
  }
  if (eventType.startsWith('agentRun')) {
    return {
      label: 'Run',
      chip: 'bg-sky-500/12 text-sky-700 ring-1 ring-sky-500/15',
      icon: Bot
    }
  }
  return {
    label: 'Other',
    chip: 'bg-gray-900/8 text-gray-700 ring-1 ring-gray-500/10',
    icon: Sparkles
  }
}

const shortId = (value: string | null | undefined): string => {
  const text = (value ?? '').trim()
  if (!text) return 'n/a'
  return text.length <= 10 ? text : `${text.slice(0, 8)}…`
}

const formatEventTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const base = date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${base}.${ms}`
}

const parseJson = (text: string | null): unknown => {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const summarizePayload = (eventType: string, payload: unknown): string => {
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null
  if (!record) return eventType

  if (eventType === 'agentMessageDelta') {
    const delta = typeof record.delta === 'string' ? record.delta : ''
    return delta ? `delta: ${delta.slice(0, 80)}` : 'text delta'
  }

  if (
    eventType === 'agentToolCallStarted' ||
    eventType === 'agentToolCallProgress' ||
    eventType === 'agentToolCallFinished'
  ) {
    const toolName = typeof record.toolName === 'string' ? record.toolName : 'tool'
    const result =
      eventType === 'agentToolCallProgress'
        ? record.partialResult
        : eventType === 'agentToolCallFinished'
          ? record.result
          : null
    const summary = (() => {
      const candidate =
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : null
      const content = candidate?.content
      if (!Array.isArray(content)) return ''
      return content
        .map((item) =>
          item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text'
            ? String((item as Record<string, unknown>).text ?? '')
            : ''
        )
        .filter(Boolean)
        .join('\n')
        .trim()
    })()
    return summary ? `${toolName}: ${summary.slice(0, 80)}` : toolName
  }

  if (eventType === 'agentTurnStarted' || eventType === 'agentTurnFinished') {
    const turnIndex = record.turnIndex
    return typeof turnIndex === 'number' ? `turn #${turnIndex + 1}` : 'turn'
  }

  if (
    eventType === 'agentRunFinished' ||
    eventType === 'agentRunFailed' ||
    eventType === 'agentRunAborted'
  ) {
    const status = typeof record.requestedStatus === 'string' ? record.requestedStatus : 'ended'
    return `run ${status}`
  }

  if (eventType.startsWith('debugQueue')) {
    const text = typeof record.text === 'string' ? record.text : ''
    const delivery = typeof record.delivery === 'string' ? record.delivery : 'queue'
    return text ? `${delivery}: ${text.slice(0, 80)}` : delivery
  }

  if (eventType === 'agentQueueConsumed') {
    const text = typeof record.text === 'string' ? record.text : ''
    const delivery = typeof record.delivery === 'string' ? record.delivery : 'queue'
    return text ? `${delivery}: ${text.slice(0, 80)}` : `${delivery} consumed`
  }

  if (eventType.startsWith('debugUi')) {
    if (eventType === 'debugUiContextCompactAction') {
      const changed = record.changed === true ? 'changed' : 'no-op'
      const revision = typeof record.revision === 'number' ? `rev ${record.revision}` : ''
      return ['manual compact', changed, revision].filter(Boolean).join(' · ')
    }
    if (eventType === 'debugUiContextCompactFailed') {
      const error = typeof record.error === 'string' ? record.error : 'manual compact failed'
      return error.slice(0, 80)
    }
    const text = typeof record.text === 'string' ? record.text : ''
    if (text) return text.slice(0, 80)
    const contentLength =
      typeof record.contentLength === 'number' ? `len ${record.contentLength}` : 'ui event'
    return contentLength
  }

  if (eventType.startsWith('context.compaction')) {
    const reason = typeof record.reason === 'string' ? record.reason : ''
    const revision = typeof record.revision === 'number' ? `rev ${record.revision}` : ''
    const error = typeof record.error === 'string' ? record.error : ''
    return [eventType.replace('context.compaction.', ''), reason, revision, error]
      .filter(Boolean)
      .join(' · ')
  }

  return eventType
}

const normalizedEvents = computed(() =>
  props.events.map((event) => {
    const payload = parseJson(event.payload_json)
    const raw = parseJson(event.raw_json)
    return {
      ...event,
      payload,
      raw,
      payloadPretty: payload == null ? '' : JSON.stringify(payload, null, 2),
      rawPretty: raw == null ? '' : JSON.stringify(raw, null, 2),
      summary: summarizePayload(event.event_type, payload),
      meta: categoryMeta(event.event_type)
    }
  })
)

const eventStats = computed(() => {
  let run = 0
  let turn = 0
  let message = 0
  let tool = 0
  for (const event of props.events) {
    if (event.event_type.startsWith('agentRun')) run += 1
    else if (event.event_type.startsWith('agentTurn')) turn += 1
    else if (event.event_type.startsWith('agentMessage')) message += 1
    else if (event.event_type.startsWith('agentTool')) tool += 1
  }
  return { run, turn, message, tool }
})

const emptyStateText = computed(() => {
  if (props.loading) return '正在载入 runtime 事件...'
  if (!props.threadId) return '先选择一个线程'
  if (props.selectedRunId) return '当前 run 还没有事件'
  return '当前线程还没有 runtime 事件'
})

const requestScrollToBottom = async () => {
  if (!props.isOpen) return
  await nextTick()
  if (!scrollContainer.value) return
  scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
}

watch(
  () => [props.isOpen, normalizedEvents.value.length] as const,
  () => {
    void requestScrollToBottom()
  }
)
</script>

<template>
  <transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="translate-x-4 opacity-0"
    enter-to-class="translate-x-0 opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="translate-x-0 opacity-100"
    leave-to-class="translate-x-4 opacity-0"
  >
    <aside
      v-if="isOpen"
      class="flex h-full shrink-0 overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,249,252,0.96))] backdrop-blur-xl"
      :class="
        standalone
          ? 'w-full'
          : 'w-105 max-w-[42vw] min-w-90 border-l border-slate-200/80 shadow-[-18px_0_48px_rgba(15,23,42,0.08)]'
      "
    >
      <!-- Left Sidebar Tabs -->
      <nav
        class="flex w-14 flex-col items-center border-r border-slate-200/60 bg-slate-50/50 gap-4 runtime-inspector-no-drag"
        :class="standalone ? 'pt-12 pb-6' : 'py-6'"
      >
        <button
          type="button"
          class="group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200"
          :class="
            activeTab === 'events'
              ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-400 hover:bg-white hover:text-slate-600 hover:shadow-sm'
          "
          title="Timeline"
          @click="activeTab = 'events'"
        >
          <Clock :size="20" />
          <div
            v-if="activeTab === 'events'"
            class="absolute -left-0.5 h-5 w-1 rounded-r-full bg-blue-600"
          ></div>
        </button>

        <button
          type="button"
          class="group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200"
          :class="
            activeTab === 'context'
              ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-400 hover:bg-white hover:text-slate-600 hover:shadow-sm'
          "
          title="Context"
          @click="activeTab = 'context'"
        >
          <Layers3 :size="20" />
          <div
            v-if="activeTab === 'context'"
            class="absolute -left-0.5 h-5 w-1 rounded-r-full bg-blue-600"
          ></div>
        </button>
      </nav>

      <!-- Main Content Area -->
      <div class="flex min-w-0 flex-1 flex-col">
        <!-- Sticky Header -->
        <header
          class="shrink-0 border-b border-slate-200/80 bg-white/50 px-8 pb-5 runtime-inspector-drag"
          :class="standalone ? 'pt-12' : 'pt-6'"
        >
          <div class="flex items-start justify-between gap-6 pl-4 runtime-inspector-no-drag">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-3">
                <h3 class="text-base font-bold tracking-tight text-slate-900 uppercase">
                  {{ activeTab === 'events' ? 'Timeline' : 'Context' }}
                </h3>
                <span class="h-1.5 w-1.5 rounded-full bg-slate-200"></span>
                <p class="truncate text-xs font-medium text-slate-400">
                  {{ threadId || '未选择线程' }}
                </p>
              </div>

              <!-- Stats Grid (Fixed) -->
              <div class="mt-4 flex items-center gap-3">
                <div
                  class="flex items-center gap-2 rounded-xl bg-sky-500/8 px-2.5 py-1.5 text-sky-700 ring-1 ring-inset ring-sky-500/10"
                >
                  <span class="text-xs font-bold">{{ eventStats.run }}</span>
                  <span class="text-[10px] font-bold uppercase opacity-60">run</span>
                </div>
                <div
                  class="flex items-center gap-2 rounded-xl bg-amber-500/8 px-2.5 py-1.5 text-amber-700 ring-1 ring-inset ring-amber-500/10"
                >
                  <span class="text-xs font-bold">{{ eventStats.turn }}</span>
                  <span class="text-[10px] font-bold uppercase opacity-60">turn</span>
                </div>
                <div
                  class="flex items-center gap-2 rounded-xl bg-emerald-500/8 px-2.5 py-1.5 text-emerald-700 ring-1 ring-inset ring-emerald-500/10"
                >
                  <span class="text-xs font-bold">{{ eventStats.message }}</span>
                  <span class="text-[10px] font-bold uppercase opacity-60">msg</span>
                </div>
                <div
                  class="flex items-center gap-2 rounded-xl bg-slate-900/6 px-2.5 py-1.5 text-slate-700 ring-1 ring-inset ring-slate-900/5"
                >
                  <span class="text-xs font-bold">{{ eventStats.tool }}</span>
                  <span class="text-[10px] font-bold uppercase opacity-60">tool</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 runtime-inspector-no-drag pt-1">
              <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:shadow-sm hover:text-slate-900"
                :disabled="loading"
                title="刷新"
                @click="emit('refresh')"
              >
                <RefreshCw :size="15" :class="loading ? 'animate-spin' : ''" />
              </button>
              <button
                v-if="!standalone"
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:shadow-sm hover:text-slate-900"
                title="关闭"
                @click="emit('close')"
              >
                <X :size="15" />
              </button>
            </div>
          </div>

          <!-- Run Selector (only for events tab) -->
          <div v-if="activeTab === 'events'" class="mt-4 runtime-inspector-no-drag">
            <div class="relative max-w-50">
              <select
                class="w-full appearance-none rounded-xl border border-slate-200 bg-white pl-4 pr-10 py-2 text-xs font-medium text-slate-600 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 runtime-inspector-no-drag"
                :value="selectedRunId || ''"
                @change="emit('select-run', ($event.target as HTMLSelectElement).value || null)"
              >
                <option value="">所有运行记录</option>
                <option v-for="run in runOptions" :key="run.id" :value="run.id">
                  {{ run.label }}
                </option>
              </select>
              <div
                class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              >
                <Bot :size="14" />
              </div>
            </div>
          </div>
        </header>

        <!-- Scrollable Content -->
        <main ref="scrollContainer" class="custom-scrollbar flex-1 overflow-y-auto px-8 py-6">
          <div v-if="activeTab === 'context'">
            <ContextDebugPanel
              :thread-id="threadId"
              :snapshot="contextSnapshot"
              :loading="contextLoading"
              :compacting="contextCompacting"
              standalone
              @compact="emit('compact-context')"
              @open-settings="emit('open-context-settings')"
            />
          </div>

          <div v-else-if="activeTab === 'events'">
            <div
              v-if="normalizedEvents.length === 0"
              class="flex h-full items-center justify-center"
            >
              <div
                class="max-w-65 rounded-3xl border border-dashed border-slate-200 bg-white/70 px-5 py-6 text-center"
              >
                <div class="text-sm font-medium text-slate-700">{{ emptyStateText }}</div>
                <div class="mt-2 text-xs leading-5 text-slate-500">
                  只展示当前窗口实时收到的 live 内存事件，不读取数据库历史数据。
                </div>
              </div>
            </div>

            <div v-else class="space-y-3 pr-1">
              <article
                v-for="event in normalizedEvents"
                :key="event.id"
                class="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/90 shadow-[0_4px_18px_rgba(15,23,42,0.05)]"
              >
                <div class="flex items-start gap-3 px-4 py-3.5">
                  <div
                    class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl"
                    :class="event.meta.chip"
                  >
                    <component :is="event.meta.icon" :size="15" />
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span
                        class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                        :class="event.meta.chip"
                      >
                        {{ event.meta.label }}
                      </span>
                      <code class="truncate text-[11px] font-medium text-slate-500">
                        {{ event.event_type }}
                      </code>
                    </div>

                    <div class="mt-2 text-sm font-medium leading-5 text-slate-900">
                      {{ event.summary }}
                    </div>

                    <div
                      class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500"
                    >
                      <span>{{ formatEventTime(event.created_at) }}</span>
                      <span>origin: {{ event.event_origin }}</span>
                      <span>run: {{ shortId(event.agent_run_id) }}</span>
                      <span>corr: {{ shortId(event.correlation_id) }}</span>
                    </div>
                  </div>
                </div>

                <details class="border-t border-slate-100 bg-slate-50/70 px-4 py-3">
                  <summary class="cursor-pointer list-none text-xs font-medium text-slate-600">
                    查看 payload / raw
                  </summary>
                  <div class="mt-3 space-y-3">
                    <div>
                      <div class="mb-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                        payload
                      </div>
                      <pre
                        class="overflow-x-auto rounded-2xl bg-slate-950 px-3 py-3 text-[11px] leading-5 text-slate-100"
                        >{{ event.payloadPretty || '{}' }}</pre
                      >
                    </div>
                    <div v-if="event.rawPretty">
                      <div class="mb-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                        raw
                      </div>
                      <pre
                        class="overflow-x-auto rounded-2xl bg-slate-900 px-3 py-3 text-[11px] leading-5 text-slate-200"
                        >{{ event.rawPretty }}</pre
                      >
                    </div>
                  </div>
                </details>
              </article>
            </div>
          </div>
        </main>
      </div>
    </aside>
  </transition>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(15, 23, 42, 0.1);
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(15, 23, 42, 0.2);
}

.runtime-inspector-drag {
  -webkit-app-region: drag;
}

.runtime-inspector-no-drag {
  -webkit-app-region: no-drag;
}
</style>
