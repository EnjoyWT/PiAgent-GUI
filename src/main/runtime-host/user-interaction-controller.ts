import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import type { CoreCommandService, InteractionCheckpoint } from '../core-v2/domain.ts'
import { createQuestionTool } from '../tools/question-tool.ts'
import { createQuestionnaireTool } from '../tools/questionnaire-tool.ts'
import { createSecretRequestTool } from '../tools/secret-request-tool.ts'
import { executeQuestionnaireFlow } from '../tools/questionnaire-tool.ts'
import type {
  PendingQuestion,
  PendingQuestionEvent,
  QuestionAnswerPayload,
  QuestionToolAbortReason,
  QuestionToolResult
} from '../../shared/question-tool.ts'
import type {
  PendingQuestionnaire,
  PendingQuestionnaireEvent,
  QuestionnaireAnswerPayload,
  QuestionnaireToolAnswer,
  QuestionnaireToolParams,
  QuestionnaireToolResult
} from '../../shared/questionnaire-tool.ts'
import { SECRET_ANSWER_API_PATH } from '../../shared/secret-input.ts'
import type {
  PendingSecretPrompt,
  PendingSecretPromptEvent,
  SecretAnswerPayload,
  SecretPromptParams,
  SecretPromptResult
} from '../../shared/secret-input.ts'

type PendingQuestionState = {
  pending: PendingQuestion
  resolve: (result: QuestionToolResult) => void
  settled: boolean
  abortCleanup?: () => void
  interactionId?: string | null
}

type PendingQuestionnaireState = {
  pending: PendingQuestionnaire
  resolve: (result: QuestionnaireAnswerPayload | null) => void
  settled: boolean
  abortCleanup?: () => void
  interactionId?: string | null
}

type PendingSecretState = {
  pending: PendingSecretPrompt
  resolve: (result: SecretPromptResult) => void
  settled: boolean
  abortCleanup?: () => void
  interactionId?: string | null
}

export type RuntimeInteractionAnswerResult = { success: true } | { success: false; error: string }

export type RuntimeUserInteractionToolContext = {
  conversationId: string
  interactionThreadId: string
  getActiveRunId?: () => string | null
}

export type RuntimeFormField = {
  key: string
  label: string
  type: 'text' | 'select' | 'boolean' | 'number'
  required?: boolean
  description?: string
  placeholder?: string
  options?: Array<{
    id: string
    label: string
    value?: string
    description?: string
  }>
  defaultValue?: string | number | boolean | null
  currentValue?: string | number | boolean | null
}

export type RuntimeFormRequest = {
  formId: string
  title: string
  description?: string
  fields: RuntimeFormField[]
}

export type RuntimeFormResult =
  | {
      status: 'completed'
      formId: string
      values: Record<string, string | number | boolean | null>
      answers: QuestionnaireToolAnswer[]
    }
  | {
      status: 'aborted'
      formId: string
      reason: QuestionToolAbortReason
      values: Record<string, string | number | boolean | null>
      answers: QuestionnaireToolAnswer[]
    }

export type RuntimeUserInteractionControllerDeps = {
  core: Pick<CoreCommandService, 'requestInteraction' | 'answerInteraction' | 'cancelInteraction'>
  emitQuestionEvent?: (event: PendingQuestionEvent) => void
  emitQuestionnaireEvent?: (event: PendingQuestionnaireEvent) => void
  emitSecretEvent?: (event: PendingSecretPromptEvent) => void
}

export class RuntimeUserInteractionController {
  private readonly core: RuntimeUserInteractionControllerDeps['core']
  private readonly emitQuestionEvent?: NonNullable<
    RuntimeUserInteractionControllerDeps['emitQuestionEvent']
  >
  private readonly emitQuestionnaireEvent?: NonNullable<
    RuntimeUserInteractionControllerDeps['emitQuestionnaireEvent']
  >
  private readonly emitSecretEvent?: NonNullable<
    RuntimeUserInteractionControllerDeps['emitSecretEvent']
  >
  private readonly pendingQuestionsByThreadId = new Map<string, PendingQuestionState>()
  private readonly pendingQuestionnairesByThreadId = new Map<string, PendingQuestionnaireState>()
  private readonly pendingSecretsByThreadId = new Map<string, PendingSecretState>()

