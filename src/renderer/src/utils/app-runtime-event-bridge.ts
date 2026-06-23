import type { Ref } from 'vue'
import type { AgentAppEvent, AgentThreadProjection } from '@shared/agent-runtime'
import type { ConversationEventRow } from '../../../preload/db-types'
import type {
  AgentRun,
  AgentTurn,
  ChatContentBlock,
  ChatMessage,
  ChatWidget,
  PendingQueueItem
} from '../components/chat/types'
import type { ThreadQueueController } from './app-queue-dispatcher'
import {
  applyMessageDeltaToRun,
  getAssistantDisplayContentForTurn,
  getRunTurnById,
  syncToolProjectionIntoRun
} from './app-runtime'
import { buildWidgetStateFromTool } from './inline-widget'
import { resetQueueControllerAfterAbort } from './app-queue-state'
import {
  pruneStalePendingAssistantMessages,
  removeOptimisticAssistantPlaceholders
} from './pending-assistant-placeholder'
import {
  buildUserBlocks,
  findAgentUserMessage,
  findOptimisticDispatchedUserMessage,
  findReplayAnchorUserMessage,
  isAutomationPromptText,
  reorderChatMessagesInPlace,
  shouldAppendConsumedUserMessage,
  summarizeDebugMessage,
  summarizeDebugMessages
} from './app-chat-helpers'

type RuntimeBinding = {
  chatThreadId: string
} | null

type ThreadScopedAgentAppEvent = AgentAppEvent & {
  __chatThreadId?: string
  queueItemId?: string | null
}

type PersistRuntimeUserMessageOptions = {
  blocks: ChatContentBlock[]
  agentRunId?: string | null
  submissionId?: string | null
  agentTurnId?: string | null
  runtimeSequence?: number | null
  createdAt?: string | number | Date | null
}

type RuntimeEventBridgeOptions = {
  activeThread: Ref<{ id: string } | null>
  messages: Ref<ChatMessage[]>
  runtimeBinding: Ref<RuntimeBinding>
  messageCacheByThreadId: Map<string, ChatMessage[]>
  activeRunByThreadId: Map<string, AgentRun>
  appendRuntimeLiveDebugEvent: (
    threadId: string,
    event: ConversationEventRow & { __chatThreadId?: string }
  ) => void
  createRuntimeLiveEventFromAppEvent: (
    threadId: string,
    event: AgentAppEvent
  ) => ConversationEventRow
  scheduleRuntimeDebugRefresh: (threadId: string) => void
  emitRendererDebugEvent: (
    threadId: string,
    eventType: string,
    payload: unknown,
    options?: { agentRunId?: string | null }
  ) => void
  ensureQueueController: (threadId: string) => ThreadQueueController
  ensureMessageBuffer: (threadId: string) => ChatMessage[]
  removeRuntimeQueueItemById: (
    controller: ThreadQueueController,
    queueItemId?: string | null
  ) => PendingQueueItem | null
  removeRuntimeQueueItemBySubmissionId: (
    controller: ThreadQueueController,
    submissionId?: string | null
  ) => PendingQueueItem | null
  removeQueueItem: (controller: ThreadQueueController, itemId: string) => void
  getAgentRunMap: (threadId: string) => Map<string, AgentRun>
  getActiveRun: (threadId: string) => AgentRun | null
  setActiveRun: (threadId: string, run: AgentRun) => void
  setThreadStreaming: (threadId: string, value: boolean) => void
  upsertProjectedRun: (
    threadId: string,
    projection: AgentThreadProjection['runs'][number]
  ) => AgentRun
  syncAssistantTurnMessage: (
    list: ChatMessage[],
    run: AgentRun | null,
    turn: AgentTurn | null,
    allowCreate?: boolean
  ) => ChatMessage | null
  syncAssistantMessagesForRun: (
    list: ChatMessage[],
    run: AgentRun | null,
    allowCreate?: boolean
  ) => void
  finalizeAssistantMessageForThread: (
    threadId: string,
    list: ChatMessage[],
    run: AgentRun | null
  ) => Promise<void>
  applyInlineWidgetToAssistantMessage: (
    list: ChatMessage[],
    run: AgentRun | null,
    turnId: string | null,
    widget: ChatWidget
  ) => void
  onRunSettled: (threadId: string, runId: string, status: string) => Promise<void>
  persistRuntimeUserMessage: (
    threadId: string,
    message: ChatMessage,
    options: PersistRuntimeUserMessageOptions
  ) => Promise<void>
  scrollToBottom: (options?: { force?: boolean }) => void | Promise<void>
}

