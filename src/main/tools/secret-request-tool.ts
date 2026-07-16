import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import {
  SECRET_REQUEST_ANSWER_API_PATH,
  SECRET_REQUEST_TOOL_NAME,
  SecretRequestToolParamsSchema,
  type SecretRequestToolAction,
  type SecretRequestToolParams,
  type SecretRequestToolResult
} from '../../shared/secret-request-tool.ts'
import type { SecretPromptParams } from '../../shared/secret-input.ts'
import type { RuntimeUserInteractionController } from '../runtime-host/user-interaction-controller.ts'

type CreateSecretRequestToolOptions = {
  interactionController: RuntimeUserInteractionController
  context: {
    conversationId: string
    interactionThreadId: string
    getActiveRunId?: () => string | null
  }
}

type ToolExecuteResult = Awaited<ReturnType<ToolDefinition['execute']>>

// Positioning:
// - Model-facing generic wrapper around requestSecretInput for non-provider secrets.
// - Not an internal dependency of providerConfigTool; providerConfigTool calls
//   requestSecretInput directly so it can validate and persist provider API keys.
// - Current request_secret only returns a receipt and intentionally discards the
//   value. Add a domain tool or secret vault before using this for real storage,
//   such as future MCP tokens, webhook secrets, or SSH passphrases.
export const createSecretRequestTool = ({
  interactionController,
  context
}: CreateSecretRequestToolOptions): ToolDefinition => {
  const requestSecret = async (
    secret: SecretPromptParams,
    signal?: AbortSignal
  ): Promise<ToolExecuteResult> => {
    if (!secret.prompt.trim()) {
      return buildInvalidResult('request_secret', secret.secretId, 'prompt is required')
    }

    const answer = await interactionController.requestSecretInput(context, secret, signal)
    if (answer.status !== 'answered') {
      const result: SecretRequestToolResult = {
        action: 'request_secret',
        status: 'aborted',
        secretId: answer.secretId,
        received: false,
        reason: answer.reason,
        apiPath: SECRET_REQUEST_ANSWER_API_PATH
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Secret request interrupted before input was received.'
          }
        ],
        details: result
      }
    }

    const result: SecretRequestToolResult = {
      action: 'request_secret',
      status: 'answered',
      secretId: answer.secretId,
      received: true,
      apiPath: SECRET_REQUEST_ANSWER_API_PATH
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Secret input received securely. The value was not returned to the model.'
        }
      ],
      details: result
    }
  }

  return {
    name: SECRET_REQUEST_TOOL_NAME,
    label: 'Secret Request Tool',
    description:
      'Low-level masked secret input tool for non-provider sensitive values when no domain-specific secure tool exists. MANDATORY: never ask the user to paste, type, send, or directly send secrets in normal chat. Do not use this tool for provider setup or provider API keys; use `providerConfigTool` action `setup_api_key` instead. The secret value is only delivered to the main-process caller that invoked this tool, and is never returned to the model, tool result, or chat history.',
    parameters: SecretRequestToolParamsSchema,
    execute: async (toolCallId, rawParams, signal) => {
      const params = normalizeParams(rawParams)
      return await requestSecret(buildGenericSecret(params, toolCallId), signal)
    }
  }
}

const buildGenericSecret = (
  params: SecretRequestToolParams,
  toolCallId: string
): SecretPromptParams => ({
  secretId: normalizeOptionalString(params.secretId) || `secret-request:${toolCallId}`,
  apiPath: SECRET_REQUEST_ANSWER_API_PATH,
  title: normalizeOptionalString(params.title),
  prompt: normalizeOptionalString(params.prompt) || '',
  placeholder: normalizeOptionalString(params.placeholder),
  confirmLabel: normalizeOptionalString(params.confirmLabel),
  metadata: isRecord(params.metadata)
    ? { ...params.metadata, action: 'request_secret' }
    : { action: 'request_secret' }
})

const normalizeParams = (value: unknown): SecretRequestToolParams => {
  const input = isRecord(value) ? value : {}
  return {
    action: normalizeAction(input.action),
    secretId: normalizeOptionalString(input.secretId),
    title: normalizeOptionalString(input.title),
    prompt: normalizeOptionalString(input.prompt),
    placeholder: normalizeOptionalString(input.placeholder),
    confirmLabel: normalizeOptionalString(input.confirmLabel),
    metadata: isRecord(input.metadata) ? input.metadata : undefined
  }
}

const normalizeAction = (_value: unknown): SecretRequestToolAction => 'request_secret'

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const buildInvalidResult = (
  action: SecretRequestToolAction,
  secretId: string,
  error: string
): ToolExecuteResult => {
  const result: SecretRequestToolResult = {
    action,
    status: 'invalid',
    secretId,
    received: false,
    error,
    apiPath: SECRET_REQUEST_ANSWER_API_PATH
  }
  return {
    content: [{ type: 'text' as const, text: `Secret workflow skipped: ${error}.` }],
    details: result
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
