import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type {
  PendingQuestion,
  QuestionToolOption,
  QuestionToolParams,
  QuestionToolResult
} from '@shared/question-tool'

type CreateQuestionToolOptions = {
  threadId: string
  setPendingQuestion: (pending: PendingQuestion) => void
  clearPendingQuestion: (threadId: string, toolCallId: string) => void
  awaitAnswer: (pending: PendingQuestion, signal?: AbortSignal) => Promise<QuestionToolResult>
}

const optionSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  description: Type.Optional(Type.String()),
  value: Type.Optional(Type.String())
})

export const createQuestionTool = ({
  threadId,
  setPendingQuestion,
  clearPendingQuestion,
  awaitAnswer
}: CreateQuestionToolOptions): ToolDefinition => ({
  name: 'questionTool',
  label: 'Question Tool',
  description:
    'Ask the user a blocking question and wait for their next input before continuing. Use this when the next step cannot proceed without user input.',
  parameters: Type.Object({
    questionId: Type.String({
      description: 'Stable identifier for this question.'
    }),
    title: Type.Optional(
      Type.String({
        description: 'Optional short title shown above the question.'
      })
    ),
    prompt: Type.String({
      description: 'The full prompt shown to the user.'
    }),
    mode: Type.String({
      enum: ['selection_or_text'],
      description:
        'The only supported question UI mode. Show option buttons when provided, and always allow free-form text input.'
    }),
    options: Type.Optional(
      Type.Array(optionSchema, {
        description: 'Optional predefined choices shown as buttons.'
      })
    ),
    placeholder: Type.Optional(
      Type.String({
        description: 'Optional composer hint when free-form input is expected.'
      })
    ),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  }),
  execute: async (toolCallId, params, signal) => {
    const rawParams = isRecord(params) ? params : {}
    const question: QuestionToolParams = {
      questionId: typeof rawParams.questionId === 'string' ? rawParams.questionId : '',
      title: typeof rawParams.title === 'string' ? rawParams.title : undefined,
      prompt: typeof rawParams.prompt === 'string' ? rawParams.prompt : '',
      mode: 'selection_or_text',
      options: Array.isArray(rawParams.options)
        ? rawParams.options
            .map((option) => normalizeOption(option))
            .filter((option): option is QuestionToolOption => Boolean(option))
        : undefined,
      placeholder: typeof rawParams.placeholder === 'string' ? rawParams.placeholder : undefined,
      metadata: isRecord(rawParams.metadata) ? rawParams.metadata : undefined
    }

    const pending: PendingQuestion = {
      threadId,
      toolCallId,
      question
    }

    setPendingQuestion(pending)

    try {
      const result = await awaitAnswer(pending, signal)
      return buildQuestionToolResult(result)
    } finally {
      clearPendingQuestion(threadId, toolCallId)
    }
  }
})

const normalizeOption = (value: unknown): QuestionToolOption | null => {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  if (!id || !label) return null
  const description = typeof value.description === 'string' ? value.description.trim() : undefined
  const rawValue = typeof value.value === 'string' ? value.value : undefined
  return {
    id,
    label,
    description: description || undefined,
    value: rawValue
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const buildQuestionToolResult = (result: QuestionToolResult) => {
  if (result.status === 'answered' && result.inputKind === 'option') {
    return {
      content: [{ type: 'text' as const, text: `User selected: ${result.label}` }],
      details: result
    }
  }

  if (result.status === 'answered') {
    return {
      content: [{ type: 'text' as const, text: `User replied: ${result.rawInput}` }],
      details: result
    }
  }

  return {
    content: [
      { type: 'text' as const, text: 'Question interrupted before user input was received.' }
    ],
    details: result
  }
}
