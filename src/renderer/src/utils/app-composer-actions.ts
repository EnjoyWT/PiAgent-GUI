import { nextTick, type ComputedRef, type Ref } from 'vue'
import type { TransportSetupQrProjection } from '@shared/agent-runtime'
import type { PendingQuestion, QuestionAnswerPayload } from '@shared/question-tool'
import type {
  PendingQuestionnaire,
  QuestionnaireAnswerPayload,
  QuestionnaireToolAnswer
} from '@shared/questionnaire-tool'
import type { PendingSecretPrompt, SecretAnswerPayload } from '@shared/secret-input'
import type {
  AgentRun,
  ChatContentBlock,
  ChatImageBlock,
  ChatMessage,
  ChatMessageContent
} from '../components/chat/types'
import type { ThreadRow } from '../../../preload/db-types'
import { globalDialog } from './dialog'
import { shouldQueueComposerSend } from './app-queue-state'
import {
  buildMessageContentJson,
  buildUserBlocks,
  clearRetryCandidate,
  getMessageImageBlocks,
  isAgentContextUserMessage,
  toPlainContentJson
} from './app-chat-helpers'
import {
  createSubmissionId,
  submitLocalMessageToGateway,
  type ThreadQueueController
} from './app-queue-dispatcher'

export type EditingMessageState = {
  id?: string
  index: number
  images: ChatImageBlock[]
} | null

type RuntimeStatus = {
  text: string
  tone: 'idle' | 'ok' | 'error'
}

type RuntimeBinding = {
  chatThreadId: string
} | null

type ComposerHost = {
  focusComposerToEnd?: () => void | Promise<void>
}

type SendTextOptions = {
  clearInput?: boolean
  clearAttachments?: boolean
  blocks?: ChatContentBlock[]
  contentJson?: ChatMessageContent | null
}

type ComposerActionsOptions = {
  activeThread: Ref<ThreadRow | null>
  messages: Ref<ChatMessage[]>
  inputText: Ref<string>
  composerAttachments: Ref<File[]>
  editingMessage: Ref<EditingMessageState>
  rightAreaRef: Ref<ComposerHost | null>
  currentModelSupportsImageInput: ComputedRef<boolean> | Ref<boolean>
  isStreaming: ComputedRef<boolean> | Ref<boolean>
  runtimeStatus: Ref<RuntimeStatus>
  runtimeBinding: Ref<RuntimeBinding>
  activeRunByThreadId: Map<string, AgentRun>
  getPendingQuestion: (threadId?: string | null) => PendingQuestion | null
  getPendingQuestionnaire: (threadId?: string | null) => PendingQuestionnaire | null
  getPendingSecret: (threadId?: string | null) => PendingSecretPrompt | null
  clearPendingQuestionForThread: (threadId: string, toolCallId?: string) => void
  clearPendingSecretForThread: (threadId: string, requestId?: string) => void
  getActiveRun: (threadId: string) => AgentRun | null
  ensureQueueController: (threadId: string) => ThreadQueueController
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
      promptOptions?: {
        streamingBehavior?: 'steer' | 'followUp'
        images?: ChatImageBlock[]
        submissionId?: string
      }
      contentJson?: ChatMessageContent | null
    }
  ) => Promise<boolean>
  ensureAssistantRunMessage: (run: AgentRun | null, allowCreate?: boolean) => ChatMessage | null
  setThreadStreaming: (threadId: string, value: boolean) => void
  scrollToBottom: (options?: { force?: boolean }) => void | Promise<void>
  loadLatestThreadWindow: (threadId: string, mode?: 'replace' | 'merge-latest') => Promise<void>
  loadThreadPlanState: (threadId: string) => Promise<void>
  recordChatInputHistory: (threadId: string | null | undefined, text: string) => void
}

type ComposerActionsState = {
  sendText: (
    text: string,
    images?: ChatImageBlock[],
    sendOptions?: SendTextOptions
  ) => Promise<void>
  sendWidgetMessage: (text: string) => Promise<void>
  regenerateTransportSetupQr: (qr: TransportSetupQrProjection) => Promise<void>
  answerQuestionWithOption: (optionId: string) => Promise<void>
  answerQuestionnaireWithOption: (optionId: string) => Promise<void>
  submitSecretValue: (value: string) => Promise<void>
  sendMessage: () => Promise<void>
  deleteUserMessage: (payload: { id?: string; index: number }) => Promise<void>
  startEditUserMessage: (payload: { id?: string; index: number; content: string }) => Promise<void>
  cancelEditUserMessage: () => void
  regenerateFromUserMessage: (payload: {
    id?: string
    index: number
    content: string
  }) => Promise<void>
  onDropImages: (files: File[]) => void
}

