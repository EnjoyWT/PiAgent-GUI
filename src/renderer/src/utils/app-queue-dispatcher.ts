import { computed, reactive, type ComputedRef, type Ref } from 'vue'
import { generateId } from '@shared/id'
import type { ThreadRow } from '../../../preload/db-types'
import type {
  AgentRun,
  ChatContentBlock,
  ChatImageBlock,
  ChatMessage,
  ChatMessageContent,
  PendingQueueItem,
  QueueRuntimeState
} from '../components/chat/types'
import { ensureAssistantTurnMessageIn, getRunFinishedNotificationPreview } from './app-runtime'
import {
  buildMessageContentJson,
  buildUserBlocks,
  createQueueItem,
  mergeQueuedMessages,
  toPendingRuntimeQueueItem,
  toPlainContentJson,
  toPlainImageBlocks
} from './app-chat-helpers'
import {
  canAbortFromRuntimeState,
  resetQueueControllerAfterAbort
} from './app-queue-state'
import { removeOptimisticAssistantPlaceholders } from './pending-assistant-placeholder'

export type DispatchPolicy = 'auto' | 'paused'

export type PostRunAction =
  | { type: 'none' }
  | { type: 'auto_flush_head' }
  | { type: 'dispatch_item'; itemId: string }
  | { type: 'dispatch_queue_batch' }
  | { type: 'dispatch_text'; text: string }
  | { type: 'hold' }
  | { type: 'clear_queue' }

export type ThreadQueueController = {
  queue: PendingQueueItem[]
  runtimeQueue: PendingQueueItem[]
  activeRunId: string | null
  runtimeState: QueueRuntimeState
  dispatchPolicy: DispatchPolicy
  postRunAction: PostRunAction
  actionRevision: number
}

type RuntimeStatus = {
  text: string
  tone: 'idle' | 'ok' | 'error'
}

type RuntimeBinding = {
  chatThreadId: string
} | null

type QueueDispatcherOptions = {
  activeThread: Ref<ThreadRow | null>
  messages: Ref<ChatMessage[]>
  inputText: Ref<string>
  composerAttachments: Ref<File[]>
  currentModelSupportsImageInput: ComputedRef<boolean> | Ref<boolean>
  runtimeStatus: Ref<RuntimeStatus>
  runtimeBinding: Ref<RuntimeBinding>
  activeRunByThreadId: Map<string, AgentRun>
  getAgentRunMap: (threadId: string) => Map<string, AgentRun>
  getThreadRowById: (threadId: string) => ThreadRow | null
  ensureThreadTitleFromText: (thread: ThreadRow, text: string, imageCount?: number) => Promise<void>
  ensureThreadStarted: (thread: ThreadRow) => Promise<ThreadRow>
  ensureMessageBuffer: (threadId: string) => ChatMessage[]
  setThreadStreaming: (threadId: string, value: boolean) => void
  scrollToBottom: (options?: { force?: boolean }) => void | Promise<void>
  loadLatestThreadWindow: (threadId: string, mode?: 'replace' | 'merge-latest') => Promise<void>
  confirmTextOnlyFallback: (text: string, imagesCount: number) => Promise<boolean>
  isStreaming: ComputedRef<boolean> | Ref<boolean>
  onRunFinishedNotificationState?: (payload: {
    threadId: string
    runId: string
    notificationShown: boolean
  }) => void
}

type SubmitLocalMessageResult = Awaited<ReturnType<typeof window.api.gateway.submitLocalMessage>>

