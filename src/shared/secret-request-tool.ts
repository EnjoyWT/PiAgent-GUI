import { Type, type Static } from '@sinclair/typebox'
import type { QuestionToolAbortReason } from './question-tool'
import { SECRET_ANSWER_API_PATH } from './secret-input.ts'

export const SECRET_REQUEST_TOOL_NAME = 'secretRequestTool'
export const SECRET_REQUEST_ANSWER_API_PATH = SECRET_ANSWER_API_PATH

export const SecretRequestToolParamsSchema = Type.Object({
  action: Type.Optional(
    Type.String({
      enum: ['request_secret'],
      description:
        '`request_secret` collects a masked secret and returns only a receipt. For provider setup and provider API keys, always use `providerConfigTool` action `setup_api_key`.'
    })
  ),
  secretId: Type.Optional(
    Type.String({ description: 'Stable identifier for this secret request.' })
  ),
  title: Type.Optional(
    Type.String({ description: 'Optional title shown above the masked input.' })
  ),
  prompt: Type.Optional(
    Type.String({
      description: 'Prompt shown to the user. Required for `request_secret`.'
    })
  ),
  placeholder: Type.Optional(Type.String({ description: 'Optional masked input placeholder.' })),
  confirmLabel: Type.Optional(Type.String({ description: 'Optional submit button label.' })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
})

export type SecretRequestToolParams = Static<typeof SecretRequestToolParamsSchema>
export type SecretRequestToolAction = 'request_secret'

export const SecretRequestAnswerRequestSchema = Type.Object({
  threadId: Type.String({ minLength: 1 }),
  secretId: Type.String({ minLength: 1 }),
  value: Type.String({ minLength: 1 })
})

export type SecretRequestAnswerRequest = Static<typeof SecretRequestAnswerRequestSchema>

export const SecretRequestAnswerResultSchema = Type.Union([
  Type.Object({ success: Type.Literal(true) }),
  Type.Object({ success: Type.Literal(false), error: Type.String() })
])

export type SecretRequestAnswerResult = Static<typeof SecretRequestAnswerResultSchema>

export type SecretRequestToolResult =
  | {
      action: 'request_secret'
      status: 'answered'
      secretId: string
      received: true
      apiPath: typeof SECRET_REQUEST_ANSWER_API_PATH
    }
  | {
      action: 'request_secret'
      status: 'aborted'
      secretId: string
      received: false
      reason: QuestionToolAbortReason
      apiPath: typeof SECRET_REQUEST_ANSWER_API_PATH
    }
  | {
      action: SecretRequestToolAction
      status: 'invalid'
      secretId: string
      received: false
      error: string
      apiPath: typeof SECRET_REQUEST_ANSWER_API_PATH
    }
