import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import {
  clearProviderApiKey,
  getProviderApiKey,
  getProviderApiKeyByRuntimeProvider,
  getProviderByRuntimeProvider,
  listProviders,
  setProviderApiKey
} from '../db/config-db.ts'

/**
 * CredentialStore backed by PiAgent GUI config.db (provider_secrets).
 *
 * ModelRuntime / pi-ai key credentials by Provider.id, which in this host is the
 * GUI `runtime_provider` (e.g. "openai", "anthropic"). GUI rows may use a
 * different primary id (custom_*), so all reads go through runtime_provider.
 *
 * Persistence for api_key stays in encrypted provider_secrets. OAuth is not
 * written through this store yet — login/logout for OAuth remains app-owned.
 */
export class GuiCredentialStore implements CredentialStore {
  private readonly chains = new Map<string, Promise<unknown>>()

  private enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve()
    const next = (async () => {
      await previous.catch(() => undefined)
      return task()
    })()
    this.chains.set(
      providerId,
      next.then(
        () => undefined,
        () => undefined
      )
    )
    return next
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const key = getProviderApiKeyByRuntimeProvider(providerId)?.trim()
    if (!key) return undefined
    return { type: 'api_key', key }
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const seen = new Set<string>()
    const out: CredentialInfo[] = []
    for (const provider of listProviders()) {
      const runtimeProvider = String(provider.runtimeProvider ?? '').trim()
      if (!runtimeProvider || seen.has(runtimeProvider)) continue
      const key = getProviderApiKey(provider.id)?.trim()
      if (!key) continue
      seen.add(runtimeProvider)
      out.push({ providerId: runtimeProvider, type: 'api_key' })
    }
    return out
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      const current = await this.read(providerId)
      const next = await fn(current)
      if (next === undefined) return current

      if (next.type === 'api_key') {
        const guiProvider = getProviderByRuntimeProvider(providerId)
        const key = typeof next.key === 'string' ? next.key.trim() : ''
        if (!guiProvider) {
          // No GUI row mapped to this runtime provider — keep in-memory only via caller.
          return next
        }
        if (key) {
          setProviderApiKey(guiProvider.id, key)
        } else {
          clearProviderApiKey(guiProvider.id)
        }
        return key ? { type: 'api_key', key } : undefined
      }

      // OAuth and other credential types are not persisted in provider_secrets yet.
      return next
    })
  }

  delete(providerId: string): Promise<void> {
    return this.enqueue(providerId, async () => {
      const guiProvider = getProviderByRuntimeProvider(providerId)
      if (guiProvider) clearProviderApiKey(guiProvider.id)
    })
  }
}
