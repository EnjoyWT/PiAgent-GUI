import type { QuestionToolAbortReason } from './question-tool'

export const SECRET_ANSWER_API_PATH = '/v1/secret-request/answer'

export type SecretPromptParams = {
  secretId: string
  apiPath?: string
  title?: string
  prompt: string
  placeholder?: string
  confirmLabel?: string
  metadata?: Record<string, unknown>
}

export type SecretPromptResult =
  | {
      status: 'answered'
      secretId: string
      value: string
    }
  | {
      status: 'aborted'
      secretId: string
      reason: QuestionToolAbortReason
    }

export type PendingSecretPrompt = {
  threadId: string
  requestId: string
  secret: SecretPromptParams
}

export type PendingSecretPromptEvent =
  | { type: 'set'; pending: PendingSecretPrompt }
  | { type: 'clear'; threadId: string; requestId: string }

export type SecretAnswerPayload = {
  secretId: string
  value: string
}
