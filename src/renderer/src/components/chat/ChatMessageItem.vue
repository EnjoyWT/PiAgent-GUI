<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Copy,
  RotateCcw,
  Pencil,
  MoreHorizontal,
  Trash2,
  Check,
  Brain,
  Clock
} from 'lucide-vue-next'
import Tooltip from '../common/Tooltip.vue'
import MarkdownContent from './MarkdownContent.vue'
import FlowRenderer from './FlowRenderer.vue'
import GitDiffView from './GitDiffView.vue'
import WidgetContainer from './WidgetContainer.vue'
import ChatImageGallery from './ChatImageGallery.vue'
import type { AgentRun, AgentTurn, ChatWidget, ChatContentBlock, ChatImageBlock } from './types'
import { buildMessageRenderFlow } from './flow-blocks'
import type { TransportSetupQrProjection } from '@shared/agent-runtime'

const props = defineProps<{
  id?: string
  index?: number
  role: 'user' | 'assistant'
  messageKind?:
    | 'chat'
    | 'automation'
    | 'question_answer'
    | 'questionnaire_question'
    | 'questionnaire_answer'
    | 'context_compaction'
  includeInAgentContext?: boolean
  content: string
  blocks?: ChatContentBlock[]
  isPending?: boolean
  agentTurnId?: string
  run?: AgentRun
  widget?: ChatWidget
  workspacePath?: string
  showWidget?: boolean
}>()

const emit = defineEmits<{
  (e: 'regenerate', payload: { id?: string; index: number; content: string }): void
  (e: 'start-edit', payload: { id?: string; index: number; content: string }): void
  (e: 'delete', payload: { id?: string; index: number }): void
  (e: 'widget-action', payload: { action: string; text: string }): void
  (e: 'transport-setup-regenerate', payload: TransportSetupQrProjection): void
  (e: 'widget-visible', payload: { id?: string; index: number }): void
  (e: 'widget-layout-change'): void
}>()

const isUser = computed(() => props.role === 'user')
const isAutomation = computed(() => props.messageKind === 'automation')
const isContextCompaction = computed(() => props.messageKind === 'context_compaction')
const canReplayUserMessage = computed(() => props.includeInAgentContext !== false)
const isLegacyAssistantStreaming = computed(
  () => props.role === 'assistant' && !props.run && Boolean(props.isPending)
)
const messageIndex = computed(() => props.index ?? -1)
const messageRootRef = ref<HTMLElement | null>(null)

const isMoreOpen = ref(false)
const morePopoverStyle = ref<Record<string, string>>({})
const copied = ref(false)
let copiedTimer: number | null = null
let widgetVisibilityObserver: IntersectionObserver | null = null