  constructor(deps: RuntimeUserInteractionControllerDeps) {
    this.core = deps.core
    this.emitQuestionEvent = deps.emitQuestionEvent
    this.emitQuestionnaireEvent = deps.emitQuestionnaireEvent
    this.emitSecretEvent = deps.emitSecretEvent
  }

  createTools(context: RuntimeUserInteractionToolContext): ToolDefinition[] {
    const interactionThreadId = context.interactionThreadId
    return [
      createQuestionTool({
        threadId: interactionThreadId,
        setPendingQuestion: (pending) => this.setPendingQuestion(context, pending),
        clearPendingQuestion: (threadId, toolCallId) =>
          this.clearPendingQuestion(threadId, toolCallId),
        awaitAnswer: (pending, signal) => this.awaitQuestionAnswer(pending, signal)
      }),
      createQuestionnaireTool({
        threadId: interactionThreadId,
        setPendingQuestionnaire: (pending) => this.setPendingQuestionnaire(context, pending),
        clearPendingQuestionnaire: (threadId, toolCallId) =>
          this.clearPendingQuestionnaire(threadId, toolCallId),
        awaitStepAnswer: (pending, signal) => this.awaitQuestionnaireStepAnswer(pending, signal)
      }),
      createSecretRequestTool({
        interactionController: this,
        context
      })
    ]
  }

  async answerQuestion(
    threadId: string,
    payload: QuestionAnswerPayload
  ): Promise<RuntimeInteractionAnswerResult> {
    const key = this.normalizeThreadId(threadId)
    const existing = this.pendingQuestionsByThreadId.get(key)
    if (!existing) return { success: false, error: 'No pending question for thread' }

    const { pending } = existing
    if (payload.questionId !== pending.question.questionId) {
      return { success: false, error: 'Question id mismatch' }
    }

    if (payload.inputKind === 'option') {
      const option = pending.question.options?.find((item) => item.id === payload.optionId)
      if (!option) return { success: false, error: 'Question option not found' }

      const result: QuestionToolResult = {
        status: 'answered',
        inputKind: 'option',
        questionId: pending.question.questionId,
        optionId: option.id,
        label: option.label,
        value: option.value ?? option.label,
        rawInput: option.value ?? option.label
      }
      this.markInteractionAnswered(existing)
      this.settlePendingQuestion(key, result)
      return { success: true }
    }

    const rawInput = payload.rawInput.replace(/\r\n/g, '\n').trim()
    if (!rawInput) return { success: false, error: 'Question answer cannot be empty' }

    const result: QuestionToolResult = {
      status: 'answered',
      inputKind: 'text',
      questionId: pending.question.questionId,
      rawInput
    }
    this.markInteractionAnswered(existing)
    this.settlePendingQuestion(key, result)
    return { success: true }
  }