const isRuntimeUiDebugEnabled = (): boolean => {
  if (!import.meta.env.DEV) return false
  return false
}

const logRuntimeUiDebug = (label: string, payload: unknown): void => {
  if (!isRuntimeUiDebugEnabled()) return
  console.debug(`[piagent-runtime-ui] ${label}`, payload)
}

const getQueueItemId = (event: ThreadScopedAgentAppEvent): string | null => {
  return typeof event.queueItemId === 'string' && event.queueItemId.trim()
    ? event.queueItemId
    : null
}

export const createRuntimeEventBridge = (options: RuntimeEventBridgeOptions) => {
  return async (event: ThreadScopedAgentAppEvent): Promise<void> => {
    const eventThreadId = typeof event.__chatThreadId === 'string' ? event.__chatThreadId : null
    const activeId = options.activeThread.value?.id ?? null
    const boundId = options.runtimeBinding.value?.chatThreadId ?? null
    const threadId = eventThreadId || event.threadId || boundId || activeId
    if (!threadId) return
    options.appendRuntimeLiveDebugEvent(
      threadId,
      options.createRuntimeLiveEventFromAppEvent(threadId, event)
    )

    const isActiveEvent = Boolean(activeId && threadId === activeId)
    const controller = options.ensureQueueController(threadId)

    if (controller.runtimeState === 'aborting' && event.type !== 'agent.run.aborted') {
      return
    }

    const targetMessages = (() => {
      const cached = options.messageCacheByThreadId.get(threadId)
      if (cached) return cached
      if (isActiveEvent) {
        options.messageCacheByThreadId.set(threadId, options.messages.value)
        return options.messages.value
      }
      return options.ensureMessageBuffer(threadId)
    })()
    if (!options.messageCacheByThreadId.has(threadId)) {
      options.messageCacheByThreadId.set(threadId, targetMessages)
    }

    options.scheduleRuntimeDebugRefresh(threadId)

    if (event.type === 'agent.queue.consumed') {
      const queueItemId = getQueueItemId(event)
      const submissionId = event.submissionId ?? null
      const runtimeItem =
        options.removeRuntimeQueueItemById(controller, queueItemId) ??
        options.removeRuntimeQueueItemBySubmissionId(controller, submissionId)
      if (queueItemId) options.removeQueueItem(controller, queueItemId)

      const text = event.text || runtimeItem?.text || ''
      const isAutomationPrompt = isAutomationPromptText(text)
      const list = options.ensureMessageBuffer(threadId)
      const existingAgentMsg = findAgentUserMessage(
        list,
        text,
        submissionId,
        event.agentRunId,
        event.agentTurnId
      )
      const replayAnchor = !existingAgentMsg ? findReplayAnchorUserMessage(list, text) : null
      const optimisticUser =
        !existingAgentMsg && !replayAnchor ? findOptimisticDispatchedUserMessage(list, text) : null

      const blocks =
        existingAgentMsg?.blocks ??
        runtimeItem?.blocks ??
        replayAnchor?.blocks ??
        optimisticUser?.blocks ??
        buildUserBlocks(text, runtimeItem?.images ?? [])

      const userMsg =
        existingAgentMsg ??
        replayAnchor ??
        optimisticUser ??
        (shouldAppendConsumedUserMessage(list, text)
          ? ({
              role: 'user',
              messageKind: isAutomationPrompt ? 'automation' : 'chat',
              includeInAgentContext: !isAutomationPrompt,
              content: text,
              blocks
            } as ChatMessage)
          : null)

      if (!userMsg) return

      if (!existingAgentMsg && !replayAnchor && !optimisticUser) list.push(userMsg)
      userMsg.content = text
      userMsg.blocks = blocks
      userMsg.messageKind = isAutomationPrompt ? 'automation' : 'chat'
      userMsg.includeInAgentContext = !isAutomationPrompt
      userMsg.retryCandidate = false
      userMsg.submissionId = submissionId ?? userMsg.submissionId
      userMsg.runtimeSequence = event.sequence
      userMsg.agentRunId = event.agentRunId ?? undefined
      userMsg.agentTurnId = event.agentTurnId ?? undefined
      reorderChatMessagesInPlace(list)
      options.emitRendererDebugEvent(
        threadId,
        'debugUiUserQueueConsumed',
        {
          submissionId,
          queueItemId,
          agentRunId: event.agentRunId ?? null,
          agentTurnId: event.agentTurnId ?? null,
          runtimeSequence: event.sequence,
          matchedExisting: Boolean(existingAgentMsg),
          matchedReplayAnchor: Boolean(replayAnchor),
          matchedOptimistic: Boolean(optimisticUser),
          user: summarizeDebugMessage(userMsg),
          tail: summarizeDebugMessages(list)
        },
        { agentRunId: event.agentRunId }
      )

      if (options.activeThread.value?.id === threadId) {
        options.messages.value = list
        void options.scrollToBottom()
      }

      try {
        await options.persistRuntimeUserMessage(threadId, userMsg, {
          blocks,
          agentRunId: event.agentRunId,
          submissionId,
          agentTurnId: event.agentTurnId,
          runtimeSequence: event.sequence,
          createdAt: event.timestamp
        })
      } catch (error) {
        console.error('Persist queued user message failed', error)
      }
      return
    }

    if (event.type === 'agent.message.started' && event.message.role === 'user') {
      const queueItemId = getQueueItemId(event)
      const submissionId = event.submissionId ?? null
      if (queueItemId) options.removeQueueItem(controller, queueItemId)
      const runtimeItem =
        options.removeRuntimeQueueItemById(controller, queueItemId) ??
        options.removeRuntimeQueueItemBySubmissionId(controller, submissionId)

      const list = options.ensureMessageBuffer(threadId)
      const isAutomationPrompt = isAutomationPromptText(event.message.text)

      const existingAgentMsg = findAgentUserMessage(
        list,
        event.message.text,
        submissionId,
        event.agentRunId,
        event.agentTurnId
      )
      const replayAnchor = !existingAgentMsg
        ? findReplayAnchorUserMessage(list, event.message.text)
        : null
      const optimisticUser =
        !existingAgentMsg && !replayAnchor
          ? findOptimisticDispatchedUserMessage(list, event.message.text)
          : null

      const blocks =
        existingAgentMsg?.blocks ??
        replayAnchor?.blocks ??
        optimisticUser?.blocks ??
        runtimeItem?.blocks ??
        buildUserBlocks(event.message.text, runtimeItem?.images ?? [])

      const userMsg =
        existingAgentMsg ??
        replayAnchor ??
        optimisticUser ??
        (shouldAppendConsumedUserMessage(list, event.message.text)
          ? ({
              role: 'user',
              messageKind: isAutomationPrompt ? 'automation' : 'chat',
              includeInAgentContext: !isAutomationPrompt,
              content: event.message.text,
              runtimeSequence: event.sequence,
              blocks
            } as ChatMessage)
          : null)

      if (!userMsg) return

      if (!existingAgentMsg && !replayAnchor && !optimisticUser) list.push(userMsg)
      userMsg.content = event.message.text
      userMsg.blocks = blocks
      userMsg.messageKind = isAutomationPrompt ? 'automation' : 'chat'
      userMsg.includeInAgentContext = !isAutomationPrompt
      userMsg.submissionId = submissionId ?? userMsg.submissionId
      userMsg.agentRunId = event.agentRunId ?? undefined
      userMsg.agentTurnId = event.agentTurnId ?? undefined
      userMsg.runtimeSequence = event.sequence
      userMsg.retryCandidate = false
      reorderChatMessagesInPlace(list)
      options.emitRendererDebugEvent(
        threadId,
        'debugUiUserMessageStarted',
        {
          submissionId,
          queueItemId,
          agentRunId: event.agentRunId ?? null,
          agentTurnId: event.agentTurnId ?? null,
          runtimeSequence: event.sequence,
          matchedExisting: Boolean(existingAgentMsg),
          matchedReplayAnchor: Boolean(replayAnchor),
          matchedOptimistic: Boolean(optimisticUser),
          user: summarizeDebugMessage(userMsg),
          tail: summarizeDebugMessages(list)
        },
        { agentRunId: event.agentRunId }
      )

      if (options.activeThread.value?.id === threadId) {
        options.messages.value = list
        void options.scrollToBottom()
      }

      try {
        await options.persistRuntimeUserMessage(threadId, userMsg, {
          blocks,
          agentRunId: event.agentRunId,
          submissionId,
          agentTurnId: event.agentTurnId,
          runtimeSequence: event.sequence,
          createdAt: event.timestamp
        })
      } catch (error) {
        console.error('Persist queued user message failed', error)
      }
      return
    }

    if (event.type === 'agent.message.started' && event.message.role === 'assistant') {
      const run =
        options.getAgentRunMap(threadId).get(event.agentRunId) ?? options.getActiveRun(threadId)
      if (!run) return
      const turn = getRunTurnById(run, event.agentTurnId)
      const assistant = options.syncAssistantTurnMessage(targetMessages, run, turn, true)
      if (assistant) {
        assistant.runtimeSequence = event.sequence
        assistant.createdAt = assistant.createdAt ?? new Date(event.timestamp).toISOString()
        assistant.isPending = true
        if (!assistant.content.trim()) assistant.content = ''
      }
      reorderChatMessagesInPlace(targetMessages)
      logRuntimeUiDebug('assistant.started', {
        threadId,
        agentRunId: event.agentRunId,
        agentTurnId: event.agentTurnId,
        runtimeSequence: event.sequence,
        assistantMessageId: assistant?.id ?? null,
        messageCount: targetMessages.length,
        tail: summarizeDebugMessages(targetMessages)
      })
      options.emitRendererDebugEvent(
        threadId,
        'debugUiAssistantStarted',
        {
          agentTurnId: event.agentTurnId,
          runtimeSequence: event.sequence,
          assistantMessageId: assistant?.id ?? null,
          messageCount: targetMessages.length,
          tail: summarizeDebugMessages(targetMessages)
        },
        { agentRunId: event.agentRunId }
      )
      if (isActiveEvent) void options.scrollToBottom()
      return
    }

    if (
      event.type === 'agent.run.started' ||
      event.type === 'agent.run.updated' ||
      event.type === 'agent.run.finished' ||
      event.type === 'agent.run.failed' ||
      event.type === 'agent.run.aborted'
    ) {
      const isFinalEvent =
        event.type === 'agent.run.finished' ||
        event.type === 'agent.run.failed' ||
        event.type === 'agent.run.aborted'

      options.setThreadStreaming(threadId, !isFinalEvent)
      const run = options.upsertProjectedRun(threadId, event.run)
      if (run.status === 'running') {
        options.setActiveRun(threadId, run)
        controller.activeRunId = run.id
        controller.runtimeState = 'running'
      } else {
        options.activeRunByThreadId.delete(threadId)
        if (isFinalEvent) {
          controller.activeRunId = null
          controller.runtimeState = 'idle'
        }
      }

      options.syncAssistantMessagesForRun(targetMessages, run, true)
      if (event.type === 'agent.run.aborted') {
        removeOptimisticAssistantPlaceholders(targetMessages)
        resetQueueControllerAfterAbort(controller)
      }
      pruneStalePendingAssistantMessages(targetMessages)
      reorderChatMessagesInPlace(targetMessages)
      options.emitRendererDebugEvent(
        threadId,
        'debugUiRunEventApplied',
        {
          type: event.type,
          isFinalEvent,
          runId: run.id,
          runStatus: run.status,
          activeRunId: controller.activeRunId,
          runtimeState: controller.runtimeState,
          messageCount: targetMessages.length,
          tail: summarizeDebugMessages(targetMessages)
        },
        { agentRunId: run.id }
      )

      if (isFinalEvent) {
        await options.finalizeAssistantMessageForThread(threadId, targetMessages, run)
        pruneStalePendingAssistantMessages(targetMessages)
        reorderChatMessagesInPlace(targetMessages)
        options.emitRendererDebugEvent(
          threadId,
          'debugUiRunFinalized',
          {
            type: event.type,
            runId: run.id,
            runStatus: run.status,
            messageCount: targetMessages.length,
            tail: summarizeDebugMessages(targetMessages)
          },
          { agentRunId: run.id }
        )
        await options.onRunSettled(threadId, run.id, run.status)
      }

      if (isActiveEvent) void options.scrollToBottom()
      return
    }

    if (event.type === 'agent.message.delta') {
      options.setThreadStreaming(threadId, true)
      const run =
        options.getAgentRunMap(threadId).get(event.agentRunId) ?? options.getActiveRun(threadId)
      if (!run) return
      applyMessageDeltaToRun(run, event)
      options.setActiveRun(threadId, run)
      controller.activeRunId = run.id
      controller.runtimeState = 'running'
      const assistant = options.syncAssistantTurnMessage(
        targetMessages,
        run,
        getRunTurnById(run, event.agentTurnId),
        true
      )
      if (assistant) {
        if (assistant.runtimeSequence == null) assistant.runtimeSequence = event.sequence
        assistant.createdAt = assistant.createdAt ?? new Date(event.timestamp).toISOString()
        if (event.contentKind === 'text') {
          assistant.content =
            getAssistantDisplayContentForTurn(run, getRunTurnById(run, event.agentTurnId)) ||
            assistant.content
          assistant.isPending = false
        } else {
          assistant.isPending = !assistant.content.trim()
          if (!assistant.content.trim()) assistant.content = ''
        }
        assistant.run = run
        assistant.agentRunId = run.id
        assistant.agentTurnId = event.agentTurnId ?? undefined
      }
      pruneStalePendingAssistantMessages(targetMessages)
      reorderChatMessagesInPlace(targetMessages)
      logRuntimeUiDebug('assistant.delta', {
        threadId,
        agentRunId: event.agentRunId,
        agentTurnId: event.agentTurnId,
        runtimeSequence: event.sequence,
        contentLength: assistant?.content.length ?? 0,
        messageCount: targetMessages.length
      })
      options.emitRendererDebugEvent(
        threadId,
        'debugUiAssistantDelta',
        {
          agentTurnId: event.agentTurnId,
          runtimeSequence: event.sequence,
          contentLength: assistant?.content.length ?? 0,
          messageCount: targetMessages.length
        },
        { agentRunId: event.agentRunId }
      )
      if (isActiveEvent) void options.scrollToBottom()
      return
    }

    if (
      event.type === 'agent.tool.started' ||
      event.type === 'agent.tool.progress' ||
      event.type === 'agent.tool.finished'
    ) {
      options.setThreadStreaming(threadId, true)
      const run =
        options.getAgentRunMap(threadId).get(event.agentRunId) ?? options.getActiveRun(threadId)
      if (!run) return
      syncToolProjectionIntoRun(run, event.tool)

      if (event.tool.name === 'widgetRenderer' && event.tool.status === 'done' && isActiveEvent) {
        const widgetState = buildWidgetStateFromTool(event.tool)
        if (widgetState) {
          if (widgetState.kind === 'html' && widgetState.html) {
            try {
              const registered = await window.api.widget.registerHtml(threadId, widgetState.html)
              const resolvedWidget: ChatWidget = {
                ...widgetState,
                url: registered.url,
                widgetId: registered.id
              }
              options.applyInlineWidgetToAssistantMessage(
                targetMessages,
                run,
                event.tool.agentTurnId ?? null,
                resolvedWidget
              )
            } catch (error) {
              console.error('Failed to register widget html', error)
            }
          } else {
            options.applyInlineWidgetToAssistantMessage(
              targetMessages,
              run,
              event.tool.agentTurnId ?? null,
              widgetState
            )
          }
        } else {
          console.error('Failed to resolve widget data', event.tool)
        }
      }
      options.setActiveRun(threadId, run)
      controller.activeRunId = run.id
      controller.runtimeState = 'running'
      const assistant = options.syncAssistantTurnMessage(
        targetMessages,
        run,
        getRunTurnById(run, event.tool.agentTurnId),
        true
      )
      if (assistant) {
        assistant.createdAt = assistant.createdAt ?? new Date(event.timestamp).toISOString()
        assistant.isPending = !assistant.content.trim() && !assistant.widget
        assistant.run = run
        assistant.agentRunId = run.id
        assistant.agentTurnId = event.tool.agentTurnId ?? undefined
        if (!assistant.content.trim()) assistant.content = ''
      }
      pruneStalePendingAssistantMessages(targetMessages)
      reorderChatMessagesInPlace(targetMessages)
      logRuntimeUiDebug('tool.event', {
        threadId,
        type: event.type,
        agentRunId: event.agentRunId,
        agentTurnId: event.tool.agentTurnId,
        toolCallId: event.tool.toolCallId,
        toolName: event.tool.name,
        toolKind: event.tool.kind,
        toolStatus: event.tool.status,
        toolCallsInTurn:
          getRunTurnById(run, event.tool.agentTurnId)?.toolCalls.map((tool) => ({
            id: tool.id,
            name: tool.name,
            kind: tool.kind,
            status: tool.status
          })) ?? [],
        messageCount: targetMessages.length
      })
      if (isActiveEvent) void options.scrollToBottom()
    }
  }
}