const imageBlocks = computed(() =>
  (props.blocks ?? []).filter((block): block is ChatImageBlock => block.type === 'image')
)
const textContent = computed(() => {
  const textBlocks = (props.blocks ?? []).filter(
    (block): block is Extract<ChatContentBlock, { type: 'text' }> => block.type === 'text'
  )
  return textBlocks.length > 0 ? textBlocks.map((block) => block.text).join('') : props.content
})
const useAssistantRunFlow = computed(
  () =>
    props.role === 'assistant' &&
    Boolean(props.run) &&
    (Boolean(props.agentTurnId) || (props.run?.turns.length ?? 0) <= 1)
)
const isAssistantRunFlowOwner = computed(() => {
  if (!useAssistantRunFlow.value || !props.run) return false
  if (!props.agentTurnId) return props.run.turns.length <= 1
  return props.run.turns.at(-1)?.id === props.agentTurnId
})
const useAssistantPendingShell = computed(
  () => props.role === 'assistant' && Boolean(props.isPending) && !props.run
)
const useFullWidthAssistantShell = computed(
  () => useAssistantRunFlow.value || useAssistantPendingShell.value
)
const assistantTurns = computed<AgentTurn[]>(() => {
  if (!useAssistantRunFlow.value || !props.run) return []
  // 一个 run 只允许最后一个 turn 的消息承载完整聚合 flow；最终正文出现后，
  // FlowRenderer 再统一折叠此前所有 turn 的中间过程。
  if (props.run.turns.length > 1 && !isAssistantRunFlowOwner.value) return []
  if (isAssistantRunFlowOwner.value) return props.run.turns
  if (props.agentTurnId) {
    const turn = props.run.turns.find((turn) => turn.id === props.agentTurnId)
    return turn ? [turn] : []
  }
  return props.run.turns
})
const assistantFlow = computed(() =>
  useAssistantRunFlow.value && props.run && assistantTurns.value.length > 0
    ? buildMessageRenderFlow({
        run: props.run,
        turns: assistantTurns.value,
        messageWidget: props.widget,
        includeMessageWidget: props.showWidget !== false,
        includeRunFinalText: isAssistantRunFlowOwner.value || props.run.turns.length <= 1
      })
    : null
)
const showAssistantThinkingPlaceholder = computed(() =>
  Boolean(assistantFlow.value?.meta.showThinkingPlaceholder)
)
const showAssistantThinkingPlaceholderBeforeFlow = computed(
  () => showAssistantThinkingPlaceholder.value && (assistantFlow.value?.blocks.length ?? 0) === 0
)
const showAssistantThinkingPlaceholderAfterFlow = computed(
  () => showAssistantThinkingPlaceholder.value && (assistantFlow.value?.blocks.length ?? 0) > 0
)
// 防止 run-flow 模式下没有任何可见内容时渲染空白气泡
const assistantRunFlowIsEmpty = computed(
  () =>
    useAssistantRunFlow.value &&
    !showAssistantThinkingPlaceholder.value &&
    (assistantFlow.value?.blocks.length ?? 0) === 0 &&
    imageBlocks.value.length === 0
)
const hasInlineRenderedWidget = computed(() =>
  Boolean(
    assistantFlow.value?.blocks.some(
      (block) => block.kind === 'widget' && block.widget.placement === 'inline'
    ) ||
    (props.widget && props.widget.placement === 'inline')
  )
)

const automationInfo = computed(() => {
  if (!isAutomation.value) return null
  const text = textContent.value

  const taskNameMatch = text.match(/Task Name: (.*?)(?:\n|$)/)
  const taskIdMatch = text.match(/Task ID: (.*?)(?:\n|$)/)
  const scheduledForMatch = text.match(/Scheduled For: (.*?)(?:\n|$)/)
  const executionModeMatch = text.match(/Execution Mode: (.*?)(?:\n|$)/)

  const headerEndIndex = text.indexOf('\n\n')
  const userPrompt = headerEndIndex !== -1 ? text.slice(headerEndIndex + 2).trim() : ''

  let formattedTime = ''
  if (scheduledForMatch && scheduledForMatch[1]) {
    try {
      const date = new Date(scheduledForMatch[1])
      formattedTime = date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })
    } catch {
      formattedTime = scheduledForMatch[1]
    }
  }

  return {
    taskName: taskNameMatch ? taskNameMatch[1] : '定时任务',
    taskId: taskIdMatch ? taskIdMatch[1] : null,
    scheduledFor: formattedTime,
    executionMode: executionModeMatch ? executionModeMatch[1] : null,
    userPrompt: userPrompt || text
  }
})

onBeforeUnmount(() => {
  if (copiedTimer != null) window.clearTimeout(copiedTimer)
  if (widgetVisibilityObserver) {
    widgetVisibilityObserver.disconnect()
    widgetVisibilityObserver = null
  }
})

const shouldObserveInlineWidget = computed(
  () =>
    props.role === 'assistant' &&
    Boolean(
      assistantFlow.value?.blocks.some(
        (block) =>
          block.kind === 'widget' &&
          block.widget.placement === 'inline' &&
          block.widget.kind === 'html' &&
          Boolean(block.widget.html) &&
          !block.widget.url
      ) ||
      (props.widget?.placement === 'inline' &&
        props.widget.kind === 'html' &&
        Boolean(props.widget.html) &&
        !props.widget.url)
    )
)