  async answerQuestionnaire(
    threadId: string,
    payload: QuestionnaireAnswerPayload
  ): Promise<RuntimeInteractionAnswerResult> {
    const key = this.normalizeThreadId(threadId)
    const existing = this.pendingQuestionnairesByThreadId.get(key)
    if (!existing) return { success: false, error: 'No pending questionnaire for thread' }

    const { pending } = existing
    const question = pending.questionnaire.questions[pending.currentStepIndex]
    if (!question) return { success: false, error: 'Questionnaire step not found' }
    if (payload.questionnaireId !== pending.questionnaire.questionnaireId) {
      return { success: false, error: 'Questionnaire id mismatch' }
    }
    if (payload.stepIndex !== pending.currentStepIndex) {
      return { success: false, error: 'Questionnaire step mismatch' }
    }
    if (payload.questionId !== question.questionId) {
      return { success: false, error: 'Question id mismatch' }
    }

    if (payload.inputKind === 'option') {
      const option = question.options?.find((item) => item.id === payload.optionId)
      if (!option) return { success: false, error: 'Questionnaire option not found' }
      this.markInteractionAnswered(existing)
      this.settlePendingQuestionnaire(key, payload)
      return { success: true }
    }

    const rawInput = payload.rawInput.replace(/\r\n/g, '\n').trim()
    if (!rawInput) return { success: false, error: 'Questionnaire answer cannot be empty' }

    const normalizedPayload: QuestionnaireAnswerPayload = {
      ...payload,
      rawInput
    }
    this.markInteractionAnswered(existing)
    this.settlePendingQuestionnaire(key, normalizedPayload)
    return { success: true }
  }

  async answerSecret(
    threadId: string,
    payload: SecretAnswerPayload
  ): Promise<RuntimeInteractionAnswerResult> {
    const key = this.normalizeThreadId(threadId)
    const existing = this.pendingSecretsByThreadId.get(key)
    if (!existing) return { success: false, error: 'No pending secret prompt for thread' }
    if (payload.secretId !== existing.pending.secret.secretId) {
      return { success: false, error: 'Secret id mismatch' }
    }

    const value = String(payload.value ?? '').trim()
    if (!value) return { success: false, error: 'Secret value cannot be empty' }

    this.markInteractionAnswered(existing)
    this.settlePendingSecret(key, {
      status: 'answered',
      secretId: existing.pending.secret.secretId,
      value
    })
    return { success: true }
  }

  async requestSecretInput(
    context: RuntimeUserInteractionToolContext,
    secret: SecretPromptParams,
    signal?: AbortSignal
  ): Promise<SecretPromptResult> {
    const normalizedSecretId =
      String(secret.secretId ?? '').trim() || `secret-${crypto.randomUUID()}`
    const pending: PendingSecretPrompt = {
      threadId: this.normalizeThreadId(context.interactionThreadId),
      requestId: crypto.randomUUID(),
      secret: {
        ...secret,
        apiPath: secret.apiPath ?? SECRET_ANSWER_API_PATH,
        secretId: normalizedSecretId,
        prompt: String(secret.prompt ?? '').trim() || '请输入敏感信息'
      }
    }
    this.setPendingSecret(context, pending)
    return await this.awaitSecretAnswer(pending, signal)
  }

  async requestQuestionnaireInput(
    context: RuntimeUserInteractionToolContext,
    questionnaire: QuestionnaireToolParams,
    signal?: AbortSignal,
    toolCallId?: string
  ): Promise<QuestionnaireToolResult> {
    if (questionnaire.questions.length === 0) {
      return {
        status: 'aborted',
        questionnaireId: questionnaire.questionnaireId,
        stepIndex: 0,
        questionId: '',
        reason: 'execution_interrupted',
        answers: []
      }
    }

    const normalizedThreadId = this.normalizeThreadId(context.interactionThreadId)
    return await executeQuestionnaireFlow({
      threadId: normalizedThreadId,
      toolCallId: String(toolCallId ?? `questionnaire:${questionnaire.questionnaireId}`),
      questionnaire,
      setPendingQuestionnaire: (pending) => this.setPendingQuestionnaire(context, pending),
      clearPendingQuestionnaire: (threadId, pendingToolCallId) =>
        this.clearPendingQuestionnaire(threadId, pendingToolCallId),
      awaitStepAnswer: (pending, pendingSignal) =>
        this.awaitQuestionnaireStepAnswer(pending, pendingSignal),
      signal
    })
  }

