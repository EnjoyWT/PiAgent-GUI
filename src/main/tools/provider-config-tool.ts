import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type { RuntimeSurfaceToolContext } from '../runtime-host/runtime-surface/runtime-surface-types.ts'
import type { RuntimeUserInteractionController } from '../runtime-host/user-interaction-controller.ts'
import type { ProviderConfigService } from '../provider-config/provider-config-service.ts'

type CreateProviderConfigToolOptions = {
  interactionController: RuntimeUserInteractionController
  context: RuntimeSurfaceToolContext
  providerConfigService: ProviderConfigService
}

const settingsSchema = Type.Optional(Type.Record(Type.String(), Type.Unknown()))

const sanitizeDetail = (
  detail: Awaited<ReturnType<ProviderConfigService['getProviderDetail']>>
) => ({
  id: detail.id,
  displayName: detail.displayName,
  runtimeProvider: detail.runtimeProvider,
  enabled: detail.enabled,
  baseUrl: detail.baseUrl,
  settings: detail.settings,
  hasApiKey: detail.hasApiKey,
  modelCount: detail.modelCount,
  models: detail.models
})

const redactSecretFromText = (value: string, secret: string): string =>
  secret ? value.split(secret).join('[REDACTED_SECRET]') : value

const redactValidationSecret = <T extends { message: string }>(
  validation: T,
  secret: string
): T => ({
  ...validation,
  message: redactSecretFromText(validation.message, secret)
})

export const createProviderConfigTool = ({
  interactionController,
  context,
  providerConfigService
}: CreateProviderConfigToolOptions): ToolDefinition => ({
  name: 'providerConfigTool',
  label: 'Provider Config Tool',
  description:
    'Single canonical tool for provider setup, provider validation, model sync, and provider API key configuration. MANDATORY for provider API keys: never ask the user to paste, type, send, or directly send an API key in normal chat. If a provider API key is needed and providerId is known, call action `setup_api_key` immediately; it opens masked secret input, validates the key, saves it, syncs models, and never exposes the secret to the model.',
  parameters: Type.Object({
    action: Type.String({
      enum: [
        'list_providers',
        'get_provider_detail',
        'upsert_provider',
        'validate',
        'fetch_models',
        'set_model_enabled',
        'setup_api_key'
      ]
    }),
    providerId: Type.Optional(Type.String()),
    displayName: Type.Optional(Type.String()),
    runtimeProvider: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    modelId: Type.Optional(Type.String()),
    baseUrl: Type.Optional(Type.String()),
    settings: settingsSchema
  }),
  execute: async (_toolCallId, params, signal) => {
    const input = isRecord(params) ? params : {}
    const action = String(input.action ?? '').trim()
    const providerId = String(input.providerId ?? '').trim()
    const settings = isRecord(input.settings) ? input.settings : undefined

    if (action === 'list_providers') {
      const providers = await providerConfigService.listProviders()
      const summary =
        providers.length === 0
          ? '没有可用 provider。'
          : providers
              .map(
                (provider) =>
                  `${provider.displayName} (${provider.id}) - ${provider.hasApiKey ? '已配置 Key' : '未配置 Key'}`
              )
              .join('\n')
      return {
        content: [{ type: 'text' as const, text: summary }],
        details: { providers }
      }
    }

    if (!providerId) {
      return {
        content: [{ type: 'text' as const, text: 'providerId 是必填参数。' }],
        details: { ok: false, error: 'providerId is required' }
      }
    }

    if (action === 'get_provider_detail') {
      const detail = await providerConfigService.getProviderDetail(providerId)
      const sanitized = sanitizeDetail(detail)
      return {
        content: [
          {
            type: 'text' as const,
            text: `${detail.displayName} (${detail.id})，${detail.hasApiKey ? '已配置 API Key' : '未配置 API Key'}，当前缓存 ${detail.modelCount} 个模型。`
          }
        ],
        details: sanitized
      }
    }

    if (action === 'upsert_provider') {
      const detail = await providerConfigService.upsertProvider({
        id: providerId,
        displayName: String(input.displayName ?? '').trim() || providerId,
        runtimeProvider: String(input.runtimeProvider ?? '').trim() || providerId,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
        baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : null,
        settings
      })
      const sanitized = sanitizeDetail(detail)
      return {
        content: [
          {
            type: 'text' as const,
            text: `已更新 provider ${detail.displayName} (${detail.id})。`
          }
        ],
        details: sanitized
      }
    }

    if (action === 'validate') {
      const validation = await providerConfigService.validate({
        providerId,
        modelId: typeof input.modelId === 'string' ? input.modelId : null,
        baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : null,
        settings
      })
      return {
        content: [{ type: 'text' as const, text: validation.message }],
        details: validation
      }
    }

    if (action === 'fetch_models') {
      const result = await providerConfigService.fetchModels({
        providerId,
        baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : null,
        settings
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `已同步 ${result.modelCount} 个模型到 ${providerId}。`
          }
        ],
        details: result
      }
    }

    if (action === 'set_model_enabled') {
      const modelId = String(input.modelId ?? '').trim()
      if (!modelId) {
        return {
          content: [{ type: 'text' as const, text: 'modelId 是必填参数。' }],
          details: { ok: false, error: 'modelId is required' }
        }
      }
      const detail = await providerConfigService.setModelEnabled({
        providerId,
        modelId,
        enabled: Boolean(input.enabled)
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `已${input.enabled ? '启用' : '禁用'}模型 ${modelId}。`
          }
        ],
        details: sanitizeDetail(detail)
      }
    }

    if (action === 'setup_api_key') {
      const detail = await providerConfigService.getProviderDetail(providerId)
      const secret = await interactionController.requestSecretInput(
        context,
        {
          secretId: `provider-api-key:${providerId}`,
          title: `${detail.displayName} API Key`,
          prompt: `请输入 ${detail.displayName} 的 API Key。这个值不会回传给模型，也不会写入聊天记录。`,
          placeholder: '安全输入，不会回显到对话',
          confirmLabel: '验证并保存'
        },
        signal
      )

      if (secret.status !== 'answered') {
        return {
          content: [{ type: 'text' as const, text: 'API Key 配置已取消。' }],
          details: secret
        }
      }

      const result = await providerConfigService.setupApiKey({
        providerId,
        apiKey: secret.value,
        modelId: typeof input.modelId === 'string' ? input.modelId : null,
        baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : null,
        settings
      })
      const validation = redactValidationSecret(result.validation, secret.value)

      return {
        content: [{ type: 'text' as const, text: validation.message }],
        details: {
          providerId: result.providerId,
          saved: result.saved,
          validation,
          modelCount: result.modelCount
        }
      }
    }

    return {
      content: [{ type: 'text' as const, text: `不支持的 action: ${action}` }],
      details: { ok: false, error: `Unsupported action: ${action}` }
    }
  }
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