const setupWidgetVisibilityObserver = (): void => {
  if (widgetVisibilityObserver) {
    widgetVisibilityObserver.disconnect()
    widgetVisibilityObserver = null
  }

  if (!shouldObserveInlineWidget.value) return
  const target = messageRootRef.value
  if (!target) return

  const scrollRoot = target.closest('.chat-flow-container') as Element | null
  widgetVisibilityObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      if (messageIndex.value < 0) return
      emit('widget-visible', { id: props.id, index: messageIndex.value })
      widgetVisibilityObserver?.disconnect()
      widgetVisibilityObserver = null
    },
    {
      root: scrollRoot,
      threshold: 0.05,
      rootMargin: '120px 0px'
    }
  )
  widgetVisibilityObserver.observe(target)
}

onMounted(() => {
  setupWidgetVisibilityObserver()
})

watch(
  [shouldObserveInlineWidget, () => props.widget?.url, () => props.id, messageIndex] as const,
  () => {
    if (props.widget?.url) {
      if (widgetVisibilityObserver) {
        widgetVisibilityObserver.disconnect()
        widgetVisibilityObserver = null
      }
      return
    }
    setupWidgetVisibilityObserver()
  }
)

type DiffParts = { prefix: string; diff: string; suffix: string }

const tryExtractDiffParts = (raw: string): DiffParts | null => {
  const text = raw ?? ''
  if (!text.trim()) return null

  // Prefer fenced diff/patch blocks so we can render explanation + diff together.
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

  // Fallback: whole message is a unified diff.
  const looksLikeUnified =
    /^diff --git /m.test(text) ||
    (/^---\s+/m.test(text) && /^\+\+\+\s+/m.test(text) && /^@@ /m.test(text)) ||
    /^@@ /m.test(text)
  if (!looksLikeUnified) return null
  if (!/^@@ /m.test(text)) return null
  return { prefix: '', diff: text.trim(), suffix: '' }
}

const diffParts = computed(() =>
  props.role === 'assistant' ? tryExtractDiffParts(textContent.value) : null
)
const copyPayload = computed(() => {
  const raw = diffParts.value?.diff ?? textContent.value ?? ''
  if (isUser.value) return raw.replace(/\r?\n+$/g, '')
  return raw
})

const onCopy = async (): Promise<void> => {
  try {
    await navigator.clipboard.writeText(copyPayload.value)
    copied.value = true
    if (copiedTimer != null) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
      copied.value = false
      copiedTimer = null
    }, 1200)
  } catch (err) {
    console.error('Copy failed', err)
  }
}

const onUserCopy = (evt: ClipboardEvent): void => {
  if (!isUser.value) return
  const selection = window.getSelection()
  if (!selection) return
  const raw = selection.toString()
  if (!raw) return
  const trimmed = raw.replace(/\r\n/g, '\n').replace(/\n+$/g, '')
  if (trimmed === raw) return
  evt.preventDefault()
  evt.clipboardData?.setData('text/plain', trimmed)
}

const onRegenerate = (): void => {
  if (messageIndex.value < 0) return
  emit('regenerate', { id: props.id, index: messageIndex.value, content: props.content })
}

const startEdit = (): void => {
  if (messageIndex.value < 0) return
  emit('start-edit', { id: props.id, index: messageIndex.value, content: props.content })
}

const openMore = (e: MouseEvent): void => {
  const el = e.currentTarget as HTMLElement | null
  if (el) {
    const rect = el.getBoundingClientRect()
    const width = 240
    const margin = 12
    const desiredLeft = rect.left + rect.width / 2
    const clampedLeft = Math.min(
      Math.max(desiredLeft, margin + width / 2),
      window.innerWidth - margin - width / 2
    )
    morePopoverStyle.value = {
      left: `${clampedLeft}px`,
      top: `${rect.bottom + 8}px`,
      transform: 'translate(-50%, 0)'
    }
  } else {
    morePopoverStyle.value = {}
  }
  isMoreOpen.value = true
}

const closeMore = (): void => {
  isMoreOpen.value = false
}

const onDelete = (): void => {
  if (messageIndex.value < 0) return
  emit('delete', { id: props.id, index: messageIndex.value })
  closeMore()
}

const onWidgetAction = (payload: { action: string; text: string }): void => {
  emit('widget-action', payload)
}

const onTransportSetupRegenerate = (payload: TransportSetupQrProjection): void => {
  emit('transport-setup-regenerate', payload)
}

