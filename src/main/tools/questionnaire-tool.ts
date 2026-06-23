import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type {
  PendingQuestionnaire,
  QuestionnaireAnswerPayload,
  QuestionnaireToolAnswer,
  QuestionnaireToolParams,
  QuestionnaireToolQuestion,
  QuestionnaireToolResult
} from '@shared/questionnaire-tool'
import type { QuestionToolOption } from '@shared/question-tool'

type CreateQuestionnaireToolOptions = {
  threadId: string
  setPendingQuestionnaire: (pending: PendingQuestionnaire) => void
  clearPendingQuestionnaire: (threadId: string, toolCallId: string) => void
  awaitStepAnswer: (
    pending: PendingQuestionnaire,
    signal?: AbortSignal
  ) => Promise<QuestionnaireAnswerPayload | null>
}

export type ExecuteQuestionnaireFlowOptions = {
  threadId: string
  toolCallId: string
  questionnaire: QuestionnaireToolParams
  setPendingQuestionnaire: (pending: PendingQuestionnaire) => void
  clearPendingQuestionnaire: (threadId: string, toolCallId: string) => void
  awaitStepAnswer: (
    pending: PendingQuestionnaire,
    signal?: AbortSignal
  ) => Promise<QuestionnaireAnswerPayload | null>
  signal?: AbortSignal
}

const optionSchema = Type.Object({
  id: Type.String({
    description: 'Stable identifier for this option within the current step.'
  }),
  label: Type.String({
    description: 'The button label shown to the user.'
  }),
  description: Type.Optional(
    Type.String({
      description: 'Optional secondary text that explains the option.'
    })
  ),
  value: Type.Optional(
    Type.String({
      description:
        'Optional canonical value returned when this option is selected. Defaults to `label`.'
    })
  )
})

const questionSchema = Type.Object({
  questionId: Type.String({
    description: 'Stable identifier for this step.'
  }),
  title: Type.Optional(
    Type.String({
      description:
        'Display title shown verbatim in the panel header. Format it exactly as "第 N 步（共 M 步）· 主题", for example "第 1 步（共 3 步）· 人物范围". Do not use other numbering styles such as "第一步", "第1步", "第1/3步", "（1/3） 主题", "Step 1", or "1.".'
    })
  ),
  prompt: Type.String({
    description: 'The full prompt shown to the user for this step.'
  }),
  mode: Type.String({
    enum: ['selection_or_text'],
    description:
      'The only supported step UI mode. Show option buttons when provided, and always allow free-form text input.'
  }),
  options: Type.Optional(
    Type.Array(optionSchema, {
      description: 'Optional predefined choices shown as buttons for this step.'
    })
  ),
  placeholder: Type.Optional(
    Type.String({
      description: 'Optional composer hint when free-form text input is allowed.'
    })
  )
})

export const createQuestionnaireTool = ({
  threadId,
  setPendingQuestionnaire,
  clearPendingQuestionnaire,
  awaitStepAnswer
}: CreateQuestionnaireToolOptions): ToolDefinition => ({
  name: 'questionnaireTool',
  label: 'Questionnaire Tool',
  description:
    'Run a blocking multi-step questionnaire and wait for the user to complete each step before continuing. Use this for guided wizards with progress, step descriptions, and explicit options. Do not use this tool for IM or transport account setup; use `imTool` action `setup_account` so the transport plugin supplies the real setup methods, labels, prompts, fields, QR data, expiry, and status.',
  parameters: Type.Object({
    questionnaireId: Type.String({
      description: 'Stable identifier for this questionnaire.'
    }),
    title: Type.Optional(
      Type.String({
        description:
          'Optional overall questionnaire title. This is a plain fallback title and does not need progress formatting.'
      })
    ),
    questions: Type.Array(questionSchema, {
      minItems: 1,
      description: 'Ordered questionnaire steps.'
    })
  }),
  execute: async (toolCallId, params, signal) => {
    const questionnaire = normalizeQuestionnaireParams(params, toolCallId)

    if (questionnaire.questions.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'Questionnaire skipped: no valid steps.' }],
        details: {
          status: 'aborted',
          questionnaireId: questionnaire.questionnaireId,
          stepIndex: 0,
          questionId: '',
          reason: 'execution_interrupted',
          answers: []
        } satisfies QuestionnaireToolResult
      }
    }

    const result = await executeQuestionnaireFlow({
      threadId,
      toolCallId,
      questionnaire,
      setPendingQuestionnaire,
      clearPendingQuestionnaire,
      awaitStepAnswer,
      signal
    })
    return {
      content: [
        {
          type: 'text' as const,
          text:
            result.status === 'completed'
              ? buildCompletedSummary(questionnaire, result.answers)
              : 'Questionnaire interrupted before completion.'
        }
      ],
      details: result
    }
  }
})

