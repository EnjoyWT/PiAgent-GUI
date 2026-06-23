<script setup lang="ts">
import { computed, ref, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { Box, X } from 'lucide-vue-next'
import ChatInputBox from '../chat/ChatInputBox.vue'
import ChatMessageItem from '../chat/ChatMessageItem.vue'
import PendingQueuePanel from '../chat/PendingQueuePanel.vue'
import ActiveInteractionPanel from '../chat/ActiveInteractionPanel.vue'
import TodoPanel from '../chat/TodoPanel.vue'
import SubagentPanel from '../chat/SubagentPanel.vue'
import WidgetContainer from '../chat/WidgetContainer.vue'
import Onboarding from './Onboarding.vue'
import type { ChatMessage, ChatWidget, PendingQueueItem, QueueRuntimeState } from '../chat/types'
import { getMessageRenderKey } from '../../utils/message-keys'
import { shouldShowThreadPlanPanel } from '../../utils/thread-plan'
import type { QuestionToolParams } from '@shared/question-tool'
import type { PendingQuestionnaire } from '@shared/questionnaire-tool'
import type { SecretPromptParams } from '@shared/secret-input'
import type { TransportSetupQrProjection } from '@shared/agent-runtime'
import type { ThreadPlanState } from '@shared/thread-plan'
import type { SubagentPanelState } from '@shared/subagent-panel'
import {
  createBottomScrollAnimation,
  getBottomScrollFrame,
  type BottomScrollAnimation
} from './bottom-scroll'

// 1. 先定义 Props 和 Emits
const props = defineProps<{
  messages: ChatMessage[]
  hasActiveThread: boolean
  hasAnyWorkspace: boolean
  isStreaming: boolean
  canAbort: boolean
  inputText: string
  inputHistoryEntries?: string[]
  attachments: File[]
  pendingQueue: PendingQueueItem[]
  queueRuntimeState: QueueRuntimeState
  queueDispatchPolicy: 'auto' | 'paused'
  hasMoreHistory?: boolean
  historyLoading?: boolean
  threadId?: string | null
  workspacePath?: string
  editMode?: boolean
  editHint?: string
  modelLabel: string
  modelOptions: {
    id: string
    label: string
    providerName?: string
    contextWindow?: string
    supports?: { imageInput?: boolean; tools?: boolean; reasoning?: boolean }
  }[]
  selectedModelId: string
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  thinkingLevels: ('off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh')[]
  thinkingSupported: boolean
  supportsImageInput?: boolean
  contextUsedTokens: number
  contextTotalTokens: number
  isRuntimeDebugOpen?: boolean
  runtimeDebugThreadId?: string | null
  runtimeDebugEvents?: ConversationEventRow[]
  runtimeDebugLoading?: boolean
  runtimeDebugRunOptions?: { id: string; label: string; status: string }[]
  runtimeDebugSelectedRunId?: string | null
  activePlanState?: ThreadPlanState | null
  hiddenPlanRevision?: number | null
  activeSubagentPanelState?: SubagentPanelState | null
  hiddenSubagentPanelRevision?: number | null
  activeQuestion?: QuestionToolParams | null
  activeQuestionnaire?: PendingQuestionnaire | null
  activeSecret?: SecretPromptParams | null
}>()

const emit = defineEmits<{
  (e: 'update:inputText', value: string): void
  (e: 'update:attachments', files: File[]): void
  (e: 'select-model', modelId: string): void
  (e: 'select-thinking-level', level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'): void
  (e: 'send'): void
  (e: 'cancel'): void
  (e: 'drop-images', files: File[]): void
  (e: 'message-regenerate', payload: { id?: string; index: number; content: string }): void
  (e: 'message-start-edit', payload: { id?: string; index: number; content: string }): void
  (e: 'message-delete', payload: { id?: string; index: number }): void
  (e: 'message-widget-action', payload: { action: string; text: string }): void
  (e: 'message-transport-setup-regenerate', payload: TransportSetupQrProjection): void
  (e: 'message-widget-visible', payload: { id?: string; index: number }): void
  (e: 'queue-dispatch-item', itemId: string): void
  (e: 'queue-dispatch-all'): void
  (e: 'queue-delete-item', itemId: string): void
  (e: 'load-older'): void
  (e: 'widget-send', text: string): void
  (e: 'question-answer-option', optionId: string): void
  (e: 'questionnaire-answer-option', optionId: string): void
  (e: 'secret-submit', value: string): void
  (e: 'cancel-edit'): void
  (e: 'close-runtime-debug'): void
  (e: 'runtime-debug-refresh'): void
  (e: 'runtime-debug-select-run', runId: string | null): void
  (e: 'hide-thread-plan'): void
  (e: 'hide-subagent-panel'): void
  (e: 'create-thread'): void
}>()

// 2. 再定义状态和逻辑
type WidgetState = ChatWidget

const activeMainWidget = ref<WidgetState | null>(null)

// 暴露给外部调用的方法，用于设置 Widget
const setWidget = (_placement: 'inline' | 'main', data: WidgetState | null) => {
  activeMainWidget.value = data
}

const clearWidgets = () => {
  activeMainWidget.value = null
}

const clearQuestion = () => {}
const clearQuestionnaire = () => {}
const clearSecret = () => {}

const activeQuestionnaireQuestion = computed(() => {
  const pending = props.activeQuestionnaire
  if (!pending) return null
  return pending.questionnaire.questions[pending.currentStepIndex] ?? null
})

const showThreadPlanPanel = computed(() =>
  shouldShowThreadPlanPanel(
    props.activePlanState ?? null,
    props.isStreaming,
    props.hiddenPlanRevision ?? null
  )
)

const showSubagentPanel = computed(() => {
  const state = props.activeSubagentPanelState ?? null
  if (!state) return false
  return state.revision !== props.hiddenSubagentPanelRevision
})

const composerCanAbort = computed(
  () => props.canAbort && !props.activeQuestion && !props.activeQuestionnaire
)

const composerPlaceholder = computed(() => {
  if (props.activeSecret) return props.activeSecret.placeholder
  if (props.activeQuestionnaire) {
    return activeQuestionnaireQuestion.value?.placeholder || '输入本步骤答案...'
  }
  return props.activeQuestion?.placeholder
})

watch(
  () => props.runtimeDebugThreadId,
  (nextId, prevId) => {
    if (nextId !== prevId) {
      // Logic for changing debug thread...
    }
  }
)

const onWidgetAction = (payload: { action: string; text: string }) => {
  if (payload.action === 'SEND_MESSAGE') {
    emit('widget-send', payload.text)
  }
}

const shouldRenderMessageWidget = (_index: number, widget?: WidgetState | null): boolean =>
  Boolean(widget)

const messageRenderKey = (message: ChatMessage, index: number): string =>
  getMessageRenderKey(message, index)

const handleMessageWidgetLayoutChange = (): void => {
  void scrollToBottom({ behavior: props.isStreaming ? 'auto' : 'smooth' })
}

const scrollContainer = ref<HTMLElement | null>(null)
const chatInputRef = ref<InstanceType<typeof ChatInputBox> | null>(null)
const isPinnedToBottom = ref(true)

const BOTTOM_LOCK_THRESHOLD_PX = 72
const TOP_LOAD_THRESHOLD_PX = 16

const updatePinnedState = (): void => {
  const el = scrollContainer.value
  if (!el) return
  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  isPinnedToBottom.value = distanceToBottom <= BOTTOM_LOCK_THRESHOLD_PX
}

const maybeRequestOlderHistory = (): void => {
  const el = scrollContainer.value
  if (!el) return
  if (!props.hasMoreHistory || props.historyLoading) return
  if (el.scrollTop <= TOP_LOAD_THRESHOLD_PX) emit('load-older')
}

const handleScroll = (): void => {
  if (bottomScrollAnimation) return
  updatePinnedState()
  maybeRequestOlderHistory()
}

let scrollRafId: number | null = null
let bottomScrollAnimationRafId: number | null = null
let bottomScrollAnimation: BottomScrollAnimation | null = null
type ScrollMode = 'auto' | 'smooth'

const cancelBottomScrollAnimation = (): void => {
  if (bottomScrollAnimationRafId !== null) {
    cancelAnimationFrame(bottomScrollAnimationRafId)
    bottomScrollAnimationRafId = null
  }
  bottomScrollAnimation = null
}

const animateBottomScroll = (el: HTMLElement): void => {
  if (bottomScrollAnimationRafId !== null) return
  bottomScrollAnimationRafId = requestAnimationFrame((timestamp) => {
    bottomScrollAnimationRafId = null
    if (!bottomScrollAnimation) return

    const frame = getBottomScrollFrame(bottomScrollAnimation, timestamp)
    el.scrollTop = frame.top

    if (frame.done) {
      el.scrollTop = bottomScrollAnimation.targetTop
      bottomScrollAnimation = null
      isPinnedToBottom.value = true
      return
    }

    animateBottomScroll(el)
  })
}

const startBottomScrollAnimation = (
  el: HTMLElement,
  targetTop: number,
  startedAt: number
): void => {
  if (Math.abs(targetTop - el.scrollTop) < 1) {
    cancelBottomScrollAnimation()
    el.scrollTop = targetTop
    isPinnedToBottom.value = true
    return
  }

  bottomScrollAnimation = createBottomScrollAnimation({
    startTop: el.scrollTop,
    targetTop,
    startedAt
  })
  animateBottomScroll(el)
}

const handleManualScrollIntent = (): void => {
  cancelBottomScrollAnimation()
}

const scrollToBottom = async (options?: { force?: boolean; behavior?: ScrollMode }) => {
  if (scrollRafId !== null) return

  scrollRafId = requestAnimationFrame(async (timestamp) => {
    await nextTick()
    const el = scrollContainer.value
    if (!el) {
      scrollRafId = null
      return
    }
    if (!options?.force && !isPinnedToBottom.value && !bottomScrollAnimation) {
      scrollRafId = null
      return
    }
    const targetTop = Math.max(0, el.scrollHeight - el.clientHeight)
    const delta = targetTop - el.scrollTop
    const smooth =
      options?.behavior === 'smooth' ||
      (options?.behavior !== 'auto' && !options?.force && delta < 2400)
    if (smooth) {
      startBottomScrollAnimation(el, targetTop, timestamp)
    } else {
      cancelBottomScrollAnimation()
      el.scrollTop = targetTop
      isPinnedToBottom.value = true
    }
    scrollRafId = null
  })
}

const focusComposerToEnd = async () => {
  await nextTick()
  await chatInputRef.value?.focusToEnd()
}

const captureHistoryAnchor = () => {
  const el = scrollContainer.value
  if (!el) return null
  return {
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight
  }
}

const restoreHistoryAnchor = async (
  snapshot: { scrollTop: number; scrollHeight: number } | null
) => {
  if (!snapshot) return
  await nextTick()
  const el = scrollContainer.value
  if (!el) return
  const heightDelta = el.scrollHeight - snapshot.scrollHeight
  el.scrollTop = snapshot.scrollTop + heightDelta
}

const scrollToMessage = async (messageId: string): Promise<boolean> => {
  await nextTick()
  const normalizedId = String(messageId ?? '').trim()
  if (!normalizedId) return false
  const root = scrollContainer.value
  const selector = `[data-message-id="${CSS.escape(normalizedId)}"]`
  const target = root?.querySelector<HTMLElement>(selector)
  if (!target) return false
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  target.classList.add('search-hit-flash')
  window.setTimeout(() => target.classList.remove('search-hit-flash'), 2200)
  return true
}

onMounted(() => {
  updatePinnedState()
  scrollContainer.value?.addEventListener('scroll', handleScroll, { passive: true })
  scrollContainer.value?.addEventListener('wheel', handleManualScrollIntent, { passive: true })
  scrollContainer.value?.addEventListener('touchstart', handleManualScrollIntent, { passive: true })
})

onUnmounted(() => {
  if (scrollRafId !== null) cancelAnimationFrame(scrollRafId)
  cancelBottomScrollAnimation()
  scrollContainer.value?.removeEventListener('scroll', handleScroll)
  scrollContainer.value?.removeEventListener('wheel', handleManualScrollIntent)
  scrollContainer.value?.removeEventListener('touchstart', handleManualScrollIntent)
})

// 监听消息数量变化（新消息进入）
watch(
  () => props.messages.length,
  () => {
    updatePinnedState()
    scrollToBottom({ force: true })
  }
)

// 监听流式输出状态
watch(
  () => props.isStreaming,
  (streaming) => {
    if (streaming) {
      scrollToBottom({ behavior: 'smooth' })
    }
  }
)

// 监听最后一条消息的内容变化（仅在流式输出时）
watch(
  () => props.messages[props.messages.length - 1]?.content,
  () => {
    if (props.isStreaming) {
      scrollToBottom({ behavior: 'auto' })
    }
  }
)

// 监听最后一条消息的思考块变化（仅在流式输出时）
watch(
  () => props.messages[props.messages.length - 1]?.blocks?.length,
  () => {
    if (props.isStreaming) {
      scrollToBottom({ behavior: 'auto' })
    }
  }
)

defineExpose({
  scrollToBottom,
  scrollToMessage,
  focusComposerToEnd,
  captureHistoryAnchor,
  restoreHistoryAnchor,
  setWidget,
  clearWidgets,
  clearQuestion,
  clearQuestionnaire,
  clearSecret
})
</script>

<template>
  <!-- Main Content -->
  <main class="flex-1 min-h-0 flex bg-(--theme-bg-main) overflow-hidden">
    <div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <!-- Main Viewport Layer -->
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="translate-x-full"
        enter-to-class="translate-x-0"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="translate-x-0"
        leave-to-class="translate-x-full"
      >
        <div
          v-if="activeMainWidget"
          class="absolute inset-0 z-50 bg-(--theme-bg-main) flex flex-col shadow-2xl"
        >
          <div
            class="flex items-center justify-between px-6 py-4 border-b border-(--theme-border-base) shrink-0"
          >
            <div class="flex items-center gap-2">
              <Box :size="20" class="text-(--theme-accent)" />
              <h2 class="text-lg font-semibold text-(--theme-text-main)">
                {{ activeMainWidget.title || '主工作区' }}
              </h2>
            </div>
            <button
              class="p-2 rounded-full hover:bg-(--theme-bg-hover-btn) text-(--theme-text-dim) transition-colors cursor-pointer"
              @click="activeMainWidget = null"
            >
              <X :size="20" />
            </button>
          </div>
          <div class="flex-1 min-h-0">
            <WidgetContainer
              placement="main"
              :kind="activeMainWidget.kind"
              :html="activeMainWidget.html"
              :url="activeMainWidget.url"
              :widget-id="activeMainWidget.widgetId"
              :title="activeMainWidget.title"
              :config="activeMainWidget.config"
              @action="onWidgetAction"
              @close="activeMainWidget = null"
            />
          </div>
        </div>
      </Transition>

      <!-- Chat Flow -->
      <div
        ref="scrollContainer"
        data-testid="message-list"
        class="chat-flow-container relative flex-1 min-h-0 overflow-y-auto pl-4 pr-4.5 py-5 flex flex-col gap-1"
      >
        <template v-if="hasActiveThread">
          <div class="shrink-0 flex items-center justify-center pb-3">
            <button
              v-if="hasMoreHistory && !historyLoading"
              type="button"
              data-testid="load-older-history"
              class="text-xs text-(--theme-text-dim) hover:text-(--theme-text-main) transition-colors cursor-pointer"
              @click="emit('load-older')"
            >
              加载更早消息
            </button>
            <div
              v-else-if="historyLoading"
              data-testid="history-loading"
              class="text-xs text-(--theme-text-dim)"
            >
              加载历史中...
            </div>
          </div>
          <ChatMessageItem
            v-for="(msg, index) in messages"
            :id="msg.id"
            :key="messageRenderKey(msg, index)"
            :index="index"
            :role="msg.role"
            :message-kind="msg.messageKind"
            :include-in-agent-context="msg.includeInAgentContext"
            :content="msg.content"
            :blocks="msg.blocks"
            :is-pending="msg.isPending"
            :agent-turn-id="msg.agentTurnId"
            :run="msg.run"
            :widget="msg.widget"
            :workspace-path="workspacePath"
            :show-widget="shouldRenderMessageWidget(index, msg.widget)"
            @regenerate="emit('message-regenerate', $event)"
            @start-edit="emit('message-start-edit', $event)"
            @delete="emit('message-delete', $event)"
            @widget-action="emit('message-widget-action', $event)"
            @transport-setup-regenerate="emit('message-transport-setup-regenerate', $event)"
            @widget-visible="emit('message-widget-visible', $event)"
            @widget-layout-change="handleMessageWidgetLayoutChange"
          />
        </template>
        <div v-else class="flex-1 min-h-0">
          <Onboarding mini @action="emit('create-thread')" />
        </div>
      </div>

      <div v-if="hasActiveThread" class="shrink-0 relative z-10 flex flex-col">
        <div class="px-6">
          <Transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 -translate-y-2"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="opacity-100 translate-y-0"
            leave-to-class="opacity-0 -translate-y-2"
          >
            <TodoPanel
              v-if="showThreadPlanPanel && activePlanState"
              :state="activePlanState"
              @close="emit('hide-thread-plan')"
            />
          </Transition>

          <Transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 -translate-y-2"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="opacity-100 translate-y-0"
            leave-to-class="opacity-0 -translate-y-2"
          >
            <SubagentPanel
              v-if="showSubagentPanel && activeSubagentPanelState"
              :state="activeSubagentPanelState"
              @close="emit('hide-subagent-panel')"
            />
          </Transition>

          <Transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 -translate-y-2"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="opacity-100 translate-y-0"
            leave-to-class="opacity-0 -translate-y-2"
          >
            <ActiveInteractionPanel
              v-if="activeQuestion || activeQuestionnaire || activeSecret"
              :question="activeQuestion ?? null"
              :questionnaire="activeQuestionnaire ?? null"
              :secret="activeSecret ?? null"
              @question-answer-option="emit('question-answer-option', $event)"
              @questionnaire-answer-option="emit('questionnaire-answer-option', $event)"
              @secret-submit="emit('secret-submit', $event)"
            />
          </Transition>

          <PendingQueuePanel
            :items="pendingQueue"
            :runtime-state="queueRuntimeState"
            :dispatch-policy="queueDispatchPolicy"
            @dispatch-item="emit('queue-dispatch-item', $event)"
            @dispatch-all="emit('queue-dispatch-all')"
            @delete-item="emit('queue-delete-item', $event)"
          />
        </div>

        <div class="px-6">
          <ChatInputBox
            ref="chatInputRef"
            :model-value="inputText"
            :history-entries="inputHistoryEntries"
            :attachments="attachments"
            :thread-id="threadId"
            :workspace-path="workspacePath"
            :is-streaming="isStreaming"
            :can-abort="composerCanAbort"
            :queue-runtime-state="queueRuntimeState"
            :edit-mode="editMode"
            :edit-hint="editHint"
            :model-label="modelLabel"
            :model-options="modelOptions"
            :selected-model-id="selectedModelId"
            :thinking-level="thinkingLevel"
            :thinking-levels="thinkingLevels"
            :thinking-supported="thinkingSupported"
            :supports-image-input="supportsImageInput"
            :placeholder="composerPlaceholder"
            :context-used-tokens="contextUsedTokens"
            :context-total-tokens="contextTotalTokens"
            @update:model-value="emit('update:inputText', $event)"
            @update:attachments="emit('update:attachments', $event)"
            @select-model="emit('select-model', $event)"
            @select-thinking-level="emit('select-thinking-level', $event)"
            @send="emit('send')"
            @cancel="emit('cancel')"
            @drop-images="emit('drop-images', $event)"
            @cancel-edit="emit('cancel-edit')"
          />
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.chat-flow-container {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.25) transparent;
}

.chat-flow-container::-webkit-scrollbar {
  width: 5px;
}

.chat-flow-container::-webkit-scrollbar-track {
  background: transparent;
}

.chat-flow-container::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.2);
  border-radius: 9999px;
}

.chat-flow-container:hover::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.35);
}

:deep(.search-hit-flash > div > div) {
  animation: search-hit-glow 2.2s ease-out;
}

@keyframes search-hit-glow {
  0% {
    box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4), 0 0 30px rgba(99, 102, 241, 0.22);
    background-color: rgba(99, 102, 241, 0.1);
  }
  100% {
    box-shadow: none;
  }
}
</style>