type QueueDispatcherState = {
  queueControllersByThreadId: Record<string, ThreadQueueController>
  pendingQueue: ComputedRef<PendingQueueItem[]>
  queueRuntimeState: ComputedRef<QueueRuntimeState>
  queueDispatchPolicy: ComputedRef<DispatchPolicy>
  canAbortCurrentRun: ComputedRef<boolean>
  ensureQueueController: (threadId: string) => ThreadQueueController
  bumpQueueRevision: (controller: ThreadQueueController) => void
  removeQueueItem: (controller: ThreadQueueController, itemId: string) => void
  removeRuntimeQueueItemByText: (
    controller: ThreadQueueController,
    text: string
  ) => PendingQueueItem | null
  syncRuntimeQueue: (threadId: string) => Promise<void>
  enqueuePendingMessage: (
    threadId: string,
    text: string,
    blocks?: ChatContentBlock[],
    images?: ChatImageBlock[]
  ) => void
  dispatchMessageNow: (
    threadId: string,
    text: string,
    blocks?: ChatContentBlock[],
    options?: {
      clearInput?: boolean
      clearAttachments?: boolean
      queuedItem?: PendingQueueItem
      queuedItemIndex?: number
      queuedBatch?: PendingQueueItem[]
      promptOptions?: {
        streamingBehavior?: 'steer' | 'followUp'
        images?: ChatImageBlock[]
      }
      contentJson?: ChatMessageContent | null
    }
  ) => Promise<boolean>
  dispatchQueuedItemNow: (threadId: string, itemId: string) => Promise<boolean>
  dispatchQueuedHead: (threadId: string) => Promise<boolean>
  dispatchQueuedBatchNow: (threadId: string) => Promise<boolean>
  requestQueuedItemDispatch: (threadId: string, itemId: string) => Promise<void>
  deleteQueuedItem: (threadId: string, itemId: string) => void
  dispatchActiveQueuedItem: (itemId: string) => void
  dispatchAllActiveQueuedItems: () => void
  deleteActiveQueuedItem: (itemId: string) => void
  onRunSettled: (threadId: string, runId: string, status: string) => Promise<void>
  cancelCurrentProcessing: () => Promise<void>
}

export const createSubmissionId = (): string => generateId()

export const submitLocalMessageToGateway = async (input: {
  threadId: string
  text: string
  messageId?: string | null
  images?: ChatImageBlock[]
  streamingBehavior?: 'steer' | 'followUp'
}): Promise<SubmitLocalMessageResult> => {
  return await window.api.gateway.submitLocalMessage({
    threadId: input.threadId,
    text: input.text,
    messageId: input.messageId ?? null,
    images: toPlainImageBlocks(input.images ?? []),
    streamingBehavior: input.streamingBehavior
  })
}

const createThreadQueueController = (): ThreadQueueController =>
  reactive({
    queue: [] as PendingQueueItem[],
    runtimeQueue: [] as PendingQueueItem[],
    activeRunId: null,
    runtimeState: 'idle' as QueueRuntimeState,
    dispatchPolicy: 'auto' as DispatchPolicy,
    postRunAction: { type: 'none' } as PostRunAction,
    actionRevision: 0
  }) as ThreadQueueController