watch(isMoreOpen, (open, _prev, onCleanup) => {
  if (!open) return
  const onKeyDown = (evt: KeyboardEvent): void => {
    if (evt.key === 'Escape') closeMore()
  }
  const onScrollOrResize = (): void => closeMore()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', onScrollOrResize)
  // Capture scroll from nested containers too (e.g., chat list).
  window.addEventListener('scroll', onScrollOrResize, true)
  onCleanup(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('resize', onScrollOrResize)
    window.removeEventListener('scroll', onScrollOrResize, true)
  })
})
</script>

<template>
  <div
    v-if="
      (!useAssistantRunFlow ||
        isAssistantRunFlowOwner ||
        (props.run?.turns.length ?? 0) <= 1) &&
      !assistantRunFlowIsEmpty
    "
    ref="messageRootRef"
    data-testid="message-item"
    :data-message-id="id"
    :data-message-role="role"
    class="w-full"
    :class="
      isContextCompaction
        ? 'flex justify-center'
        : role === 'user' && !isAutomation
          ? 'flex justify-end'
          : ''
    "
  >
    <div
      class="group w-full min-w-0 flex flex-col"
      :class="[
        isContextCompaction
          ? 'items-center my-1.5 w-[65%]'
          : isAutomation
            ? 'items-start my-1.5'
            : role === 'user'
              ? 'items-end'
              : 'items-start'
      ]"
    >
      <div
        :class="[
          isContextCompaction
            ? 'w-full max-w-none border-transparent bg-transparent px-0 py-0 shadow-none'
            : 'rounded-xl border',
          isContextCompaction
            ? ''
            : isAutomation
              ? 'w-fit max-w-[85%] border-(--theme-border-base) bg-(--theme-bg-content)/40 px-4 py-3 shadow-sm ml-1'
              : role === 'assistant'
                ? useFullWidthAssistantShell
                  ? 'w-full self-stretch max-w-none bg-transparent border-transparent px-0 py-0'
                  : 'bg-transparent border-transparent py-1'
                : 'w-fit self-end bg-(--theme-bg-user-content) border-(--theme-border-user-content) px-2.25 py-1 max-w-[78%]',
          hasInlineRenderedWidget
            ? 'w-full px-0 self-stretch'
            : isContextCompaction || isAutomation
              ? ''
              : role === 'assistant'
                ? useFullWidthAssistantShell
                  ? ''
                  : 'px-2 max-w-[90%]'
                : ''
        ]"
      >
        <div
          v-if="isContextCompaction"
          class="context-compaction-marker w-full select-none py-1.5"
        >
          <span class="context-compaction-line" aria-hidden="true" />
          <span class="context-compaction-label">{{ textContent }}</span>
          <span class="context-compaction-line" aria-hidden="true" />
        </div>
        <div
          v-else-if="isPending && !(role === 'assistant' && run)"
          :class="
            role === 'assistant'
              ? 'hover-expand-x inline-flex min-w-20 max-w-full items-center gap-2 rounded-lg py-1 text-(--theme-text-dim)'
              : 'prose prose-sm max-w-none text-sm text-(--theme-text-dim) animate-pulse leading-relaxed'
          "
        >
          <template v-if="role === 'assistant'">
            <Brain :size="15" class="shrink-0 text-(--theme-text-dim)" />
            <span
              class="thinking-tail-text text-[13px] font-medium text-(--theme-text-dim) leading-relaxed"
              :data-text="content || '思考中...'"
              >{{ content || '思考中...' }}</span
            >
          </template>
          <template v-else>
            {{ content }}
          </template>
        </div>

        <template v-else-if="isAutomation">
          <div v-if="automationInfo" class="flex flex-col gap-1.5 text-left">
            <!-- Simple Header -->
            <div class="flex items-center gap-2 opacity-80 mb-1">
              <Clock :size="12" class="text-blue-500" />
              <span class="text-[11px] font-semibold text-(--theme-text-main)">
                {{ automationInfo.taskName }}
              </span>
              <span
                v-if="automationInfo.taskId"
                class="text-[9px] font-mono font-bold tracking-tighter text-white bg-blue-400/80 px-1 rounded-sm uppercase"
              >
                ID:{{ automationInfo.taskId.slice(0, 4) }}
              </span>
              <span v-if="automationInfo.scheduledFor" class="text-[10px] text-(--theme-text-dim)">
                · {{ automationInfo.scheduledFor }}
              </span>
            </div>

            <!-- Content -->
            <div
              class="text-[13px] text-(--theme-text-main) whitespace-pre-wrap wrap-break-wordword leading-snug"
            >
              {{ automationInfo.userPrompt }}
            </div>
          </div>
          <div
            v-else-if="textContent?.trim()"
            class="max-w-none text-xs text-(--theme-text-dim) whitespace-pre-wrap wrap-break-wordword leading-relaxed"
            v-text="textContent"
          />
        </template>

        <template v-else-if="role === 'assistant' && run && useAssistantRunFlow">
          <ChatImageGallery
            v-if="imageBlocks.length > 0"
            :images="imageBlocks"
            align="assistant"
            class="mb-3"
          />
          <div class="max-w-full">
            <div v-if="showAssistantThinkingPlaceholderBeforeFlow" class="w-fit">
              <div
                class="hover-expand-x inline-flex min-w-20 max-w-full items-center gap-2 rounded-lg py-1 text-(--theme-text-dim)"
              >
                <Brain :size="15" class="shrink-0 text-(--theme-text-dim)" />
                <span
                  class="thinking-tail-text text-[13px] font-medium text-(--theme-text-dim) leading-relaxed"
                  data-text="思考中..."
                  >思考中...</span
                >
              </div>
            </div>
            <FlowRenderer
              v-if="assistantFlow && assistantFlow.blocks.length > 0"
              :blocks="assistantFlow.blocks"
              :thread-id="props.run?.threadId"
              :workspace-path="props.workspacePath"
              :show-intermediate-summary="isAssistantRunFlowOwner"
              @widget-action="onWidgetAction"
              @transport-setup-regenerate="onTransportSetupRegenerate"
              @widget-layout-change="emit('widget-layout-change')"
            />
            <div v-if="showAssistantThinkingPlaceholderAfterFlow" class="mt-1 w-fit">
              <div
                class="hover-expand-x inline-flex min-w-20 max-w-full items-center gap-2 rounded-lg py-1 text-(--theme-text-dim)"
              >
                <Brain :size="15" class="shrink-0 text-(--theme-text-dim)" />
                <span
                  class="thinking-tail-text text-[13px] font-medium text-(--theme-text-dim) leading-relaxed"
                  data-text="思考中..."
                  >思考中...</span
                >
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="role === 'assistant'">
          <ChatImageGallery
            v-if="imageBlocks.length > 0"
            :images="imageBlocks"
            align="assistant"
            class="mb-3"
          />
          <MarkdownContent
            v-if="isLegacyAssistantStreaming"
            :content="textContent"
            :is-streaming="true"
            class="text-sm text-(--theme-text-main)"
          />
          <MarkdownContent
            v-if="!isLegacyAssistantStreaming && diffParts?.prefix"
            :content="diffParts.prefix"
            class="text-sm text-(--theme-text-main)"
          />
          <div
            v-if="!isLegacyAssistantStreaming && diffParts?.diff"
            class="mt-2 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-content)/70 p-2"
          >
            <GitDiffView :diff="diffParts.diff" />
          </div>
          <MarkdownContent
            v-if="!isLegacyAssistantStreaming && diffParts?.suffix"
            :content="diffParts.suffix"
            class="text-sm text-(--theme-text-main)"
          />
          <MarkdownContent
            v-if="!isLegacyAssistantStreaming && !diffParts && textContent?.trim()"
            :content="textContent"
            class="text-sm text-(--theme-text-main)"
          />
          <WidgetContainer
            v-if="
              showWidget !== false &&
              widget &&
              (!isLegacyAssistantStreaming || widget.placement === 'inline')
            "
            :kind="widget.kind"
            :placement="widget.placement"
            :html="widget.html"
            :url="widget.url"
            :widget-id="widget.widgetId"
            :title="widget.title"
            :config="widget.config"
            @action="onWidgetAction"
            @layout-change="emit('widget-layout-change')"
          />
        </template>

        <template v-else>
          <ChatImageGallery
            v-if="imageBlocks.length > 0"
            :images="imageBlocks"
            align="user"
            class="mb-2"
          />
          <div
            v-if="textContent?.trim()"
            class="prose prose-sm max-w-none text-sm text-(--theme-text-user) whitespace-pre-wrap wrap-break-word leading-relaxed"
            @copy="onUserCopy"
            v-text="textContent"
          />
        </template>
      </div>

      <!-- Hover actions -->
      <div
        v-if="!isPending && !isAutomation"
        class="flex items-center gap-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
        :class="isUser ? 'mt-1' : ''"
      >
        <Tooltip v-if="isUser" :text="copied ? '已复制' : '复制'" :offset="8">
          <button
            type="button"
            class="inline-flex h-6.5 w-6.5 items-center justify-center rounded-lg text-(--theme-text-dim) hover:bg-(--theme-bg-hover-btn) hover:text-(--theme-text-main)"
            aria-label="复制"
            @click="onCopy"
          >
            <Check v-if="copied" :size="13" />
            <Copy v-else :size="13" />
          </button>
        </Tooltip>

        <Tooltip v-if="isUser && canReplayUserMessage" text="重新生成" :offset="8">
          <button
            type="button"
            class="inline-flex h-6.5 w-6.5 items-center justify-center rounded-lg text-(--theme-text-dim) hover:bg-(--theme-bg-hover-btn) hover:text-(--theme-text-main)"
            aria-label="重新生成"
            @click="onRegenerate"
          >
            <RotateCcw :size="13" />
          </button>
        </Tooltip>

        <Tooltip v-if="isUser && canReplayUserMessage" text="编辑" :offset="8">
          <button
            type="button"
            class="inline-flex h-6.5 w-6.5 items-center justify-center rounded-lg text-(--theme-text-dim) hover:bg-(--theme-bg-hover-btn) hover:text-(--theme-text-main)"
            aria-label="编辑"
            @click="startEdit"
          >
            <Pencil :size="13" />
          </button>
        </Tooltip>

        <Tooltip v-if="isUser" text="更多" :offset="8">
          <button
            type="button"
            class="inline-flex h-6.5 w-6.5 items-center justify-center rounded-lg text-(--theme-text-dim) hover:bg-(--theme-bg-hover-btn) hover:text-(--theme-text-main)"
            aria-label="更多"
            @click="openMore"
          >
            <MoreHorizontal :size="13" />
          </button>
        </Tooltip>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="isMoreOpen" class="fixed inset-0 z-50 bg-transparent" @click.self="closeMore">
        <div
          class="fixed w-60 rounded-xl bg-(--theme-bg-main) shadow-lg border border-(--theme-border-base) p-3"
          :style="morePopoverStyle"
        >
          <div class="text-sm font-medium text-(--theme-text-bright)">更多操作</div>
          <div class="mt-2 text-xs text-(--theme-text-dim)">删除后无法恢复。</div>
          <div class="mt-3 flex justify-end gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-md border border-(--theme-border-base) bg-(--theme-bg-main) px-2 py-1 text-xs text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)"
              @click="closeMore"
            >
              取消
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
              @click="onDelete"
            >
              <Trash2 :size="14" />
              删除
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.context-compaction-marker {
  display: flex;
  align-items: center;
  gap: 12px;
}

.context-compaction-line {
  flex: 1 1 0;
  min-width: 24px;
  height: 2px;
  background: var(--theme-border-base);
}

.context-compaction-label {
  flex: 0 0 auto;
  font-size: 14px;
  line-height: 1.4;
  letter-spacing: 0.02em;
  color: var(--theme-text-dim);
  white-space: nowrap;
}

.thinking-tail-text {
  position: relative;
  display: inline-block;
}

.thinking-tail-text::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  background-image: linear-gradient(
    90deg,
    rgba(100, 116, 139, 0) 36%,
    rgba(255, 255, 255, 0.96) 50%,
    rgba(100, 116, 139, 0) 64%
  );
  background-size: 320% 100%;
  animation: thinking-text-sweep 2.8s linear infinite;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  pointer-events: none;
}

@keyframes thinking-text-sweep {
  0% {
    background-position: 150% 50%;
  }
  100% {
    background-position: -150% 50%;
  }
}
</style>
