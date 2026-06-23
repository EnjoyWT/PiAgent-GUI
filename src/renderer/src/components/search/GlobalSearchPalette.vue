<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Search, X } from 'lucide-vue-next'
import { YLAnimatedCaret } from 'yl-animated-caret'
import type {
  ConversationSearchResultItem,
  ConversationSearchRole
} from '../../../../main/core-v2/domain'

type FilterId = 'all' | 'workspace' | 'current' | 'user' | 'assistant' | 'tool'

const props = defineProps<{
  open: boolean
  currentWorkspacePath?: string | null
  currentThreadId?: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open-result', item: ConversationSearchResultItem): void
}>()

const query = ref('')
const activeFilter = ref<FilterId>('all')
const items = ref<ConversationSearchResultItem[]>([])
const total = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const errorText = ref<string | null>(null)
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
let debounceTimer: number | null = null
let requestSeq = 0

const PAGE_SIZE = 50

const filters = computed<Array<{ id: FilterId; label: string; disabled?: boolean }>>(() => [
  { id: 'all', label: '全部' },
  { id: 'workspace', label: '当前工作区', disabled: !props.currentWorkspacePath },
  { id: 'current', label: '当前会话', disabled: !props.currentThreadId },
  { id: 'user', label: '用户消息' },
  { id: 'assistant', label: '助手消息' },
  { id: 'tool', label: '工具消息' }
])

const roleForFilter = (filter: FilterId): ConversationSearchRole[] | null => {
  if (filter === 'user' || filter === 'assistant' || filter === 'tool') return [filter]
  return null
}

const canSearch = computed(() => query.value.trim().length >= 2)

const search = async (offset = 0): Promise<void> => {
  const normalized = query.value.trim()
  if (normalized.length < 2) {
    items.value = []
    total.value = 0
    hasMore.value = false
    errorText.value = null
    return
  }

  const seq = ++requestSeq
  loading.value = true
  errorText.value = null
  try {
    const filter = activeFilter.value
    const result = await window.api.coreV2.messages.search({
      query: normalized,
      limit: PAGE_SIZE,
      offset,
      workspacePath: filter === 'workspace' ? props.currentWorkspacePath : null,
      threadId: filter === 'current' ? props.currentThreadId : null,
      roles: roleForFilter(filter)
    })
    if (seq !== requestSeq) return
    items.value = offset > 0 ? [...items.value, ...result.items] : result.items
    total.value = result.total
    hasMore.value = result.hasMore
    selectedIndex.value =
      items.value.length > 0 ? Math.min(selectedIndex.value, items.value.length - 1) : 0
  } catch (error) {
    if (seq !== requestSeq) return
    errorText.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

const scheduleSearch = (): void => {
  if (debounceTimer !== null) window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => void search(0), 200)
}

const close = (): void => emit('close')

const openSelected = (): void => {
  const item = items.value[selectedIndex.value]
  if (!item) return
  emit('open-result', item)
}

const onKeydown = (event: KeyboardEvent): void => {
  if (!props.open) return
  if (event.key === 'Escape' || event.key === 'Esc') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = Math.min(items.value.length - 1, selectedIndex.value + 1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = Math.max(0, selectedIndex.value - 1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    openSelected()
  }
}

const setFilter = (filter: FilterId): void => {
  const option = filters.value.find((item) => item.id === filter)
  if (option?.disabled) return
  activeFilter.value = filter
}

const loadMore = (): void => {
  if (loading.value || !hasMore.value) return
  void search(items.value.length)
}

const displayTitle = (item: ConversationSearchResultItem): string =>
  item.title?.trim() || '未命名会话'

const displayWorkspace = (path?: string | null): string => {
  const value = path?.trim()
  if (!value) return '无工作区'
  return value.split(/[\\/]/).filter(Boolean).pop() || value
}

const roleLabel = (role: string): string => {
  if (role === 'user') return '用户'
  if (role === 'assistant') return '助手'
  return '工具'
}

const formatTime = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  }
)

watch([query, activeFilter], () => scheduleSearch())

