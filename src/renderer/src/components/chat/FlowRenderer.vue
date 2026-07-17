<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  Brain,
  CircleCheckBig,
  CircleX,
  Clock3,
  Image as ImageIcon,
  Wrench,
  ChevronRight,
  ChevronDown,
  Search,
  Globe
} from 'lucide-vue-next'
import GitDiffView from './GitDiffView.vue'
import MarkdownContent from './MarkdownContent.vue'
import Tooltip from '../common/Tooltip.vue'
import TransportSetupQrBlock from './TransportSetupQrBlock.vue'
import WidgetContainer from './WidgetContainer.vue'
import type { ChatToolStep } from './types'
import type { MessageRenderBlock } from './flow-blocks'
import type { TransportSetupQrProjection } from '@shared/agent-runtime'
import { formatToolCommand } from './tool-command-format'

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

// ── 内容平滑显示逻辑 (通用) ──────────────────────────────────────────
type ContentDisplayBlock = Extract<
  MessageRenderBlock,
  { kind: 'thinking' | 'text' | 'questionnaire_question' }
>

function getDisplayedContent(block: ContentDisplayBlock): string {
  return block.kind === 'thinking' ? block.thinking : block.text
}
// ──────────────────────────────────────────────────────────────────

const formatThinkingDuration = (durationMs: number): string => {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  const seconds = durationMs / 1000
  return `${Number(seconds.toFixed(1))} s`
}

const nowMs = ref(Date.now())
let nowTimer: number | null = null

const hasActiveThinking = computed(() =>
  props.blocks.some((block) => block.kind === 'thinking' && block.isActive)
)