export const confirmTextOnlyFallback = async (
  text: string,
  imagesCount: number
): Promise<boolean> => {
  if (!imagesCount) return true
  if (!text.trim()) {
    await globalDialog.alert({
      title: '当前模型不支持图片',
      message: '这次输入只有图片，无法仅发送文字。请切换到支持图片的模型，或先移除图片。'
    })
    return false
  }
  return await globalDialog.confirm({
    title: '当前模型不支持图片',
    message: `当前模型不支持图片输入。是否忽略 ${imagesCount} 张图片，仅发送文字？`,
    confirmText: '仅发送文字',
    cancelText: '取消'
  })
}

const getFilePath = (file: File): string | undefined => {
  const path = (file as File & { path?: unknown }).path
  return typeof path === 'string' && path.trim() ? path : undefined
}

const filesToImageBlocks = async (files: File[]): Promise<ChatImageBlock[]> => {
  const inputs = await Promise.all(
    files
      .filter((file) => file.type.startsWith('image/'))
      .map(async (file) => {
        const filePath = getFilePath(file)
        return {
          mimeType: file.type,
          name: file.name || undefined,
          ...(filePath ? { filePath } : { data: await file.arrayBuffer() })
        }
      })
  )
  return inputs.length > 0 ? await window.api.chatAssets.persistImages(inputs) : []
}

const resolveOutgoingPayload = async (
  text: string,
  files: File[],
  supportsImageInput: boolean
): Promise<{
  text: string
  images: ChatImageBlock[]
  blocks: ChatContentBlock[]
  contentJson: ChatMessageContent | null
  clearAttachmentsOnSuccess: boolean
} | null> => {
  const normalizedText = (text ?? '').replace(/\r\n/g, '\n').trim()
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))
  if (!normalizedText && imageFiles.length === 0) return null

  if (imageFiles.length === 0) {
    const blocks = buildUserBlocks(normalizedText, [])
    return {
      text: normalizedText,
      images: [],
      blocks,
      contentJson: buildMessageContentJson(blocks),
      clearAttachmentsOnSuccess: true
    }
  }

  if (!supportsImageInput) {
    const confirmed = await confirmTextOnlyFallback(normalizedText, imageFiles.length)
    if (!confirmed) return null
    const blocks = buildUserBlocks(normalizedText, [])
    return {
      text: normalizedText,
      images: [],
      blocks,
      contentJson: buildMessageContentJson(blocks),
      clearAttachmentsOnSuccess: false
    }
  }

  const images = await filesToImageBlocks(imageFiles)
  const blocks = buildUserBlocks(normalizedText, images)
  return {
    text: normalizedText,
    images,
    blocks,
    contentJson: buildMessageContentJson(blocks),
    clearAttachmentsOnSuccess: true
  }
}

const buildQuestionnaireAnswerFromPayload = (
  pending: PendingQuestionnaire,
  payload: QuestionnaireAnswerPayload
): QuestionnaireToolAnswer | null => {
  const question = pending.questionnaire.questions[pending.currentStepIndex]
  if (!question) return null

  if (payload.inputKind === 'option') {
    const option = question.options?.find((item) => item.id === payload.optionId)
    if (!option) return null
    return {
      stepIndex: pending.currentStepIndex,
      questionId: question.questionId,
      inputKind: 'option',
      optionId: option.id,
      label: option.label,
      value: option.value ?? option.label,
      rawInput: option.value ?? option.label
    }
  }

  const rawInput = payload.rawInput.replace(/\r\n/g, '\n').trim()
  if (!rawInput) return null
  return {
    stepIndex: pending.currentStepIndex,
    questionId: question.questionId,
    inputKind: 'text',
    rawInput
  }
}

