import type {
  ContextCaptureQuestionAnswerInput,
  ContextCaptureQuestionnaireAnswerInput,
  ContextCaptureRunInput,
  ContextConsumedUserMessageInput
} from './context-types.ts'
import { ContextStore } from './context-store.ts'
import type { PendingQuestion } from '@shared/question-tool'
import type { PendingQuestionnaire } from '@shared/questionnaire-tool'

const normalizeText = (value: string): string => value.replace(/\r\n/g, '\n').trim()

const stringifyJson = (value: unknown): string | null => {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

const summarizeQuestionPrompt = (pending: PendingQuestion): string => {
  const title = pending.question.title?.trim()
  const prompt = pending.question.prompt.trim()
  const options = pending.question.options?.map((option) => option.label).filter(Boolean) ?? []
  const parts = [title, prompt].filter(Boolean)
  if (options.length > 0) parts.push(`Options: ${options.join(' | ')}`)
  return parts.join('\n\n').trim()
}

const summarizeQuestionnairePrompt = (pending: PendingQuestionnaire): string => {
  const question = pending.questionnaire.questions[pending.currentStepIndex]
  if (!question) return ''
  const title = question.title?.trim() || pending.questionnaire.title?.trim()
  const prompt = question.prompt.trim()
  const options = question.options?.map((option) => option.label).filter(Boolean) ?? []
  const parts = [title, prompt].filter(Boolean)
  if (options.length > 0) parts.push(`Options: ${options.join(' | ')}`)
  return parts.join('\n\n').trim()
}

export class ContextCaptureService {
  private readonly store: ContextStore

  constructor(store: ContextStore) {
    this.store = store
  }

  async captureConsumedUserMessage(input: ContextConsumedUserMessageInput): Promise<void> {
    const { message } = input
    if (!message?.id) return
    this.store.appendEntry({
      threadId: message.thread_id,
      agentRunId: message.agent_run_id,
      agentTurnId: message.agent_turn_id,
      sourceKind: 'message',
      sourceRef: `message:${message.id}`,
      role: 'user',
      semanticKind: 'user_message',
      includeInModelContext: message.include_in_agent_context === 1,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: normalizeText(message.content),
      contentJson: message.content_json,
      tokenEstimate: null,
      createdAt: message.created_at
    })
  }

  async captureQuestionPrompt(pending: PendingQuestion): Promise<void> {
    this.store.appendEntry({
      threadId: pending.threadId,
      sourceKind: 'question',
      sourceRef: `question:${pending.toolCallId}:prompt`,
      groupId: pending.toolCallId,
      role: 'assistant',
      semanticKind: 'question_prompt',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: summarizeQuestionPrompt(pending),
      contentJson: stringifyJson(pending.question),
      tokenEstimate: null,
      createdAt: new Date().toISOString().replace('T', ' ').replace('Z', '')
    })
  }

  async captureQuestionAnswer(input: ContextCaptureQuestionAnswerInput): Promise<void> {
    const { pending, result, createdAt } = input
    if (result.status !== 'answered') return
    const contentText =
      result.inputKind === 'option'
        ? normalizeText(result.value || result.rawInput)
        : normalizeText(result.rawInput)

    this.store.appendEntry({
      threadId: input.threadId,
      sourceKind: 'answer',
      sourceRef: `question:${pending.toolCallId}:answer`,
      groupId: pending.toolCallId,
      role: 'user',
      semanticKind: 'question_answer',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText,
      contentJson: stringifyJson(result),
      tokenEstimate: null,
      createdAt: createdAt ?? new Date()
    })
  }

  async captureQuestionnairePrompt(pending: PendingQuestionnaire): Promise<void> {
    const question = pending.questionnaire.questions[pending.currentStepIndex]
    if (!question) return
    this.store.appendEntry({
      threadId: pending.threadId,
      sourceKind: 'question',
      sourceRef: `questionnaire:${pending.toolCallId}:step:${pending.currentStepIndex}:prompt`,
      groupId: pending.toolCallId,
      role: 'assistant',
      semanticKind: 'question_prompt',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText: summarizeQuestionnairePrompt(pending),
      contentJson: stringifyJson({
        questionnaireId: pending.questionnaire.questionnaireId,
        stepIndex: pending.currentStepIndex,
        question
      }),
      tokenEstimate: null,
      createdAt: new Date().toISOString().replace('T', ' ').replace('Z', '')
    })
  }

  async captureQuestionnaireAnswer(input: ContextCaptureQuestionnaireAnswerInput): Promise<void> {
    const { pending, payload, createdAt } = input
    const question = pending.questionnaire.questions[pending.currentStepIndex]
    if (!question) return
    let contentText = ''
    if (payload.inputKind === 'option') {
      const option = question.options?.find((item) => item.id === payload.optionId)
      contentText = option?.value ?? option?.label ?? ''
    } else {
      contentText = payload.rawInput
    }
    contentText = normalizeText(contentText)
    if (!contentText) return

    this.store.appendEntry({
      threadId: input.threadId,
      sourceKind: 'answer',
      sourceRef: `questionnaire:${pending.toolCallId}:step:${pending.currentStepIndex}:answer`,
      groupId: pending.toolCallId,
      role: 'user',
      semanticKind: 'question_answer',
      includeInModelContext: true,
      includeInMemory: false,
      compactPolicy: 'summarize',
      contentText,
      contentJson: stringifyJson(payload),
      tokenEstimate: null,
      createdAt: createdAt ?? new Date()
    })
  }

  async captureFinalizedRun(input: ContextCaptureRunInput): Promise<void> {
    const { threadId, run } = input
    const drafts = [] as Parameters<ContextStore['appendEntry']>[0][]

    if (normalizeText(run.text)) {
      drafts.push({
        threadId,
        agentRunId: run.agentRunId,
        sourceKind: 'message',
        sourceRef: `run:${run.agentRunId}:assistant`,
        role: 'assistant',
        semanticKind: 'assistant_message',
        includeInModelContext: true,
        includeInMemory: false,
        compactPolicy: 'summarize',
        contentText: normalizeText(run.text),
        contentJson: null,
        tokenEstimate: null,
        createdAt: run.endedAt ?? run.startedAt
      })
    }

    for (const tool of run.toolCalls) {
      const summary = normalizeText(tool.summary ?? '')
      if (!summary) continue
      drafts.push({
        threadId,
        agentRunId: run.agentRunId,
        agentTurnId: tool.agentTurnId,
        sourceKind: 'tool',
        sourceRef: `tool:${tool.toolCallId}:summary`,
        groupId: tool.toolCallId,
        role: 'assistant',
        semanticKind: 'tool_result_summary',
        includeInModelContext: true,
        includeInMemory: false,
        compactPolicy: 'summarize',
        contentText: `[${tool.name}] ${summary}`,
        contentJson: stringifyJson(tool),
        tokenEstimate: null,
        createdAt: tool.endedAt ?? tool.startedAt
      })
    }

    drafts.sort((left, right) => {
      const leftTime = new Date(String(left.createdAt ?? '')).getTime()
      const rightTime = new Date(String(right.createdAt ?? '')).getTime()
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime
      }
      if (left.semanticKind !== right.semanticKind) {
        return left.semanticKind === 'tool_result_summary' ? -1 : 1
      }
      return String(left.sourceRef ?? '').localeCompare(String(right.sourceRef ?? ''))
    })

    this.store.appendEntries(drafts)
  }
}