export const normalizeQuestionnaireParams = (
  params: unknown,
  toolCallId: string
): QuestionnaireToolParams => {
  const rawParams = isRecord(params) ? params : {}
  const questionnaire: QuestionnaireToolParams = {
    questionnaireId:
      typeof rawParams.questionnaireId === 'string' ? rawParams.questionnaireId.trim() : '',
    title: typeof rawParams.title === 'string' ? rawParams.title.trim() || undefined : undefined,
    questions: Array.isArray(rawParams.questions)
      ? rawParams.questions
          .map((question) => normalizeQuestion(question))
          .filter((question): question is QuestionnaireToolQuestion => Boolean(question))
      : []
  }

  if (!questionnaire.questionnaireId) {
    questionnaire.questionnaireId = `questionnaire-${toolCallId}`
  }

  return questionnaire
}

export const executeQuestionnaireFlow = async ({
  threadId,
  toolCallId,
  questionnaire,
  setPendingQuestionnaire,
  clearPendingQuestionnaire,
  awaitStepAnswer,
  signal
}: ExecuteQuestionnaireFlowOptions): Promise<QuestionnaireToolResult> => {
  const answers: QuestionnaireToolAnswer[] = []

  try {
    for (let stepIndex = 0; stepIndex < questionnaire.questions.length; stepIndex += 1) {
      const pending: PendingQuestionnaire = {
        threadId,
        toolCallId,
        questionnaire,
        currentStepIndex: stepIndex,
        answers: [...answers]
      }

      setPendingQuestionnaire(pending)
      const payload = await awaitStepAnswer(pending, signal)

      if (!payload) {
        const question = questionnaire.questions[stepIndex]
        return buildAbortedQuestionnaireResult(
          questionnaire.questionnaireId,
          stepIndex,
          question.questionId,
          answers
        )
      }

      const answer = buildAnswerForStep(pending, payload)
      if (!answer) {
        const question = questionnaire.questions[stepIndex]
        return buildAbortedQuestionnaireResult(
          questionnaire.questionnaireId,
          stepIndex,
          question.questionId,
          answers
        )
      }

      answers.push(answer)
    }

    return {
      status: 'completed',
      questionnaireId: questionnaire.questionnaireId,
      answers
    }
  } finally {
    clearPendingQuestionnaire(threadId, toolCallId)
  }
}

const normalizeQuestion = (value: unknown): QuestionnaireToolQuestion | null => {
  if (!isRecord(value)) return null
  const questionId = typeof value.questionId === 'string' ? value.questionId.trim() : ''
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : ''
  if (!questionId || !prompt) return null
  return {
    questionId,
    title: typeof value.title === 'string' ? value.title.trim() || undefined : undefined,
    prompt,
    mode: 'selection_or_text',
    options: Array.isArray(value.options)
      ? value.options
          .map((option) => normalizeOption(option))
          .filter((option): option is QuestionToolOption => Boolean(option))
      : undefined,
    placeholder:
      typeof value.placeholder === 'string' ? value.placeholder.trim() || undefined : undefined
  }
}

const normalizeOption = (value: unknown): QuestionToolOption | null => {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  if (!id || !label) return null
  return {
    id,
    label,
    description:
      typeof value.description === 'string' ? value.description.trim() || undefined : undefined,
    value: typeof value.value === 'string' ? value.value : undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const buildAnswerForStep = (
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

const buildCompletedSummary = (
  questionnaire: QuestionnaireToolParams,
  answers: QuestionnaireToolAnswer[]
): string => {
  const lines = answers.map((answer) => {
    const question = questionnaire.questions[answer.stepIndex]
    const title =
      question?.title?.trim() || question?.prompt?.trim() || `第${answer.stepIndex + 1}步`
    const value = answer.inputKind === 'option' ? answer.label : answer.rawInput
    return `${answer.stepIndex + 1}. ${title}：${value}`
  })
  return `${questionnaire.title || 'Questionnaire'}\n\n${lines.join('\n')}`
}

const buildAbortedQuestionnaireResult = (
  questionnaireId: string,
  stepIndex: number,
  questionId: string,
  answers: QuestionnaireToolAnswer[]
): QuestionnaireToolResult => ({
  status: 'aborted',
  questionnaireId,
  stepIndex,
  questionId,
  reason: 'execution_interrupted',
  answers
})
