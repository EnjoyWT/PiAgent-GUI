export type QuestionToolMode = 'selection_or_text'

export type QuestionToolOption = {
  id: string
  label: string
  description?: string
  value?: string
}

export type QuestionToolParams = {
  questionId: string
  title?: string
  prompt: string
  mode: QuestionToolMode
  options?: QuestionToolOption[]
  placeholder?: string
  metadata?: Record<string, unknown>
}

export type QuestionToolAbortReason = 'agent_aborted' | 'run_failed' | 'execution_interrupted'

export type QuestionToolResult =
  | {
      status: 'answered'
      inputKind: 'option'
      questionId: string
      optionId: string
      label: string
      value: string
      rawInput: string
    }
  | {
      status: 'answered'
      inputKind: 'text'
      questionId: string
      rawInput: string
    }
  | {
      status: 'aborted'
      questionId: string
      reason: QuestionToolAbortReason
    }

export type PendingQuestion = {
  threadId: string
  toolCallId: string
  question: QuestionToolParams
}

export type PendingQuestionEvent =
  | { type: 'set'; pending: PendingQuestion }
  | { type: 'clear'; threadId: string; toolCallId: string }

export type QuestionAnswerPayload =
  | {
      questionId: string
      inputKind: 'option'
      optionId: string
    }
  | {
      questionId: string
      inputKind: 'text'
      rawInput: string
    }