  async requestFormInput(
    context: RuntimeUserInteractionToolContext,
    form: RuntimeFormRequest,
    signal?: AbortSignal
  ): Promise<RuntimeFormResult> {
    const normalizedFormId = String(form.formId ?? '').trim() || `form-${crypto.randomUUID()}`
    const fields = form.fields.filter(
      (field) => String(field.key ?? '').trim() && String(field.label ?? '').trim()
    )
    if (fields.length === 0) {
      return {
        status: 'completed',
        formId: normalizedFormId,
        values: {},
        answers: []
      }
    }

    const questionnaire: QuestionnaireToolParams = {
      questionnaireId: `form:${normalizedFormId}`,
      title: String(form.title ?? '').trim() || '表单输入',
      questions: fields.map((field, index) =>
        buildFormQuestion(field, index, fields.length, form.description)
      )
    }
    const result = await this.requestQuestionnaireInput(
      context,
      questionnaire,
      signal,
      `runtime-form:${normalizedFormId}`
    )
    const values = mapFormAnswersToValues(fields, result.answers)

    if (result.status === 'completed') {
      return {
        status: 'completed',
        formId: normalizedFormId,
        values,
        answers: result.answers
      }
    }

    return {
      status: 'aborted',
      formId: normalizedFormId,
      reason: result.reason,
      values,
      answers: result.answers
    }
  }

  abortThread(threadId: string, reason: QuestionToolAbortReason = 'execution_interrupted'): void {
    const key = this.normalizeThreadId(threadId)
    this.abortPendingQuestion(key, reason)
    this.abortPendingQuestionnaire(key)
    this.abortPendingSecret(key, reason)
    const question = this.pendingQuestionsByThreadId.get(key)
    if (question) this.clearPendingQuestion(key, question.pending.toolCallId)
    const questionnaire = this.pendingQuestionnairesByThreadId.get(key)
    if (questionnaire) this.clearPendingQuestionnaire(key, questionnaire.pending.toolCallId)
    const secret = this.pendingSecretsByThreadId.get(key)
    if (secret) this.clearPendingSecret(key, secret.pending.requestId)
  }

  abortAll(reason: QuestionToolAbortReason = 'execution_interrupted'): void {
    for (const threadId of [...this.pendingQuestionsByThreadId.keys()]) {
      this.abortPendingQuestion(threadId, reason)
    }
    for (const threadId of [...this.pendingQuestionnairesByThreadId.keys()]) {
      this.abortPendingQuestionnaire(threadId)
    }
    for (const threadId of [...this.pendingSecretsByThreadId.keys()]) {
      this.abortPendingSecret(threadId, reason)
    }
    for (const state of [...this.pendingQuestionsByThreadId.values()]) {
      this.clearPendingQuestion(state.pending.threadId, state.pending.toolCallId)
    }
    for (const state of [...this.pendingQuestionnairesByThreadId.values()]) {
      this.clearPendingQuestionnaire(state.pending.threadId, state.pending.toolCallId)
    }
    for (const state of [...this.pendingSecretsByThreadId.values()]) {
      this.clearPendingSecret(state.pending.threadId, state.pending.requestId)
    }
  }

  hasPending(threadId: string): boolean {
    const key = this.normalizeThreadId(threadId)
    return (
      this.pendingQuestionsByThreadId.has(key) ||
      this.pendingQuestionnairesByThreadId.has(key) ||
      this.pendingSecretsByThreadId.has(key)
    )
  }

  hasPendingQuestion(threadId: string): boolean {
    return this.pendingQuestionsByThreadId.has(this.normalizeThreadId(threadId))
  }

  hasPendingQuestionnaire(threadId: string): boolean {
    return this.pendingQuestionnairesByThreadId.has(this.normalizeThreadId(threadId))
  }

  hasPendingSecret(threadId: string): boolean {
    return this.pendingSecretsByThreadId.has(this.normalizeThreadId(threadId))
  }