watch(
  hasActiveThinking,
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

const getThinkingDurationMs = (block: Extract<MessageRenderBlock, { kind: 'thinking' }>): number =>
  Math.max(0, (block.endedAt ?? nowMs.value) - block.startedAt)

const getThinkingStatusText = (block: Extract<MessageRenderBlock, { kind: 'thinking' }>): string =>
  block.endedAt == null && !block.thinking.trim()
    ? '思考中'
    : `思考了 ${formatThinkingDuration(getThinkingDurationMs(block))}`

const thinkingExpandedById = ref<Record<string, boolean>>({})
const expandedToolIds = ref<Record<string, boolean>>({})
const expandedErrorIds = ref<Record<string, boolean>>({})
const intermediateProcessCollapsed = ref(false)
const intermediateProcessUserToggled = ref(false)

const finalAnswerBlockId = computed(() => {
  let maxTurnIndex = -1
  for (const block of props.blocks) {
    if (block.turnIndex !== undefined && block.turnIndex > maxTurnIndex) {
      maxTurnIndex = block.turnIndex
    }
  }

  for (let index = props.blocks.length - 1; index >= 0; index -= 1) {
    const block = props.blocks[index]
    if (
      block?.kind === 'text' &&
      block.text.trim() &&
      (block.turnIndex === undefined || block.turnIndex === maxTurnIndex)
    ) {
      return block.id
    }
  }
  return null
})

const hasFinalAnswer = computed(() => finalAnswerBlockId.value != null)
const hasIntermediateProcess = computed(
  () =>
    props.showIntermediateSummary !== false &&
    hasFinalAnswer.value &&
    props.blocks.some((block) => block.id !== finalAnswerBlockId.value)
)

const processedDurationMs = computed(() => {
  const thinkingDuration = props.blocks.reduce((total, block) => {
    if (block.kind !== 'thinking') return total
    return total + Math.max(0, (block.endedAt ?? nowMs.value) - block.startedAt)
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

// ── 思考块内部滚动控制 ────────────────────────────────────────────────
const thinkingScrollRefs = new Map<string, HTMLElement>()
const thinkingScrollPinnedById = new Map<string, boolean>()
const thinkingScrollCleanupById = new Map<string, () => void>()

const resolveThinkingScrollElement = (value: unknown): HTMLElement | null => {
  const dom =
    value && typeof value === 'object' && '$el' in value ? (value as { $el?: unknown }).$el : value
  return dom instanceof HTMLElement ? dom : null
}

const isThinkingScrollPinned = (el: HTMLElement): boolean =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= 30

const cleanupThinkingScrollRef = (id: string): void => {
  thinkingScrollCleanupById.get(id)?.()
  thinkingScrollCleanupById.delete(id)
  thinkingScrollRefs.delete(id)
  thinkingScrollPinnedById.delete(id)
}

const setThinkingScrollRef = (id: string, value: unknown): void => {
  const el = resolveThinkingScrollElement(value)
  const existing = thinkingScrollRefs.get(id)
  if (!el) {
    cleanupThinkingScrollRef(id)
    return
  }

  if (existing === el) {
    thinkingScrollPinnedById.set(id, isThinkingScrollPinned(el))
    return
  }

  cleanupThinkingScrollRef(id)
  thinkingScrollRefs.set(id, el)

  const handleScroll = (): void => {
    thinkingScrollPinnedById.set(id, isThinkingScrollPinned(el))
  }

  el.addEventListener('scroll', handleScroll, { passive: true })
  thinkingScrollCleanupById.set(id, () => {
    el.removeEventListener('scroll', handleScroll)
  })
  thinkingScrollPinnedById.set(id, true)
}

let thinkingScrollRafId: number | null = null
type ThinkingScrollBehavior = 'auto' | 'smooth'
const scrollThinkingToBottom = (
  el: HTMLElement,
  id: string,
  behavior: ThinkingScrollBehavior = 'auto'
): void => {
  if (behavior === 'auto') {
    el.scrollTop = el.scrollHeight
    thinkingScrollPinnedById.set(id, true)
    return
  }
  if (thinkingScrollRafId !== null) return
  thinkingScrollRafId = requestAnimationFrame(() => {
    el.scrollTo({
      top: el.scrollHeight,
      behavior
    })
    thinkingScrollPinnedById.set(id, true)
    thinkingScrollRafId = null
  })
}

// 仅监听活跃思考块的内容变化，而不是深听整个 blocks 数组
const activeThinkingBlock = computed(
  () =>
    props.blocks.find((b) => b.kind === 'thinking' && b.isActive) as
      Extract<MessageRenderBlock, { kind: 'thinking' }> | undefined
)

watch(
  () => activeThinkingBlock.value?.thinking,
  async (newThinkingText) => {
    const block = activeThinkingBlock.value
    if (!block || newThinkingText == null) return
    const el = thinkingScrollRefs.get(block.id)
    if (!el) return
    const shouldFollow = thinkingScrollPinnedById.get(block.id) ?? true
    if (shouldFollow) {
      scrollThinkingToBottom(el, block.id, 'auto')
    }
  },
  { flush: 'post' }
)

// 监听正文内容的变化，触发整体布局刷新（让外层滚动条跟着动）
const activeTextBlock = computed(
  () =>
    props.blocks.find(
      (b) => (b.kind === 'text' || b.kind === 'questionnaire_question') && b.isActive
    ) as Extract<MessageRenderBlock, { kind: 'text' | 'questionnaire_question' }> | undefined
)

watch(
  () => activeTextBlock.value?.text,
  () => {
    // 每次模拟流吐字时，通知外层容器（ChatView 等）内容高度变了，该滚就滚
    emit('widget-layout-change')
  },
  { flush: 'post' }
)

watch(
  () => activeThinkingBlock.value?.id,
  async (blockId) => {
    if (!blockId) return
    await nextTick()
    const el = thinkingScrollRefs.get(blockId)
    if (!el) return
    scrollThinkingToBottom(el, blockId)
  },
  { flush: 'post' }
)

onBeforeUnmount(() => {
  if (thinkingScrollRafId !== null) cancelAnimationFrame(thinkingScrollRafId)
  for (const cleanup of thinkingScrollCleanupById.values()) cleanup()
  thinkingScrollCleanupById.clear()
  thinkingScrollRefs.clear()
  thinkingScrollPinnedById.clear()
})
// ──────────────────────────────────────────────────────────────────

const isThinkingExpanded = (id: string, endedAt: number | undefined): boolean =>
  thinkingExpandedById.value[id] ?? endedAt == null

const toggleThinking = (id: string, endedAt: number | undefined): void => {
  thinkingExpandedById.value = {
    ...thinkingExpandedById.value,
    [id]: !isThinkingExpanded(id, endedAt)
  }
}

watch(
  () =>
    props.blocks
      .filter(
        (block): block is Extract<MessageRenderBlock, { kind: 'thinking' }> =>
          block.kind === 'thinking'
      )
      .map((block) => ({ id: block.id, endedAt: block.endedAt })),
  (blocks, previousBlocks) => {
    const prevEndedAtById = new Map(previousBlocks?.map((block) => [block.id, block.endedAt]) ?? [])
    const next = { ...thinkingExpandedById.value }
    let changed = false
    for (const block of blocks) {
      if (next[block.id] == null) {
        next[block.id] = block.endedAt == null
        changed = true
        continue
      }
      const prevEndedAt = prevEndedAtById.get(block.id)
      if (prevEndedAt == null && block.endedAt != null && next[block.id]) {
        next[block.id] = false
        changed = true
      }
    }
    if (changed) thinkingExpandedById.value = next
  },
  { immediate: true }
)

watch(
  () =>
    props.blocks
      .filter(
        (block): block is Extract<MessageRenderBlock, { kind: 'turn_error' }> =>
          block.kind === 'turn_error'
      )
      .map((block) => block.id)
      .join('|'),
  () => {
    const next = { ...expandedErrorIds.value }
    let changed = false
    for (const block of props.blocks) {
      if (block.kind !== 'turn_error') continue
      if (next[block.id] != null) continue
      next[block.id] = false
      changed = true
    }
    if (changed) expandedErrorIds.value = next
  },
  { immediate: true }
)

watch(
  () =>
    props.blocks
      .filter(
        (block): block is Extract<MessageRenderBlock, { kind: 'tool' | 'file' }> =>
          block.kind === 'tool' || block.kind === 'file'
      )
      .map((block) => block.id)
      .join('|'),
  () => {
    const next = { ...expandedToolIds.value }
    let changed = false
    for (const block of props.blocks) {
      if (block.kind !== 'tool' && block.kind !== 'file') continue
      if (next[block.id] != null) continue
      next[block.id] = false
      changed = true
    }
    if (changed) expandedToolIds.value = next
  },
  { immediate: true }
)

const toggleTool = (id: string): void => {
  expandedToolIds.value = {
    ...expandedToolIds.value,
    [id]: !isToolExpanded(id)
  }
}

const isToolExpanded = (id: string): boolean => {
  const userToggled = expandedToolIds.value[id]
  if (userToggled != null) return userToggled

  const block = props.blocks.find((b) => b.id === id)
  if (
    block &&
    (block.kind === 'tool' || block.kind === 'file') &&
    block.step.status === 'running'
  ) {
    return true
  }
  return false
}

const isErrorExpanded = (id: string): boolean => Boolean(expandedErrorIds.value[id])

const toggleError = (id: string): void => {
  expandedErrorIds.value = {
    ...expandedErrorIds.value,
    [id]: !expandedErrorIds.value[id]
  }
}

type DiffParts = { prefix: string; diff: string; suffix: string }

const tryExtractDiffParts = (raw: string): DiffParts | null => {
  const text = raw ?? ''
  if (!text.trim()) return null

  const fenceRe = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)\n?```/m
  const match = fenceRe.exec(text)
  if (match) {
    const lang = (match[1] ?? '').toLowerCase()
    const body = match[2] ?? ''
    const looksLikeDiff =
      lang === 'diff' ||
      lang === 'patch' ||
      /^diff --git /m.test(body) ||
      /^@@ /m.test(body) ||
      /^---\s+/m.test(body)
    if (looksLikeDiff && /^@@ /m.test(body)) {
      return {
        prefix: text.slice(0, match.index).trimEnd(),
        diff: body.trim(),
        suffix: text.slice(match.index + match[0].length).trimStart()
      }
    }
  }

  const looksLikeUnified =
    /^diff --git /m.test(text) ||
    (/^---\s+/m.test(text) && /^\+\+\+\s+/m.test(text) && /^@@ /m.test(text)) ||
    /^@@ /m.test(text)
  if (!looksLikeUnified || !/^@@ /m.test(text)) return null
  return { prefix: '', diff: text.trim(), suffix: '' }
}

const getDisplayedDiffParts = (
  block: Extract<MessageRenderBlock, { kind: 'text' | 'questionnaire_question' }>
): DiffParts | null => tryExtractDiffParts(getDisplayedContent(block))

const normalizeToolName = (name: string): string => (name || '').trim().toLowerCase()

const extractCommand = (step: ChatToolStep): string => formatToolCommand(step)

const extractOutput = (step: ChatToolStep): string => (step.summary || '').trim()

const getToolStatusLabel = (step: ChatToolStep): string => {
  if (step.status === 'running') return 'Running'
  if (step.status === 'done') return 'Completed'
  return 'Failed'
}

const getToolHeaderLabel = (step: ChatToolStep): string => {
  const name = (step.toolName || '').trim()
  if (!name) return 'Tool'

  const norm = name.toLowerCase()
  if (norm === 'websearchtool') {
    if (step.status === 'running') return '正在搜索 Google...'
    if (step.status === 'done') return '搜索 Google 已完成'
    return '搜索 Google'
  }
  if (norm === 'webfetchtool') {
    if (step.status === 'running') return '正在读取网页内容...'
    if (step.status === 'done') return '网页内容读取完成'
    return '读取网页内容'
  }

  return name.slice(0, 1).toUpperCase() + name.slice(1)
}

const shouldShowToolDuration = (step: ChatToolStep): boolean =>
  step.toolKind !== 'question' &&
  normalizeToolName(step.toolName) !== 'questionnairetool' &&
  step.durationMs != null

const shouldShowToolStatusIcon = (step: ChatToolStep): boolean =>
  normalizeToolName(step.toolName) !== 'questionnairetool'

const onWidgetAction = (payload: { action: string; text: string }): void => {
  emit('widget-action', payload)
}

const onTransportSetupRegenerate = (payload: TransportSetupQrProjection): void => {
  emit('transport-setup-regenerate', payload)
}

const isAbsolutePath = (filePath: string): boolean =>
  filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\')

const joinWorkspacePath = (workspacePath: string, filePath: string): string =>
  `${workspacePath.replace(/[\\/]+$/, '')}/${filePath.replace(/^[\\/]+/, '')}`

const resolveFileDisplayPath = (filePath: string): string => {
  const path = filePath.trim()
  if (!path || isAbsolutePath(path)) return path

  const workspacePath = String(props.workspacePath ?? '').trim()
  return workspacePath ? joinWorkspacePath(workspacePath, path) : path
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
      <span class="text-[13px] font-medium leading-relaxed"
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
      <div v-if="block.kind === 'thinking'" class="w-fit max-w-full">
        <button
          type="button"
          class="hover-expand-x inline-flex items-center gap-2 rounded-lg py-1 pr-2 text-(--theme-text-dim) transition-colors hover:bg-(--theme-bg-hover-btn) flex-nowrap whitespace-nowrap"
          @click="toggleThinking(block.id, block.endedAt)"
        >
          <Brain :size="15" class="shrink-0 text-(--theme-text-dim)" />
          <span
            class="text-[13px] font-medium leading-relaxed shrink-0"
            :class="{ 'thinking-shimmer-text': block.isActive }"
          >
            {{ getThinkingStatusText(block) }}
          </span>
          <ChevronDown
            v-if="isThinkingExpanded(block.id, block.endedAt)"
            :size="14"
            class="shrink-0 text-(--theme-text-dim)"
          />
          <ChevronRight v-else :size="14" class="shrink-0 text-(--theme-text-dim)" />
        </button>
        <Transition name="flow-expand">
          <div v-if="isThinkingExpanded(block.id, block.endedAt)" class="flow-expand-shell">
            <div class="flow-expand-inner">
              <div
                class="mt-2 w-fit min-w-100 max-w-full border-l-3 border-(--theme-text-dim)/60 pl-4 md:max-w-[70%]"
              >
                <MarkdownContent
                  :ref="(el) => setThinkingScrollRef(block.id, el)"
                  :content="getDisplayedContent(block) || '模型正在思考...'"
                  :is-streaming="block.isActive"
                  class="thinking-markdown max-h-80 overflow-auto text-[12px] text-(--theme-text-main)"
                />
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <template v-else-if="block.kind === 'text' || block.kind === 'questionnaire_question'">
        <MarkdownContent
          v-if="block.isActive"
          :content="getDisplayedContent(block)"
          :is-streaming="true"
          class="text-sm text-(--theme-text-main)"
        />
        <MarkdownContent
          v-else-if="getDisplayedDiffParts(block)?.prefix"
          :content="getDisplayedDiffParts(block)?.prefix || ''"
          class="text-sm"
        />
        <div
          v-if="!block.isActive && getDisplayedDiffParts(block)?.diff"
          class="my-2 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-content)/70 p-2"
        >
          <GitDiffView :diff="getDisplayedDiffParts(block)?.diff || ''" />
        </div>
        <MarkdownContent
          v-if="!block.isActive && getDisplayedDiffParts(block)?.suffix"
          :content="getDisplayedDiffParts(block)?.suffix || ''"
          class="text-sm"
        />
        <MarkdownContent
          v-if="!block.isActive && !getDisplayedDiffParts(block)"
          :content="getDisplayedContent(block)"
          class="text-sm"
        />
      </template>

      <div
        v-else-if="block.kind === 'question_answer' || block.kind === 'questionnaire_answer'"
        class="w-full flex justify-end"
      >
        <div class="group w-full min-w-0 flex flex-col items-end">
          <div
            class="w-fit self-end rounded-xl border bg-(--theme-bg-user-content) border-(--theme-border-user-content) px-2.25 py-1 max-w-[78%]"
          >
            <div
              class="prose prose-sm max-w-none text-sm text-(--theme-text-user) whitespace-pre-wrap leading-relaxed"
              v-text="block.text"
            />
          </div>
        </div>
      </div>

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

      <div v-else-if="block.kind === 'tool_image'" class="w-full py-1">
        <figure
          class="max-w-[min(720px,92vw)] overflow-hidden rounded-lg border border-(--theme-border-base) bg-(--theme-bg-content)/70"
        >
          <div
            class="flex items-center gap-1.5 border-b border-(--theme-border-base) px-2.5 py-1.5 text-[12px] text-(--theme-text-dim)"
          >
            <ImageIcon :size="14" class="shrink-0" />
            <span class="truncate">{{ block.image.title }}</span>
            <span
              v-if="block.image.width && block.image.height"
              class="ml-auto shrink-0 tabular-nums"
            >
              {{ block.image.width }}×{{ block.image.height }}
            </span>
          </div>
          <img
            :src="block.image.url"
            :alt="block.image.title"
            class="block h-auto max-h-[520px] w-full object-contain"
            loading="lazy"
            @load="emit('widget-layout-change')"
          />
        </figure>
      </div>

      <div v-else-if="block.kind === 'turn_error'" class="w-fit min-w-120 max-w-full">
        <button
          type="button"
          class="hover-expand-x inline-flex max-w-full items-center gap-2 rounded-lg py-1 text-rose-700/80 transition-colors hover:bg-rose-50/70"
          @click="toggleError(block.id)"
        >
          <CircleX :size="14" class="shrink-0 text-rose-500" />
          <span class="text-[13px] font-medium">上一轮执行已中断</span>
          <ChevronDown v-if="isErrorExpanded(block.id)" :size="14" class="shrink-0 text-rose-400" />
          <ChevronRight v-else :size="14" class="shrink-0 text-rose-400" />
        </button>
        <Transition name="flow-expand">
          <div v-if="isErrorExpanded(block.id)" class="flow-expand-shell">
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

      <div v-else-if="block.kind === 'question_prompt'" class="w-full">
        <button
          type="button"
          class="hover-expand-x inline-flex min-w-20 max-w-full items-center gap-1.5 rounded-lg py-1 pr-1.5 text-[12px] text-(--theme-text-dim) hover:bg-(--theme-bg-hover-item) transition-colors"
          @click="toggleTool(block.id)"
        >
          <Wrench :size="15" class="shrink-0 text-(--theme-text-dim)" />
          <span class="truncate text-[12px] font-medium text-(--theme-text-main) leading-relaxed">{{
            getToolHeaderLabel(block.step)
          }}</span>
          <Brain
            v-if="block.step.status === 'running'"
            :size="14"
            class="text-(--theme-text-dim)"
          />
          <ChevronDown
            v-if="isToolExpanded(block.id)"
            :size="14"
            class="shrink-0 text-(--theme-text-dim)"
          />
          <ChevronRight v-else :size="14" class="shrink-0 text-(--theme-text-dim)" />
        </button>

        <Transition name="flow-expand">
          <div v-if="isToolExpanded(block.id)" class="flow-expand-shell">
            <div class="flow-expand-inner">
              <div
                class="mt-2 w-fit max-w-full md:max-w-[70%] min-w-100 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-content)/70 px-3 py-2"
              >
                <div v-if="extractCommand(block.step)">
                  <div class="text-[11px] font-semibold tracking-wide text-(--theme-text-dim)">
                    COMMAND
                  </div>
                  <pre
                    class="mt-1 max-h-24 overflow-auto rounded-md border border-dashed border-(--theme-border-base) bg-(--theme-bg-main) p-2 text-[11px] text-(--theme-text-main)"
                  ><code>{{ extractCommand(block.step) }}</code></pre>
                </div>
              </div>
            </div>
          </div>
        </Transition>

        <div class="mt-1.5 pl-0 pb-1">
          <div class="text-sm text-(--theme-text-main) whitespace-pre-wrap leading-relaxed">
            {{ block.prompt }}
          </div>
        </div>
      </div>

      <template v-else>
        <button
          type="button"
          class="hover-expand-x inline-flex min-w-20 max-w-full items-center gap-1.5 rounded-lg py-1 pr-1.5 text-[12px] text-(--theme-text-dim) hover:bg-(--theme-bg-hover-item) transition-colors"
          :class="{
            'bg-(--theme-accent)/5 border border-(--theme-accent)/20 shadow-sm':
              block.step.status === 'running' &&
              (normalizeToolName(block.step.toolName) === 'websearchtool' ||
                normalizeToolName(block.step.toolName) === 'webfetchtool')
          }"
          @click="toggleTool(block.id)"
        >
          <span
            v-if="block.kind === 'file'"
            class="min-w-0 inline-flex items-center gap-1.5 truncate"
          >
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
          <span v-else class="min-w-0 inline-flex items-center gap-2 truncate">
            <Search
              v-if="normalizeToolName(block.step.toolName) === 'websearchtool'"
              :size="15"
              class="shrink-0"
              :class="
                block.step.status === 'running'
                  ? 'text-(--theme-accent) animate-pulse'
                  : 'text-(--theme-text-dim)'
              "
            />
            <Globe
              v-else-if="normalizeToolName(block.step.toolName) === 'webfetchtool'"
              :size="15"
              class="shrink-0"
              :class="
                block.step.status === 'running'
                  ? 'text-(--theme-accent) animate-pulse'
                  : 'text-(--theme-text-dim)'
              "
            />
            <Wrench v-else :size="15" class="shrink-0 text-(--theme-text-dim)" />
            <span
              class="truncate text-[12px] font-medium leading-relaxed"
              :class="
                block.step.status === 'running' &&
                (normalizeToolName(block.step.toolName) === 'websearchtool' ||
                  normalizeToolName(block.step.toolName) === 'webfetchtool')
                  ? 'thinking-shimmer-text font-semibold'
                  : 'text-(--theme-text-main)'
              "
              >{{ getToolHeaderLabel(block.step) }}</span
            >
          </span>

          <template v-if="block.kind === 'file'">
            <span
              v-if="block.step.status === 'running'"
              class="tool-running-cursor"
              :title="getToolStatusLabel(block.step)"
              :aria-label="getToolStatusLabel(block.step)"
            />
            <CircleX
              v-else-if="block.step.status === 'error'"
              :size="14"
              class="shrink-0 text-rose-500"
            />
          </template>
          <span
            v-else-if="shouldShowToolStatusIcon(block.step)"
            :title="getToolStatusLabel(block.step)"
            :aria-label="getToolStatusLabel(block.step)"
            class="shrink-0 inline-flex items-center justify-center text-(--theme-text-main)"
          >
            <CircleCheckBig
              v-if="block.step.status === 'done'"
              :size="14"
              class="text-emerald-600"
            />
            <span
              v-else-if="block.step.status === 'running'"
              class="tool-running-cursor"
              aria-hidden="true"
            />
            <CircleX v-else :size="14" class="text-rose-500" />
          </span>

          <span
            v-if="shouldShowToolDuration(block.step)"
            class="shrink-0 inline-flex items-center gap-1 tabular-nums text-[11px] text-(--theme-text-dim)"
          >
            <Clock3 :size="14" />
            {{ formatThinkingDuration(block.step.durationMs ?? 0) }}
          </span>

          <ChevronDown
            v-if="isToolExpanded(block.id)"
            :size="14"
            class="shrink-0 text-(--theme-text-dim)"
          />
          <ChevronRight v-else :size="14" class="shrink-0 text-(--theme-text-dim)" />
        </button>

        <Transition name="flow-expand">
          <div v-if="isToolExpanded(block.id)" class="flow-expand-shell">
            <div class="flow-expand-inner">
              <div
                class="mt-2 w-fit max-w-full md:max-w-[70%] min-w-100 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-content)/70 px-3 py-2"
              >
                <template v-if="block.kind === 'file'">
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
                </template>
                <template v-else>
                  <div v-if="extractCommand(block.step)">
                    <div class="text-[11px] font-semibold tracking-wide text-(--theme-text-dim)">
                      COMMAND
                    </div>
                    <pre
                      class="mt-1 max-h-24 overflow-auto rounded-md border border-dashed border-(--theme-border-base) bg-(--theme-bg-main) p-2 text-[11px] text-(--theme-text-main)"
                    ><code>{{ extractCommand(block.step) }}</code></pre>
                  </div>

                  <div v-if="extractOutput(block.step)" class="mt-2">
                    <div class="text-[11px] font-semibold tracking-wide text-(--theme-text-dim)">
                      OUTPUT
                    </div>
                    <pre
                      class="mt-1 max-h-40 overflow-auto rounded-md border border-dashed border-(--theme-border-base) bg-(--theme-bg-main) p-2 text-[11px] text-(--theme-text-main) whitespace-pre-wrap wrap-break-word"
                    ><code>{{ extractOutput(block.step) }}</code></pre>
                  </div>

                  <div
                    v-if="!extractCommand(block.step) && !extractOutput(block.step)"
                    class="text-[11px] text-(--theme-text-dim)"
                  >
                    暂无详情
                  </div>
                </template>
              </div>
            </div>
          </div>
        </Transition>
      </template>
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
