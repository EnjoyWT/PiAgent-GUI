import type { QuestionToolMode, QuestionToolOption, QuestionToolAbortReason } from './question-tool'

export type QuestionnaireToolQuestion = {
  questionId: string
  title?: string
  prompt: string
  mode: QuestionToolMode
  options?: QuestionToolOption[]
  placeholder?: string
}

export type QuestionnaireToolParams = {
  questionnaireId: string
  title?: string
  questions: QuestionnaireToolQuestion[]
}

export type QuestionnaireToolAnswer =
  | {
      stepIndex: number
      questionId: string
      inputKind: 'option'
      optionId: string
      label: string
      value: string
      rawInput: string
    }
  | {
      stepIndex: number
      questionId: string
      inputKind: 'text'
      rawInput: string
    }

export type QuestionnaireToolResult =
  | {
      status: 'completed'
      questionnaireId: string
      answers: QuestionnaireToolAnswer[]
    }
  | {
      status: 'aborted'
      questionnaireId: string
      stepIndex: number
      questionId: string
      reason: QuestionToolAbortReason
      answers: QuestionnaireToolAnswer[]
    }

export type PendingQuestionnaire = {
  threadId: string
  toolCallId: string
  questionnaire: QuestionnaireToolParams
  currentStepIndex: number
  answers: QuestionnaireToolAnswer[]
}

export type PendingQuestionnaireEvent =
  | { type: 'set'; pending: PendingQuestionnaire }
  | { type: 'clear'; threadId: string; toolCallId: string }

export type QuestionnaireAnswerPayload =
  | {
      questionnaireId: string
      stepIndex: number
      questionId: string
      inputKind: 'option'
      optionId: string
    }
  | {
      questionnaireId: string
      stepIndex: number
      questionId: string
      inputKind: 'text'
      rawInput: string
    }