  private setPendingQuestion(
    context: RuntimeUserInteractionToolContext,
    pending: PendingQuestion
  ): void {
    this.abortPendingQuestion(pending.threadId, 'execution_interrupted')
    this.abortPendingQuestionnaire(pending.threadId)
    const interaction = this.requestInteraction(
      context,
      pending.question.options?.length ? 'option_select' : 'text_input',
      pending.question.prompt
    )
    this.pendingQuestionsByThreadId.set(pending.threadId, {
      pending,
      settled: false,
      resolve: () => {},
      abortCleanup: undefined,
      interactionId: interaction?.id ?? null
    })
    this.emitQuestionEvent?.({ type: 'set', pending })
  }

  private setPendingQuestionnaire(
    context: RuntimeUserInteractionToolContext,
    pending: PendingQuestionnaire
  ): void {
    this.abortPendingQuestion(pending.threadId, 'execution_interrupted')
    this.abortPendingQuestionnaire(pending.threadId)
    const question = pending.questionnaire.questions[pending.currentStepIndex]
    const prompt = question?.prompt || pending.questionnaire.title || 'Questionnaire step'
    const interaction = this.requestInteraction(context, 'multi_step_form', prompt)
    this.pendingQuestionnairesByThreadId.set(pending.threadId, {
      pending,
      settled: false,
      resolve: () => {},
      abortCleanup: undefined,
      interactionId: interaction?.id ?? null
    })
    this.emitQuestionnaireEvent?.({ type: 'set', pending })
  }

  private setPendingSecret(
    context: RuntimeUserInteractionToolContext,
    pending: PendingSecretPrompt
  ): void {
    this.abortPendingQuestion(pending.threadId, 'execution_interrupted')
    this.abortPendingQuestionnaire(pending.threadId)
    this.abortPendingSecret(pending.threadId, 'execution_interrupted')
    const interaction = this.requestInteraction(context, 'text_input', pending.secret.prompt)
    this.pendingSecretsByThreadId.set(pending.threadId, {
      pending,
      settled: false,
      resolve: () => {},
      abortCleanup: undefined,
      interactionId: interaction?.id ?? null
    })
    this.emitSecretEvent?.({ type: 'set', pending })
  }

  private awaitQuestionAnswer(
    pending: PendingQuestion,
    signal?: AbortSignal
  ): Promise<QuestionToolResult> {
    return new Promise<QuestionToolResult>((resolve) => {
      const existing = this.pendingQuestionsByThreadId.get(pending.threadId)
      if (!existing || existing.pending.toolCallId !== pending.toolCallId) {
        resolve({
          status: 'aborted',
          questionId: pending.question.questionId,
          reason: 'execution_interrupted'
        })
        return
      }

      existing.resolve = resolve
      const onAbort = () => {
        this.abortPendingQuestion(pending.threadId, 'agent_aborted')
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
        existing.abortCleanup = () => signal.removeEventListener('abort', onAbort)
      }
    })
  }

  private awaitQuestionnaireStepAnswer(
    pending: PendingQuestionnaire,
    signal?: AbortSignal
  ): Promise<QuestionnaireAnswerPayload | null> {
    return new Promise<QuestionnaireAnswerPayload | null>((resolve) => {
      const existing = this.pendingQuestionnairesByThreadId.get(pending.threadId)
      if (!existing || existing.pending.toolCallId !== pending.toolCallId) {
        resolve(null)
        return
      }

      existing.resolve = resolve
      const onAbort = () => {
        this.abortPendingQuestionnaire(pending.threadId)
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
        existing.abortCleanup = () => signal.removeEventListener('abort', onAbort)
      }
    })
  }

  private awaitSecretAnswer(
    pending: PendingSecretPrompt,
    signal?: AbortSignal
  ): Promise<SecretPromptResult> {
    return new Promise<SecretPromptResult>((resolve) => {
      const existing = this.pendingSecretsByThreadId.get(pending.threadId)
      if (!existing || existing.pending.requestId !== pending.requestId) {
        resolve({
          status: 'aborted',
          secretId: pending.secret.secretId,
          reason: 'execution_interrupted'
        })
        return
      }

      existing.resolve = resolve
      const onAbort = () => {
        this.abortPendingSecret(pending.threadId, 'agent_aborted')
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
        existing.abortCleanup = () => signal.removeEventListener('abort', onAbort)
      }
    })
  }