onMounted(() => document.addEventListener('keydown', onKeydown, true))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, true)
  if (debounceTimer !== null) window.clearTimeout(debounceTimer)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="search-palette-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-999 flex justify-center bg-slate-950/28 px-6 pt-18 backdrop-blur-sm"
        @mousedown.self="close"
      >
        <div
          class="flex h-[min(620px,calc(100vh-110px))] w-[min(800px,calc(100vw-48px))] flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/95 shadow-[0_30px_110px_rgba(15,23,42,.32)]"
        >
          <div class="flex h-18 shrink-0 items-center gap-3 border-b border-slate-200/70 px-5">
            <div
              class="search-palette-input-box relative flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-2xl border border-(--chat-input-border-idle) bg-(--theme-bg-main)/90 px-3 py-2 outline-none backdrop-blur-md focus-within:outline-none focus-within:ring-0 focus-within:ring-transparent"
              @mousedown="inputRef?.focus()"
            >
              <Search :size="17" class="shrink-0 text-(--theme-text-dim)" />
              <YLAnimatedCaret
                class="block! min-w-0 flex-1"
                :trail-count="2"
                :breathe-duration="1.6"
              >
                <input
                  ref="inputRef"
                  v-model="query"
                  type="text"
                  autocomplete="off"
                  class="no-theme-form-control no-focus-ring w-full resize-none border-none bg-transparent text-[14px] leading-snug text-(--theme-text-main) outline-none placeholder:text-(--theme-text-dim) focus:ring-0 focus:outline-none focus-visible:outline-none"
                  placeholder="搜索历史消息…"
                />
              </YLAnimatedCaret>
            </div>
            <button
              class="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              @click="close"
            >
              <X :size="18" />
            </button>
          </div>

          <div class="flex shrink-0 gap-2 px-4 py-3">
            <button
              v-for="filter in filters"
              :key="filter.id"
              type="button"
              class="rounded-full px-3 py-1.5 text-xs font-medium transition"
              :class="[
                activeFilter === filter.id
                  ? 'bg-indigo-500/12 text-indigo-600'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200/70',
                filter.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
              ]"
              :disabled="filter.disabled"
              @click="setFilter(filter.id)"
            >
              {{ filter.label }}
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <div
              v-if="!canSearch"
              class="flex h-full items-center justify-center text-sm text-slate-400"
            >
              输入至少 2 个字开始搜索
            </div>
            <div v-else-if="errorText" class="rounded-2xl bg-red-50 p-4 text-sm text-red-600">
              搜索失败：{{ errorText }}
            </div>
            <div
              v-else-if="!loading && items.length === 0"
              class="flex h-full items-center justify-center text-sm text-slate-400"
            >
              没搜到，换个关键词试试
            </div>
            <template v-else>
              <button
                v-for="(item, index) in items"
                :key="item.messageId"
                type="button"
                class="grid w-full grid-cols-[2rem_1fr_auto] gap-3 rounded-2xl border p-3 text-left transition"
                :class="
                  index === selectedIndex
                    ? 'border-indigo-200 bg-indigo-50/80 shadow-sm'
                    : 'border-transparent hover:bg-slate-50'
                "
                @mouseenter="selectedIndex = index"
                @click="emit('open-result', item)"
              >
                <div
                  class="grid h-8 w-8 place-items-center rounded-xl text-xs font-bold"
                  :class="
                    item.role === 'user'
                      ? 'bg-blue-100 text-blue-600'
                      : item.role === 'assistant'
                        ? 'bg-violet-100 text-violet-600'
                        : 'bg-emerald-100 text-emerald-600'
                  "
                >
                  {{ roleLabel(item.role).slice(0, 1) }}
                </div>
                <div class="min-w-0">
                  <div class="mb-1 flex min-w-0 items-center gap-2">
                    <span class="truncate text-sm font-bold text-slate-900">{{
                      displayTitle(item)
                    }}</span>
                    <span class="shrink-0 text-xs text-slate-400">{{
                      displayWorkspace(item.workspacePath)
                    }}</span>
                    <span class="shrink-0 text-xs text-slate-300">·</span>
                    <span class="shrink-0 text-xs text-slate-400">{{ roleLabel(item.role) }}</span>
                  </div>
                  <div
                    class="line-clamp-2 text-sm leading-6 text-slate-600"
                    v-html="item.snippet"
                  ></div>
                </div>
                <div class="pt-1 text-xs text-slate-400">{{ formatTime(item.createdAt) }}</div>
              </button>

              <div class="flex items-center justify-between px-2 py-3 text-xs text-slate-400">
                <span>找到 {{ total }} 条，已显示 {{ items.length }} 条</span>
                <button
                  v-if="hasMore"
                  type="button"
                  class="rounded-full bg-slate-100 px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-200"
                  :disabled="loading"
                  @click="loadMore"
                >
                  {{ loading ? '加载中…' : '加载更多' }}
                </button>
              </div>
            </template>
          </div>

          <div
            class="flex h-10 shrink-0 items-center gap-4 border-t border-slate-200/70 bg-slate-50/80 px-5 text-xs text-slate-400"
          >
            <span>↑↓ 选择</span>
            <span>Enter 打开并定位消息</span>
            <span>⌘K / Ctrl+K 打开搜索</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.search-palette-input-box {
  transition:
    border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow:
    0 8px 30px rgba(0, 0, 0, 0.04),
    0 20px 40px rgba(0, 0, 0, 0.03),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset,
    0 1px 1px rgba(0, 0, 0, 0.02);
}

.search-palette-input-box:focus-within {
  border-color: color-mix(in srgb, var(--focus-ring-color) 4%, var(--theme-border-base));
  box-shadow:
    0 9px 28px rgba(0, 0, 0, 0.055),
    0 18px 34px rgba(0, 0, 0, 0.038),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset,
    0 1px 1px rgba(0, 0, 0, 0.02),
    0 0 9px 1px color-mix(in srgb, var(--focus-ring-color) 5%, transparent),
    0 0 16px 3px color-mix(in srgb, var(--focus-ring-color) 2.5%, transparent);
}

.no-focus-ring:focus,
.no-focus-ring:focus-visible {
  outline: none;
  box-shadow: none;
  border-color: transparent;
}

.search-palette-fade-enter-active,
.search-palette-fade-leave-active {
  transition: opacity 160ms ease;
}
.search-palette-fade-enter-from,
.search-palette-fade-leave-to {
  opacity: 0;
}
:deep(mark) {
  border-radius: 4px;
  background: rgba(250, 204, 21, 0.45);
  color: rgb(113, 63, 18);
  font-weight: 700;
  padding: 0 2px;
}
</style>
