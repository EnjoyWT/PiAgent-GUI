import { getLocalRuntimeHostService } from '../runtime-host/local-runtime-host.ts'

export const invalidateProviderRuntime = async (providerId: string): Promise<void> => {
  const host = await getLocalRuntimeHostService()
  await host.invalidateProvider(providerId)
}