  private clearPendingQuestion(threadId: string, toolCallId: string): void {
    const existing = this.pendingQuestionsByThreadId.get(threadId)
    if (!existing || existing.pending.toolCallId !== toolCallId) return
    if (existing.abortCleanup) existing.abortCleanup()
    this.pendingQuestionsByThreadId.delete(threadId)
    this.emitQuestionEvent?.({ type: 'clear', threadId, toolCallId })
  }

  private clearPendingQuestionnaire(threadId: string, toolCallId: string): void {
    const existing = this.pendingQuestionnairesByThreadId.get(threadId)
    if (!existing || existing.pending.toolCallId !== toolCallId) return
    if (existing.abortCleanup) existing.abortCleanup()
    this.pendingQuestionnairesByThreadId.delete(threadId)
    this.emitQuestionnaireEvent?.({ type: 'clear', threadId, toolCallId })
  }

  private clearPendingSecret(threadId: string, requestId: string): void {
    const existing = this.pendingSecretsByThreadId.get(threadId)
    if (!existing || existing.pending.requestId !== requestId) return
    if (existing.abortCleanup) existing.abortCleanup()
    this.pendingSecretsByThreadId.delete(threadId)
    this.emitSecretEvent?.({ type: 'clear', threadId, requestId })
  }

  private settlePendingQuestion(threadId: string, result: QuestionToolResult): boolean {
    const existing = this.pendingQuestionsByThreadId.get(threadId)
    if (!existing || existing.settled) return false
    existing.settled = true
    this.clearPendingQuestion(threadId, existing.pending.toolCallId)
    existing.resolve(result)
    return true
  }

  private abortPendingQuestion(
    threadId: string,
    reason: QuestionToolAbortReason = 'execution_interrupted'
  ): boolean {
    const existing = this.pendingQuestionsByThreadId.get(threadId)
    if (!existing || existing.settled) return false
    this.markInteractionCancelled(existing)
    return this.settlePendingQuestion(threadId, {
      status: 'aborted',
      questionId: existing.pending.question.questionId,
      reason
    })
  }

  private settlePendingQuestionnaire(
    threadId: string,
    result: QuestionnaireAnswerPayload | null
  ): boolean {
    const existing = this.pendingQuestionnairesByThreadId.get(threadId)
    if (!existing || existing.settled) return false
    existing.settled = true
    if (existing.abortCleanup) {
      existing.abortCleanup()
      existing.abortCleanup = undefined
    }
    existing.resolve(result)
    return true
  }

  private abortPendingQuestionnaire(threadId: string): boolean {
    const existing = this.pendingQuestionnairesByThreadId.get(threadId)
    if (!existing || existing.settled) return false
    this.markInteractionCancelled(existing)
    const didSettle = this.settlePendingQuestionnaire(threadId, null)
    this.clearPendingQuestionnaire(threadId, existing.pending.toolCallId)
    return didSettle
  }

  private settlePendingSecret(threadId: string, result: SecretPromptResult): boolean {
    const existing = this.pendingSecretsByThreadId.get(threadId)
    if (!existing || existing.settled) return false
    existing.settled = true
    this.clearPendingSecret(threadId, existing.pending.requestId)
    existing.resolve(result)
    return true
  }

  private abortPendingSecret(
    threadId: string,
    reason: QuestionToolAbortReason = 'execution_interrupted'
  ): boolean {
    const existing = this.pendingSecretsByThreadId.get(threadId)
    if (!existing || existing.settled) return false
    this.markInteractionCancelled(existing)
    return this.settlePendingSecret(threadId, {
      status: 'aborted',
      secretId: existing.pending.secret.secretId,
      reason
    })
  }