const buildMergedQuestionnaireAnswerText = (
  questionnaire: PendingQuestionnaire['questionnaire'],
  answers: QuestionnaireToolAnswer[]
): string => {
  return answers
    .map((answer) => {
      const question = questionnaire.questions[answer.stepIndex]
      const title =
        question?.title?.trim() || question?.prompt?.trim() || `第${answer.stepIndex + 1}步`
      const value = answer.inputKind === 'option' ? answer.label : answer.rawInput
      return `${answer.stepIndex + 1}. ${title}：${value}`
    })
    .filter(Boolean)
    .join('\n')
}

export const useComposerActions = (options: ComposerActionsOptions): ComposerActionsState => {
  const appendQuestionAnswerEcho = async (
    threadId: string,
    text: string,
    answerOptions?: {
      toolCallId?: string
      agentRunId?: string | null
    }
  ): Promise<ChatMessage | null> => {
    const normalized = (text ?? '').replace(/\r\n/g, '\n').trim()
    if (!normalized) return null

    const blocks = buildUserBlocks(normalized, [])
    const message: ChatMessage = {
      role: 'user',
      messageKind: 'question_answer',
      includeInAgentContext: false,
      content: normalized,
      blocks,
      agentRunId: answerOptions?.agentRunId ?? undefined
    }

    try {
      const row = await window.api.coreV2.localMessages.add(
        threadId,
        'user',
        normalized,
        answerOptions?.agentRunId ?? null,
        buildMessageContentJson(blocks),
        {
          messageKind: 'question_answer',
          includeInAgentContext: false,
          toolCallId: answerOptions?.toolCallId
        }
      )
      message.id = row.id
      message.createdAt = row.created_at
    } catch (error) {
      console.error('Persist question answer echo failed', error)
    }

    return message
  }

  const answerPendingQuestion = async (
    threadId: string,
    payload: QuestionAnswerPayload,
    answerOptions?: { clearInput?: boolean; clearAttachments?: boolean }
  ): Promise<boolean> => {
    const pending = options.getPendingQuestion(threadId)
    if (!pending) return false

    const answerEchoText =
      payload.inputKind === 'option'
        ? (pending.question.options?.find((item) => item.id === payload.optionId)?.label?.trim() ??
          '')
        : payload.rawInput.replace(/\r\n/g, '\n').trim()

    try {
      const result = await window.api.gateway.answerQuestion(threadId, payload)
      if (!result.success) {
        options.runtimeStatus.value = {
          text: `回答失败: ${result.error.slice(0, 120)}`,
          tone: 'error'
        }
        return false
      }

      options.clearPendingQuestionForThread(threadId, pending.toolCallId)
      await appendQuestionAnswerEcho(threadId, answerEchoText, {
        toolCallId: pending.toolCallId,
        agentRunId: options.getActiveRun(threadId)?.id ?? null
      })
      await options.loadLatestThreadWindow(threadId, 'merge-latest')
      if (options.activeThread.value?.id === threadId) void options.scrollToBottom({ force: true })
      if (answerOptions?.clearInput) options.inputText.value = ''
      if (answerOptions?.clearAttachments) options.composerAttachments.value = []
      return true
    } catch (error) {
      options.runtimeStatus.value = {
        text: error instanceof Error ? `回答失败: ${error.message.slice(0, 120)}` : '回答失败',
        tone: 'error'
      }
      return false
    }
  }

  const answerPendingQuestionnaire = async (
    threadId: string,
    payload: QuestionnaireAnswerPayload,
    answerOptions?: { clearInput?: boolean; clearAttachments?: boolean }
  ): Promise<boolean> => {
    const pending = options.getPendingQuestionnaire(threadId)
    if (!pending) return false
    const answer = buildQuestionnaireAnswerFromPayload(pending, payload)
    const isLastStep = pending.currentStepIndex >= pending.questionnaire.questions.length - 1

    try {
      const result = await window.api.gateway.answerQuestionnaire(threadId, payload)
      if (!result.success) {
        options.runtimeStatus.value = {
          text: `回答失败: ${result.error.slice(0, 120)}`,
          tone: 'error'
        }
        return false
      }

      if (isLastStep && answer) {
        const mergedAnswerText = buildMergedQuestionnaireAnswerText(pending.questionnaire, [
          ...pending.answers,
          answer
        ])
        if (mergedAnswerText.trim()) {
          try {
            await window.api.coreV2.localMessages.add(
              threadId,
              'user',
              mergedAnswerText,
              null,
              undefined,
              {
                messageKind: 'questionnaire_answer',
                includeInAgentContext: false,
                toolCallId: pending.toolCallId,
                stepIndex: pending.currentStepIndex
              }
            )
          } catch (error) {
            console.error('Persist questionnaire answer failed', error)
          }
        }
      }

      await options.loadLatestThreadWindow(threadId, 'merge-latest')
      if (options.activeThread.value?.id === threadId) void options.scrollToBottom({ force: true })
      if (answerOptions?.clearInput) options.inputText.value = ''
      if (answerOptions?.clearAttachments) options.composerAttachments.value = []
      return true
    } catch (error) {
      options.runtimeStatus.value = {
        text: error instanceof Error ? `回答失败: ${error.message.slice(0, 120)}` : '回答失败',
        tone: 'error'
      }
      return false
    }
  }

  const answerPendingSecret = async (
    threadId: string,
    payload: SecretAnswerPayload
  ): Promise<boolean> => {
    const pending = options.getPendingSecret(threadId)
    if (!pending) return false

    try {
      const result = await window.api.gateway.answerSecret(threadId, payload)
      if (!result.success) {
        options.runtimeStatus.value = {
          text: `提交失败: ${result.error.slice(0, 120)}`,
          tone: 'error'
        }
        return false
      }

      options.clearPendingSecretForThread(threadId, pending.requestId)
      options.runtimeStatus.value = {
        text: '安全输入已提交。',
        tone: 'ok'
      }
      return true
    } catch (error) {
      options.runtimeStatus.value = {
        text: error instanceof Error ? `提交失败: ${error.message.slice(0, 120)}` : '提交失败',
        tone: 'error'
      }
      return false
    }
  }

  const sendText = async (
    text: string,
    images: ChatImageBlock[] = [],
    sendOptions?: SendTextOptions
  ): Promise<void> => {
    if ((!text.trim() && images.length === 0) || !options.activeThread.value) return
    const thread = options.activeThread.value
    const pendingSecret = options.getPendingSecret(thread.id)
    const pendingQuestion = options.getPendingQuestion(thread.id)
    const pendingQuestionnaire = options.getPendingQuestionnaire(thread.id)

    if (pendingSecret) {
      options.runtimeStatus.value = {
        text: '当前正在等待安全输入，请使用上方安全输入框提交。',
        tone: 'error'
      }
      return
    }

    if (pendingQuestion) {
      const rawInput = text.replace(/\r\n/g, '\n').trim()
      if (!rawInput) return
      options.recordChatInputHistory(thread.id, rawInput)
      await answerPendingQuestion(
        thread.id,
        {
          questionId: pendingQuestion.question.questionId,
          inputKind: 'text',
          rawInput
        },
        {
          clearInput: sendOptions?.clearInput,
          clearAttachments: sendOptions?.clearAttachments
        }
      )
      return
    }

    if (pendingQuestionnaire) {
      const currentQuestion =
        pendingQuestionnaire.questionnaire.questions[pendingQuestionnaire.currentStepIndex] ?? null
      if (!currentQuestion) return
      const rawInput = text.replace(/\r\n/g, '\n').trim()
      if (!rawInput) return
      options.recordChatInputHistory(thread.id, rawInput)
      await answerPendingQuestionnaire(
        thread.id,
        {
          questionnaireId: pendingQuestionnaire.questionnaire.questionnaireId,
          stepIndex: pendingQuestionnaire.currentStepIndex,
          questionId: currentQuestion.questionId,
          inputKind: 'text',
          rawInput
        },
        {
          clearInput: sendOptions?.clearInput,
          clearAttachments: sendOptions?.clearAttachments
        }
      )
      return
    }

    const controller = options.ensureQueueController(thread.id)
    options.recordChatInputHistory(thread.id, text)
    if (sendOptions?.clearInput) options.inputText.value = ''
    if (sendOptions?.clearAttachments) options.composerAttachments.value = []

    const blocks = sendOptions?.blocks ?? buildUserBlocks(text, images)

    if (controller.runtimeState === 'aborting') {
      return
    }

    if (shouldQueueComposerSend(controller.runtimeState, options.isStreaming.value)) {
      options.enqueuePendingMessage(thread.id, text, blocks, images)
      return
    }

    await options.dispatchMessageNow(thread.id, text, blocks, {
      clearAttachments: sendOptions?.clearAttachments,
      contentJson: sendOptions?.contentJson ?? buildMessageContentJson(blocks),
      promptOptions: images.length > 0 ? { images } : undefined
    })
  }

  const sendWidgetMessage = async (text: string): Promise<void> => {
    const normalized = (text ?? '').replace(/\r\n/g, '\n').trim()
    if (!normalized) return
    console.warn('[widgetRenderer] Blocked widget message handoff to chat:', normalized)
  }

  const regenerateTransportSetupQr = async (qr: TransportSetupQrProjection): Promise<void> => {
    const transportLabel = qr.transportId === 'wechat' ? '微信' : qr.transportId
    const text = [
      `重新生成${transportLabel}登录二维码。`,
      `transportId=${qr.transportId}`,
      `accountId=${qr.accountId}`,
      `setupMethodId=${qr.methodId}`
    ].join(' ')
    await sendText(text)
  }

  const answerQuestionWithOption = async (optionId: string): Promise<void> => {
    const threadId = options.activeThread.value?.id
    const pending = options.getPendingQuestion(threadId)
    if (!threadId || !pending) return

    await answerPendingQuestion(threadId, {
      questionId: pending.question.questionId,
      inputKind: 'option',
      optionId
    })
  }

  const answerQuestionnaireWithOption = async (optionId: string): Promise<void> => {
    const threadId = options.activeThread.value?.id
    const pending = options.getPendingQuestionnaire(threadId)
    if (!threadId || !pending) return

    const currentQuestion = pending.questionnaire.questions[pending.currentStepIndex] ?? null
    if (!currentQuestion) return

    await answerPendingQuestionnaire(threadId, {
      questionnaireId: pending.questionnaire.questionnaireId,
      stepIndex: pending.currentStepIndex,
      questionId: currentQuestion.questionId,
      inputKind: 'option',
      optionId
    })
  }

  const submitSecretValue = async (value: string): Promise<void> => {
    const threadId = options.activeThread.value?.id
    const pending = options.getPendingSecret(threadId)
    if (!threadId || !pending) return

    await answerPendingSecret(threadId, {
      secretId: pending.secret.secretId,
      value
    })
  }

  const deleteMessagesAfterIndex = async (index: number): Promise<void> => {
    if (index < 0) return
    const anchor = options.messages.value[index] ?? null
    const removed = options.messages.value.splice(index + 1)
    const deleteIds = removed.map((m) => m.id).filter((id): id is string => Boolean(id))
    for (const id of deleteIds) {
      try {
        await window.api.coreV2.localMessages.delete(id)
      } catch (err) {
        console.error('Delete message failed', err)
      }
    }
    if (options.activeThread.value?.id && anchor?.createdAt) {
      try {
        await window.api.coreV2.localThreads.pruneRuntimeAfter(
          options.activeThread.value.id,
          anchor.createdAt
        )
        await window.api.gateway.resetLocalConversation(options.activeThread.value.id)
        await options.loadThreadPlanState(options.activeThread.value.id)
      } catch (err) {
        console.error('Prune runtime history failed', err)
      }
    }
  }

  const navigateAgentToUserMessageIndex = async (messageIndex: number): Promise<void> => {
    if (!options.activeThread.value) throw new Error('No active thread')
    const msg = options.messages.value[messageIndex]
    if (!isAgentContextUserMessage(msg)) throw new Error('Not an agent-context user message')
    if (!msg.id) throw new Error('无法定位到对应的历史消息（message id 缺失）')
  }

  const cancelEditUserMessage = (): void => {
    if (!options.editingMessage.value) return
    options.inputText.value = ''
    options.editingMessage.value = null
  }

  const appendAssistantFailure = async (
    threadId: string,
    msgText: string,
    pending: ChatMessage | null
  ): Promise<void> => {
    if (pending?.isPending) {
      pending.isPending = false
      pending.run = undefined
      pending.agentRunId = undefined
      pending.content = `请求失败：${msgText}`
    } else {
      options.messages.value.push({ role: 'assistant', content: `请求失败：${msgText}` })
    }
    await window.api.coreV2.localMessages.add(threadId, 'assistant', `请求失败：${msgText}`)
  }

  const sendEditedMessage = async (
    outgoing: Awaited<ReturnType<typeof resolveOutgoingPayload>>
  ): Promise<boolean> => {
    if (!outgoing || options.isStreaming.value || !options.activeThread.value) return false
    const ctx = options.editingMessage.value
    if (!ctx) return false
    const threadId = options.activeThread.value.id
    const controller = options.ensureQueueController(threadId)
    const edited = (outgoing.text ?? '').replace(/\r\n/g, '\n').trim()
    let editedImages = [...ctx.images, ...outgoing.images]
    if (editedImages.length > 0 && !options.currentModelSupportsImageInput.value) {
      const confirmed = await confirmTextOnlyFallback(edited, editedImages.length)
      if (!confirmed) return true
      editedImages = []
    }
    if (!edited && editedImages.length === 0) return true
    options.recordChatInputHistory(threadId, edited)
    const targetIndex =
      ctx.id != null ? options.messages.value.findIndex((m) => m.id === ctx.id) : ctx.index
    const msg = targetIndex >= 0 ? options.messages.value[targetIndex] : null
    if (!isAgentContextUserMessage(msg)) return true

    msg.content = edited
    msg.blocks = buildUserBlocks(edited, editedImages)
    if (ctx.id) {
      try {
        await window.api.coreV2.localMessages.update(
          ctx.id,
          edited,
          toPlainContentJson(buildMessageContentJson(msg.blocks))
        )
      } catch (err) {
        console.error('Update message failed', err)
      }
    }

    options.editingMessage.value = null
    options.inputText.value = ''
    if (outgoing.clearAttachmentsOnSuccess) options.composerAttachments.value = []

    try {
      await deleteMessagesAfterIndex(targetIndex)
      await navigateAgentToUserMessageIndex(targetIndex)
      msg.retryCandidate = true
      msg.agentRunId = undefined
      msg.runtimeSequence = null
      msg.submissionId = createSubmissionId()
      if (msg.id) await window.api.coreV2.localMessages.prepareForRetry(msg.id)
      if (msg.id) {
        await window.api.coreV2.localMessages.updateRuntimeLink(msg.id, {
          submissionId: msg.submissionId
        })
      }

      const pending = options.ensureAssistantRunMessage(null, true)
      if (pending) {
        pending.content = '思考中...'
        pending.isPending = true
        pending.run = undefined
        pending.agentRunId = undefined
      }
      controller.runtimeState = 'dispatching'
      controller.activeRunId = null
      options.setThreadStreaming(threadId, true)
      void options.scrollToBottom({ force: true })

      await submitLocalMessageToGateway({
        threadId,
        text: edited,
        messageId: msg.id ?? null,
        images: editedImages,
        submissionId: msg.submissionId
      })
      await options.loadLatestThreadWindow(threadId, 'merge-latest')
    } catch (err) {
      clearRetryCandidate(msg)
      options.runtimeBinding.value = null
      options.setThreadStreaming(threadId, false)
      options.activeRunByThreadId.delete(threadId)
      controller.activeRunId = null
      controller.runtimeState = 'idle'
      const msgText = err instanceof Error ? err.message : String(err)
      options.runtimeStatus.value = {
        text: `重新生成失败: ${msgText.slice(0, 120)}`,
        tone: 'error'
      }
      await appendAssistantFailure(
        threadId,
        msgText,
        options.ensureAssistantRunMessage(null, false)
      )
    }
    return true
  }

  const sendMessage = async (): Promise<void> => {
    const normalizeOutgoingText = (text: string): string =>
      (text ?? '').replace(/\r\n/g, '\n').trim()
    const activePendingQuestion = options.activeThread.value
      ? options.getPendingQuestion(options.activeThread.value.id)
      : null
    if (activePendingQuestion) {
      const rawText = normalizeOutgoingText(options.inputText.value)
      if (!rawText) return
      await sendText(rawText, [], {
        clearInput: true,
        clearAttachments: true
      })
      return
    }
    const activePendingQuestionnaire = options.activeThread.value
      ? options.getPendingQuestionnaire(options.activeThread.value.id)
      : null
    if (activePendingQuestionnaire) {
      const rawText = normalizeOutgoingText(options.inputText.value)
      if (!rawText) return
      await sendText(rawText, [], {
        clearInput: true,
        clearAttachments: true
      })
      return
    }

    const outgoing = await resolveOutgoingPayload(
      options.inputText.value,
      options.composerAttachments.value,
      options.currentModelSupportsImageInput.value
    )
    if (!outgoing) return

    if (options.editingMessage.value) {
      await sendEditedMessage(outgoing)
      return
    }

    await sendText(outgoing.text, outgoing.images, {
      clearInput: true,
      clearAttachments: outgoing.clearAttachmentsOnSuccess,
      blocks: outgoing.blocks,
      contentJson: outgoing.contentJson
    })
  }

  const deleteUserMessage = async (payload: { id?: string; index: number }): Promise<void> => {
    const msg = options.messages.value[payload.index]
    if (!msg || msg.role !== 'user') return
    if (
      options.editingMessage.value &&
      ((payload.id && options.editingMessage.value.id === payload.id) ||
        options.editingMessage.value.index === payload.index)
    ) {
      cancelEditUserMessage()
    }
    options.messages.value.splice(payload.index, 1)
    if (!payload.id) return
    try {
      await window.api.coreV2.localMessages.delete(payload.id)
    } catch (err) {
      console.error('Delete message failed', err)
    }
  }

  const startEditUserMessage = async (payload: {
    id?: string
    index: number
    content: string
  }): Promise<void> => {
    const msg = options.messages.value[payload.index]
    options.editingMessage.value = {
      id: payload.id,
      index: payload.index,
      images: isAgentContextUserMessage(msg) ? getMessageImageBlocks(msg) : []
    }
    options.composerAttachments.value = []
    options.inputText.value = (payload.content ?? '').replace(/[\r\n]+$/g, '')
    await nextTick()
    await options.rightAreaRef.value?.focusComposerToEnd?.()
  }

  const regenerateFromUserMessage = async (payload: {
    id?: string
    index: number
    content: string
  }): Promise<void> => {
    if (options.isStreaming.value || !options.activeThread.value) return
    const threadId = options.activeThread.value.id
    const controller = options.ensureQueueController(threadId)
    const msg = options.messages.value[payload.index]
    if (!isAgentContextUserMessage(msg)) return
    const images = getMessageImageBlocks(msg)

    if (images.length > 0 && !options.currentModelSupportsImageInput.value) {
      const confirmed = await confirmTextOnlyFallback(msg.content, images.length)
      if (!confirmed) return
    }

    cancelEditUserMessage()

    try {
      await deleteMessagesAfterIndex(payload.index)
      await navigateAgentToUserMessageIndex(payload.index)
      msg.retryCandidate = true
      msg.agentRunId = undefined
      msg.runtimeSequence = null
      msg.submissionId = createSubmissionId()
      if (msg.id) await window.api.coreV2.localMessages.prepareForRetry(msg.id)
      if (msg.id) {
        await window.api.coreV2.localMessages.updateRuntimeLink(msg.id, {
          submissionId: msg.submissionId
        })
      }

      const pending = options.ensureAssistantRunMessage(null, true)
      if (pending) {
        pending.content = '思考中...'
        pending.isPending = true
        pending.run = undefined
        pending.agentRunId = undefined
      }
      controller.runtimeState = 'dispatching'
      controller.activeRunId = null
      options.setThreadStreaming(threadId, true)
      void options.scrollToBottom({ force: true })

      await submitLocalMessageToGateway({
        threadId,
        text: payload.content,
        messageId: msg.id ?? null,
        images: options.currentModelSupportsImageInput.value ? images : [],
        submissionId: msg.submissionId
      })
      await options.loadLatestThreadWindow(threadId, 'merge-latest')
    } catch (err) {
      clearRetryCandidate(msg)
      options.runtimeBinding.value = null
      options.setThreadStreaming(threadId, false)
      options.activeRunByThreadId.delete(threadId)
      controller.activeRunId = null
      controller.runtimeState = 'idle'
      const msgText = err instanceof Error ? err.message : String(err)
      options.runtimeStatus.value = {
        text: `重新生成失败: ${msgText.slice(0, 120)}`,
        tone: 'error'
      }
      await appendAssistantFailure(
        threadId,
        msgText,
        options.ensureAssistantRunMessage(null, false)
      )
    }
  }

  const onDropImages = (files: File[]): void => {
    void files
  }

  return {
    sendText,
    sendWidgetMessage,
    regenerateTransportSetupQr,
    answerQuestionWithOption,
    answerQuestionnaireWithOption,
    submitSecretValue,
    sendMessage,
    deleteUserMessage,
    startEditUserMessage,
    cancelEditUserMessage,
    regenerateFromUserMessage,
    onDropImages
  }
}
