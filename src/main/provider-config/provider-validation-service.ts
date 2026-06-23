import type {
  ValidateProviderConfigInput,
  ProviderValidationResult
} from '../../shared/provider-config'
import type { ProviderModel } from '../../shared/providers/types.ts'
import { resolveProviderConnection } from './provider-connection-service.ts'

type ProviderValidationProbe = {
  validation: ProviderValidationResult
  models: ProviderModel[]
}

const checkedAt = (): string => new Date().toISOString()

const failure = (
  providerId: string,
  modelId: string | null,
  discoveredModelCount: number,
  errorCode: Extract<ProviderValidationResult, { ok: false }>['errorCode'],
  message: string
): ProviderValidationResult => ({
  ok: false,
  providerId,
  modelId,
  message,
  ms: null,
  checkedAt: checkedAt(),
  discoveredModelCount,
  errorCode
})

export const probeProviderValidation = async (
  input: ValidateProviderConfigInput
): Promise<ProviderValidationProbe> => {
  let resolved
  try {
    resolved = resolveProviderConnection(input.providerId, {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      settings: input.settings
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const errorCode = message.startsWith('Unknown provider')
      ? 'missing_provider'
      : 'missing_adapter'
    return {
      validation: failure(input.providerId, input.modelId ?? null, 0, errorCode, message),
      models: []
    }
  }

  const { provider, adapter, connection } = resolved
  if (!connection.apiKey.trim()) {
    return {
      validation: failure(
        provider.id,
        input.modelId ?? null,
        0,
        'missing_api_key',
        '请输入 API Key'
      ),
      models: []
    }
  }

  let models: ProviderModel[] = []
  try {
    models = await adapter.listModels(connection)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      validation: failure(
        provider.id,
        input.modelId ?? null,
        0,
        'list_models_failed',
        message.slice(0, 180)
      ),
      models: []
    }
  }

  const probeModelId = String(input.modelId ?? models[0]?.modelId ?? '').trim() || null
  if (!probeModelId) {
    return {
      validation: {
        ok: true,
        providerId: provider.id,
        modelId: null,
        message: `连接成功，但未发现可用模型`,
        ms: null,
        checkedAt: checkedAt(),
        discoveredModelCount: models.length
      },
      models
    }
  }

  const result = await adapter.probeInference(connection, probeModelId)
  if (!result.ok) {
    return {
      validation: failure(
        provider.id,
        probeModelId,
        models.length,
        'probe_failed',
        result.error.slice(0, 180)
      ),
      models
    }
  }

  return {
    validation: {
      ok: true,
      providerId: provider.id,
      modelId: probeModelId,
      message: `连接成功，发现 ${models.length} 个模型，探测耗时 ${result.ms}ms`,
      ms: result.ms,
      checkedAt: checkedAt(),
      discoveredModelCount: models.length
    },
    models
  }
}

export const validateProviderConnection = async (
  input: ValidateProviderConfigInput
): Promise<ProviderValidationResult> => {
  const result = await probeProviderValidation(input)
  return result.validation
}