  private requestInteraction(
    context: RuntimeUserInteractionToolContext,
    kind: 'text_input' | 'option_select' | 'multi_step_form',
    prompt: string
  ): InteractionCheckpoint | null {
    try {
      return this.core.requestInteraction({
        conversationId: context.conversationId,
        runId: context.getActiveRunId?.() ?? null,
        kind,
        prompt
      })
    } catch (error) {
      console.error('Runtime interaction checkpoint request failed', error)
      return null
    }
  }

  private markInteractionAnswered(
    state: PendingQuestionState | PendingQuestionnaireState | PendingSecretState
  ): void {
    if (!state.interactionId) return
    try {
      this.core.answerInteraction({ interactionId: state.interactionId })
    } catch (error) {
      console.error('Runtime interaction checkpoint answer failed', error)
    }
  }

  private markInteractionCancelled(
    state: PendingQuestionState | PendingQuestionnaireState | PendingSecretState
  ): void {
    if (!state.interactionId) return
    try {
      this.core.cancelInteraction({ interactionId: state.interactionId })
    } catch (error) {
      console.error('Runtime interaction checkpoint cancel failed', error)
    }
  }

  private normalizeThreadId(value: string): string {
    return String(value ?? '').trim() || 'default'
  }
}

const buildFormQuestion = (
  field: RuntimeFormField,
  index: number,
  total: number,
  formDescription?: string
) => {
  const header = [`请输入 ${field.label}${field.required ? '（必填）' : ''}。`]
  if (formDescription?.trim() && index === 0) header.unshift(formDescription.trim())
  if (field.description?.trim()) header.push(field.description.trim())
  if (
    field.currentValue !== undefined &&
    field.currentValue !== null &&
    String(field.currentValue).trim()
  ) {
    header.push(`当前值：${String(field.currentValue)}`)
  } else if (
    field.defaultValue !== undefined &&
    field.defaultValue !== null &&
    String(field.defaultValue).trim()
  ) {
    header.push(`默认值：${String(field.defaultValue)}`)
  }

  if (field.type === 'boolean') {
    header.push('请选择“是”或“否”，也可以输入 true/false。')
  } else if (field.type === 'number') {
    header.push('请输入数字。')
  }

  return {
    questionId: field.key,
    title: `第 ${index + 1} 步（共 ${total} 步）· ${field.label}`,
    prompt: header.join('\n'),
    mode: 'selection_or_text' as const,
    options:
      field.type === 'boolean'
        ? [
            { id: 'true', label: '是', value: 'true' },
            { id: 'false', label: '否', value: 'false' }
          ]
        : field.options,
    placeholder: field.placeholder
  }
}

const mapFormAnswersToValues = (
  fields: RuntimeFormField[],
  answers: QuestionnaireToolAnswer[]
): Record<string, string | number | boolean | null> => {
  const values: Record<string, string | number | boolean | null> = {}
  const answerByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]))

  for (const field of fields) {
    const answer = answerByQuestionId.get(field.key)
    if (!answer) continue

    const rawValue = answer.inputKind === 'option' ? answer.value : answer.rawInput
    if (field.type === 'boolean') {
      const normalized = String(rawValue).trim().toLowerCase()
      if (
        normalized === 'true' ||
        normalized === '1' ||
        normalized === 'yes' ||
        normalized === '是'
      ) {
        values[field.key] = true
        continue
      }
      if (
        normalized === 'false' ||
        normalized === '0' ||
        normalized === 'no' ||
        normalized === '否'
      ) {
        values[field.key] = false
        continue
      }
    }

    if (field.type === 'number') {
      const normalized = Number(String(rawValue).trim())
      if (Number.isFinite(normalized)) {
        values[field.key] = normalized
        continue
      }
    }

    values[field.key] = String(rawValue).trim() || null
  }

  return values
}