export const useQueueDispatcher = (options: QueueDispatcherOptions): QueueDispatcherState => {
  const queueControllersByThreadId = reactive<Record<string, ThreadQueueController>>({})

  const ensureQueueController = (threadId: string): ThreadQueueController => {
    const existing = queueControllersByThreadId[threadId]
    if (existing) return existing
    const created = createThreadQueueController()
    queueControllersByThreadId[threadId] = created
    return created
  }

  const bumpQueueRevision = (controller: ThreadQueueController): void => {
    controller.actionRevision += 1
  }

  const activeQueueController = computed<ThreadQueueController | null>(() => {
    const threadId = options.activeThread.value?.id
    if (!threadId) return null
    return ensureQueueController(threadId)
  })

  const pendingQueue = computed(() => {
    const controller = activeQueueController.value
    if (!controller) return []
    return [...controller.runtimeQueue, ...controller.queue]
  })

  const queueRuntimeState = computed<QueueRuntimeState>(
    () => activeQueueController.value?.runtimeState ?? 'idle'
  )

  const queueDispatchPolicy = computed<DispatchPolicy>(
    () => activeQueueController.value?.dispatchPolicy ?? 'auto'
  )

  const canAbortCurrentRun = computed(() => {
    const state = queueRuntimeState.value
    return canAbortFromRuntimeState(state, options.isStreaming.value)
  })

  const setQueueAction = (
    controller: ThreadQueueController,
    action: PostRunAction,
    dispatchPolicy?: DispatchPolicy
  ): void => {
    controller.postRunAction = action
    if (dispatchPolicy) controller.dispatchPolicy = dispatchPolicy
    bumpQueueRevision(controller)
  }

  const findQueueItem = (
    controller: ThreadQueueController,
    itemId: string
  ): PendingQueueItem | null => controller.queue.find((item) => item.id === itemId) ?? null

  const removeQueueItem = (controller: ThreadQueueController, itemId: string): void => {
    const index = controller.queue.findIndex((item) => item.id === itemId)
    if (index >= 0) controller.queue.splice(index, 1)
  }

  const insertQueueItemAt = (
    controller: ThreadQueueController,
    item: PendingQueueItem,
    index?: number
  ): void => {
    const normalizedIndex =
      typeof index === 'number' ? Math.max(0, Math.min(index, controller.queue.length)) : 0
    controller.queue.splice(normalizedIndex, 0, item)
  }

  const syncRuntimeQueue = async (threadId: string): Promise<void> => {
    const controller = ensureQueueController(threadId)
    try {
      const snapshot = await window.api.runtime.getQueuedMessages(threadId)
      controller.runtimeQueue = snapshot.map((item) => toPendingRuntimeQueueItem(item))
      bumpQueueRevision(controller)
    } catch (error) {
      console.error('Sync runtime queue failed', error)
    }
  }



  const removeRuntimeQueueItemByText = (
    controller: ThreadQueueController,
    text: string
  ): PendingQueueItem | null => {
    const normalized = text.replace(/\r\n/g, '\n').trim()
    const index = controller.runtimeQueue.findIndex(
      (item) => item.text.replace(/\r\n/g, '\n').trim() === normalized
    )
    if (index < 0) return null
    const [removed] = controller.runtimeQueue.splice(index, 1)
    bumpQueueRevision(controller)
    return removed ?? null
  }

  const enqueuePendingMessage = (
    threadId: string,
    text: string,
    blocks?: ChatContentBlock[],
    images?: ChatImageBlock[]
  ): void => {
    const controller = ensureQueueController(threadId)
    controller.queue.push(createQueueItem(text, blocks, images))
    setQueueAction(controller, { type: 'auto_flush_head' }, 'auto')
  }

  const shouldAutoFlushLocalQueue = (controller: ThreadQueueController): boolean => {
    if (controller.dispatchPolicy !== 'auto') return false
    if (controller.runtimeQueue.length > 0) return false
    return controller.queue.some((item) => item.status === 'queued')
  }

  const resolveQueuedItemForDispatch = async (
    item: PendingQueueItem
  ): Promise<PendingQueueItem | null> => {
    if ((item.images?.length ?? 0) === 0 || options.currentModelSupportsImageInput.value) {
      return item
    }
    const confirmed = await options.confirmTextOnlyFallback(item.text, item.images?.length ?? 0)
    if (!confirmed) return null
    return {
      ...item,
      images: [],
      blocks: buildUserBlocks(item.text, [])
    }
  }

  const submitQueuedMessageToRuntime = async (
    threadId: string,
    items: PendingQueueItem[],
    text: string,
    delivery: 'steer' | 'followUp',
    images?: ChatImageBlock[]
  ): Promise<boolean> => {
    if (items.length === 0) return false
    const normalizedImages = images ?? []
    if (normalizedImages.length > 0 && !options.currentModelSupportsImageInput.value) {
      const confirmed = await options.confirmTextOnlyFallback(text, normalizedImages.length)
      if (!confirmed) return false
      images = []
    }
    const controller = ensureQueueController(threadId)

    for (const item of items) {
      removeQueueItem(controller, item.id)
    }
    bumpQueueRevision(controller)

    let persistedUserId: string | null = null
    try {
      const blocks = buildUserBlocks(text, images ?? [])
      const row = await window.api.coreV2.localMessages.add(
        threadId,
        'user',
        text,
        undefined,
        toPlainContentJson(buildMessageContentJson(blocks)),
        undefined
      )
      persistedUserId = row.id

      await submitLocalMessageToGateway({
        threadId,
        text,
        messageId: persistedUserId,
        images,
        streamingBehavior: delivery,
      })
      controller.runtimeQueue.push({
        id: persistedUserId,
        text,
        blocks,
        images: images?.map((image) => ({ ...image })),
        createdAt: Date.now(),
        status: 'submitted',
        submittedAt: Date.now(),
        delivery,
        runtimeText: text
      })
      bumpQueueRevision(controller)
      return true
    } catch (error) {
      if (persistedUserId) {
        try {
          await window.api.coreV2.localMessages.delete(persistedUserId)
        } catch (deleteError) {
          console.error('Delete failed queued user message failed', deleteError)
        }
      }
      for (const item of items) {
        insertQueueItemAt(controller, { ...item, status: 'queued' })
      }
      controller.dispatchPolicy = 'paused'
      controller.postRunAction = { type: 'hold' }
      bumpQueueRevision(controller)
      console.error('Submit queued message to runtime failed', error)
      options.runtimeStatus.value = {
        text: error instanceof Error ? `发送失败: ${error.message.slice(0, 120)}` : '发送失败',
        tone: 'error'
      }
      return false
    }
  }

  const removePendingDispatchArtifacts = async (
    threadId: string,
    list: ChatMessage[],
    userMsg: ChatMessage,
    pendingMessage: ChatMessage | null,
    persistedUserId?: string
  ): Promise<void> => {
    const userIndex = list.indexOf(userMsg)
    if (userIndex >= 0) list.splice(userIndex, 1)

    if (pendingMessage) {
      const pendingIndex = list.indexOf(pendingMessage)
      const canDropPending =
        pendingIndex >= 0 &&
        pendingMessage.isPending &&
        !pendingMessage.agentRunId &&
        !pendingMessage.run &&
        !pendingMessage.content.trim()
      if (canDropPending) list.splice(pendingIndex, 1)
    }

    if (persistedUserId) {
      try {
        await window.api.coreV2.localMessages.delete(persistedUserId)
      } catch (err) {
        console.error('Delete reverted user message failed', err)
      }
    }

    const activeId = options.activeThread.value?.id
    if (activeId === threadId) {
      options.messages.value = list
    }
  }

  const dispatchMessageNow = async (
    threadId: string,
    text: string,
    blocks?: ChatContentBlock[],
    dispatchOptions?: {
      clearInput?: boolean
      clearAttachments?: boolean
      queuedItem?: PendingQueueItem
      queuedItemIndex?: number
      queuedBatch?: PendingQueueItem[]
      promptOptions?: {
        streamingBehavior?: 'steer' | 'followUp'
        images?: ChatImageBlock[]
      }
      contentJson?: ChatMessageContent | null
    }
  ): Promise<boolean> => {
    const controller = ensureQueueController(threadId)
    let thread = options.getThreadRowById(threadId)
    if (!thread) throw new Error(`Thread not found: ${threadId}`)

    const isActiveThread = options.activeThread.value?.id === threadId
    if (dispatchOptions?.clearInput && isActiveThread) options.inputText.value = ''
    if (dispatchOptions?.clearAttachments && isActiveThread) {
      options.composerAttachments.value = []
    }

    const list = options.ensureMessageBuffer(threadId)
    const userMsg: ChatMessage = {
      role: 'user',
      messageKind: 'chat',
      includeInAgentContext: true,
      content: text,
      blocks,
    }
    list.push(userMsg)

    const pendingMessage = ensureAssistantTurnMessageIn(list, null, null, true)
    if (pendingMessage) {
      pendingMessage.content = '思考中...'
      pendingMessage.isPending = true
      pendingMessage.run = undefined
      pendingMessage.agentRunId = undefined
      pendingMessage.agentTurnId = undefined
    }

    controller.runtimeState = 'dispatching'
    controller.activeRunId = null
    options.setThreadStreaming(threadId, true)
    if (isActiveThread) void options.scrollToBottom({ force: true })

    let persistedUserId: string | undefined
    try {
      const row = await window.api.coreV2.localMessages.add(
        threadId,
        'user',
        text,
        undefined,
        toPlainContentJson(dispatchOptions?.contentJson),
        undefined
      )
      userMsg.id = row.id
      userMsg.createdAt = row.created_at
      persistedUserId = row.id
    } catch (err) {
      console.error('Persist user message failed', err)
      options.setThreadStreaming(threadId, false)
      controller.activeRunId = null
      controller.runtimeState = 'idle'
      options.runtimeStatus.value = {
        text: err instanceof Error ? `发送失败: ${err.message.slice(0, 120)}` : '发送失败',
        tone: 'error'
      }
      await removePendingDispatchArtifacts(threadId, list, userMsg, pendingMessage ?? null)
      return false
    }

    try {
      await options.ensureThreadTitleFromText(
        thread,
        text,
        dispatchOptions?.promptOptions?.images?.length ?? 0
      )
      thread = await options.ensureThreadStarted(thread)

      await submitLocalMessageToGateway({
        threadId: thread.id,
        text,
        messageId: persistedUserId ?? null,
        images: dispatchOptions?.promptOptions?.images ?? [],
        streamingBehavior: dispatchOptions?.promptOptions?.streamingBehavior,
      })

      if ((controller.runtimeState as QueueRuntimeState) === 'aborting') {
        removeOptimisticAssistantPlaceholders(list)
        options.setThreadStreaming(threadId, false)
        return true
      }

      await options.loadLatestThreadWindow(thread.id, 'merge-latest')
      return true
    } catch (err) {
      if (options.runtimeBinding.value?.chatThreadId === threadId) {
        options.runtimeBinding.value = null
      }
      options.setThreadStreaming(threadId, false)
      options.activeRunByThreadId.delete(threadId)
      controller.activeRunId = null
      controller.runtimeState = 'idle'
      const msg = err instanceof Error ? err.message : String(err)
      options.runtimeStatus.value = { text: `发送失败: ${msg.slice(0, 120)}`, tone: 'error' }

      if (dispatchOptions?.queuedItem) {
        insertQueueItemAt(controller, dispatchOptions.queuedItem, dispatchOptions.queuedItemIndex)
        controller.dispatchPolicy = 'paused'
        controller.postRunAction = { type: 'hold' }
        bumpQueueRevision(controller)
        if (pendingMessage) {
          pendingMessage.content = ''
          pendingMessage.isPending = true
        }
        await removePendingDispatchArtifacts(
          threadId,
          list,
          userMsg,
          pendingMessage ?? null,
          persistedUserId
        )
        return false
      }

      if (dispatchOptions?.queuedBatch?.length) {
        controller.queue.splice(0, 0, ...dispatchOptions.queuedBatch)
        controller.dispatchPolicy = 'paused'
        controller.postRunAction = { type: 'hold' }
        bumpQueueRevision(controller)
        if (pendingMessage) {
          pendingMessage.content = ''
          pendingMessage.isPending = true
        }
        await removePendingDispatchArtifacts(
          threadId,
          list,
          userMsg,
          pendingMessage ?? null,
          persistedUserId
        )
        return false
      }

      if (pendingMessage) {
        pendingMessage.isPending = false
        pendingMessage.run = undefined
        pendingMessage.agentRunId = undefined
        pendingMessage.content = `请求失败：${msg}`
      } else {
        list.push({ role: 'assistant', content: `请求失败：${msg}` })
      }
      await window.api.coreV2.localMessages.add(threadId, 'assistant', `请求失败：${msg}`)
      return false
    }
  }

  const dispatchQueuedItemNow = async (threadId: string, itemId: string): Promise<boolean> => {
    const controller = ensureQueueController(threadId)
    const rawItem = findQueueItem(controller, itemId)
    const item = rawItem ? await resolveQueuedItemForDispatch(rawItem) : null
    if (!item) return false

    if (rawItem && rawItem !== item) {
      const index = controller.queue.findIndex((entry) => entry.id === rawItem.id)
      if (index >= 0) controller.queue.splice(index, 1, item)
    }

    if (controller.runtimeState === 'running') {
      const delivery = controller.runtimeQueue.some((entry) => entry.delivery === 'steer')
        ? 'followUp'
        : 'steer'
      return await submitQueuedMessageToRuntime(threadId, [item], item.text, delivery, item.images)
    }

    const itemIndex = controller.queue.findIndex((entry) => entry.id === itemId)
    if (itemIndex < 0) return false
    const target = controller.queue[itemIndex]
    controller.queue.splice(itemIndex, 1)
    controller.postRunAction = { type: 'none' }
    controller.runtimeState = 'dispatching'
    return await dispatchMessageNow(threadId, target.text, target.blocks, {
      queuedItem: target,
      queuedItemIndex: itemIndex,
      contentJson: buildMessageContentJson(
        target.blocks ?? buildUserBlocks(target.text, target.images ?? [])
      ),
      promptOptions: target.images?.length ? { images: target.images } : undefined
    })
  }

  const dispatchQueuedHead = async (threadId: string): Promise<boolean> => {
    const controller = ensureQueueController(threadId)
    const head = controller.queue[0] ?? null
    if (!head) return false
    return await dispatchQueuedItemNow(threadId, head.id)
  }

  const dispatchQueuedBatchNow = async (threadId: string): Promise<boolean> => {
    const controller = ensureQueueController(threadId)
    const batch = controller.queue.filter((item) => item.status === 'queued')
    if (batch.length === 0) return false
    if (batch.some((item) => (item.images?.length ?? 0) > 0)) {
      controller.dispatchPolicy = 'auto'
      controller.postRunAction = { type: 'auto_flush_head' }
      bumpQueueRevision(controller)
      return await dispatchQueuedHead(threadId)
    }
    const merged = mergeQueuedMessages(batch)
    if (!merged) {
      controller.runtimeState = 'idle'
      bumpQueueRevision(controller)
      return false
    }

    if (controller.runtimeState === 'running') {
      return await submitQueuedMessageToRuntime(threadId, batch, merged, 'steer')
    }

    controller.queue.splice(0, controller.queue.length)
    controller.postRunAction = { type: 'none' }
    controller.runtimeState = 'dispatching'
    return await dispatchMessageNow(threadId, merged, buildUserBlocks(merged, []), {
      queuedBatch: batch
    })
  }

  const requestQueuedItemDispatch = async (threadId: string, itemId: string): Promise<void> => {
    const controller = ensureQueueController(threadId)
    const item = findQueueItem(controller, itemId)
    if (!item) return

    if (controller.runtimeState === 'idle' || controller.runtimeState === 'running') {
      controller.dispatchPolicy = 'auto'
      controller.postRunAction = { type: 'none' }
      bumpQueueRevision(controller)
      void dispatchQueuedItemNow(threadId, itemId)
    } else {
      setQueueAction(controller, { type: 'dispatch_item', itemId }, 'auto')
    }
  }

  const deleteQueuedItem = (threadId: string, itemId: string): void => {
    const controller = ensureQueueController(threadId)
    removeQueueItem(controller, itemId)
    bumpQueueRevision(controller)
  }

  const dispatchActiveQueuedItem = (itemId: string): void => {
    const threadId = options.activeThread.value?.id
    if (threadId) requestQueuedItemDispatch(threadId, itemId)
  }

  const dispatchAllActiveQueuedItems = (): void => {
    const threadId = options.activeThread.value?.id
    if (!threadId) return
    const controller = ensureQueueController(threadId)
    if (controller.queue.length === 0) return

    if (controller.runtimeState === 'idle' || controller.runtimeState === 'running') {
      controller.dispatchPolicy = 'auto'
      controller.postRunAction = { type: 'none' }
      bumpQueueRevision(controller)
      void dispatchQueuedBatchNow(threadId)
      return
    }

    setQueueAction(controller, { type: 'dispatch_queue_batch' }, 'auto')
  }

  const deleteActiveQueuedItem = (itemId: string): void => {
    const threadId = options.activeThread.value?.id
    if (threadId) deleteQueuedItem(threadId, itemId)
  }

  const onRunSettled = async (threadId: string, runId: string, status: string): Promise<void> => {
    const controller = ensureQueueController(threadId)
    if (controller.activeRunId !== null && controller.activeRunId !== runId) {
      if (status !== 'aborted') return
      resetQueueControllerAfterAbort(controller)
      options.setThreadStreaming(threadId, false)
      bumpQueueRevision(controller)
    } else {
      controller.activeRunId = null
      controller.runtimeState = 'idle'
    }
    await syncRuntimeQueue(threadId)

    // Capture the run before loadLatestThreadWindow overwrites it from the DB projection,
    // otherwise triggerKind is lost and we can't skip badge/notification for automation runs.
    const settledRun = options.getAgentRunMap(threadId).get(runId) ?? null

    try {
      await options.loadLatestThreadWindow(threadId, 'merge-latest')
    } catch (error) {
      console.error('Reload latest thread window after run settled failed', error)
    }

    if (status !== 'aborted') {
      // Skip notification and badge for automation (scheduled task) runs — there is no chat UI to display
      if (settledRun?.triggerKind !== 'automation') {
        const preview = getRunFinishedNotificationPreview(settledRun)
        const notificationShownPromise = preview
          ? window.api.runtime
              .notifyRunFinished({
                threadId,
                runId,
                preview
              })
              .then((result) => Boolean(result.notificationShown))
              .catch((error) => {
                console.error('Notify run finished failed', error)
                return false
              })
          : Promise.resolve(false)

        void notificationShownPromise.then((notificationShown) => {
          options.onRunFinishedNotificationState?.({
            threadId,
            runId,
            notificationShown
          })
        })
      }
    }

    bumpQueueRevision(controller)
    void runId

    const action = controller.postRunAction
    controller.postRunAction = { type: 'none' }

    if (status === 'aborted') {
      resetQueueControllerAfterAbort(controller)
      return
    }

    if (action.type === 'auto_flush_head') {
      if (shouldAutoFlushLocalQueue(controller)) {
        void dispatchQueuedHead(threadId)
      }
    } else if (action.type === 'dispatch_item') {
      void dispatchQueuedItemNow(threadId, action.itemId)
    } else if (action.type === 'dispatch_queue_batch') {
      void dispatchQueuedBatchNow(threadId)
    } else if (action.type === 'dispatch_text') {
      void dispatchMessageNow(threadId, action.text)
    } else if (action.type === 'clear_queue') {
      controller.queue.splice(0, controller.queue.length)
    } else if (action.type === 'none' && shouldAutoFlushLocalQueue(controller)) {
      void dispatchQueuedHead(threadId)
    }
  }

  const cancelCurrentProcessing = async (): Promise<void> => {
    const id = options.activeThread.value?.id
    if (!id) return
    const controller = ensureQueueController(id)
    if (!canAbortFromRuntimeState(controller.runtimeState, options.isStreaming.value)) return
    controller.dispatchPolicy = 'paused'
    controller.postRunAction = { type: 'hold' }
    controller.runtimeState = 'aborting'
    bumpQueueRevision(controller)

    const list = options.ensureMessageBuffer(id)
    removeOptimisticAssistantPlaceholders(list)

    try {
      await window.api.runtime.abortThread(id)
    } catch (err) {
      options.runtimeStatus.value = {
        text: err instanceof Error ? `停止失败: ${err.message.slice(0, 120)}` : '停止失败',
        tone: 'error'
      }
    } finally {
      options.setThreadStreaming(id, false)
      resetQueueControllerAfterAbort(controller)
      bumpQueueRevision(controller)
      options.runtimeStatus.value = { text: '', tone: 'idle' }
    }
  }

  return {
    queueControllersByThreadId,
    pendingQueue,
    queueRuntimeState,
    queueDispatchPolicy,
    canAbortCurrentRun,
    ensureQueueController,
    bumpQueueRevision,
    removeQueueItem,
    removeRuntimeQueueItemByText,
    syncRuntimeQueue,
    enqueuePendingMessage,
    dispatchMessageNow,
    dispatchQueuedItemNow,
    dispatchQueuedHead,
    dispatchQueuedBatchNow,
    requestQueuedItemDispatch,
    deleteQueuedItem,
    dispatchActiveQueuedItem,
    dispatchAllActiveQueuedItems,
    deleteActiveQueuedItem,
    onRunSettled,
    cancelCurrentProcessing
  }
}
