import { discoverExternalPluginModules } from '../plugin-system/external-plugin-loader.ts'
import {
  adaptImTransportPluginToTransportPlugin,
  isImTransportPlugin
} from '../im/im-transport-adapter.ts'
import { PluginHost } from '../plugin-system/plugin-host.ts'
import {
  createConsolePluginLogger,
  type BuiltinPluginModule,
  type PluginManifest,
  type PluginRegistration
} from '../plugin-system/plugin-types.ts'
import type {
  DeliveryCommand,
  DeliveryResult,
  TransportAccountRuntimeState,
  TransportAccountStatusChange,
  TransportConnectError,
  TransportInboundHandler,
  TransportPlugin,
  TransportTargetEntry,
  TransportTargetListQuery,
  TransportRegisterContext
} from './transport-contract.ts'
import type { TransportAccountStatus } from '../doctor/doctor-types.ts'
import type {
  TransportPluginAccountRuntimeConfig,
  TransportPluginAccountSetupEvent,
  TransportPluginAccountSetupStartInput,
  TransportPluginAccountSetupStartResult
} from '../../shared/transport-plugins.ts'

export type TransportHostStatus = {
  pluginId: string
  displayName: string
  version: string
  sourceKind: PluginRegistration<TransportPlugin>['sourceKind']
  state: PluginRegistration<TransportPlugin>['state']
  error?: string | null
}

export type TransportHostOptions = {
  getAccountConfig?: (
    manifest: PluginManifest,
    accountId: string
  ) => TransportPluginAccountRuntimeConfig | null
}

export class TransportHost {
  private readonly pluginHost: PluginHost<TransportPlugin, TransportRegisterContext>
  private readonly inboundHandlers = new Set<TransportInboundHandler>()
  private readonly accountSetupHandlers = new Set<
    (event: TransportPluginAccountSetupEvent) => Promise<void> | void
  >()
  private readonly unsubscribeByPluginId = new Map<string, () => void>()
  private readonly unsubscribeStatusByPluginId = new Map<string, () => void>()
  private readonly unsubscribeSetupByPluginId = new Map<string, () => void>()
  private readonly adaptedImPluginsByPluginId = new Map<string, TransportPlugin>()
  private readonly connectedAccounts = new Map<string, Set<string>>()
  private readonly accountStatuses = new Map<string, Map<string, TransportAccountStatus>>()

  constructor(options: TransportHostOptions = {}) {
    this.pluginHost = new PluginHost<TransportPlugin, TransportRegisterContext>({
      kind: 'transport',
      createContext: (pluginId) => ({
        logger: createConsolePluginLogger(pluginId),
        getAccountConfig: (accountId) => {
          const manifest = this.pluginHost
            .list()
            .find((registration) => registration.manifest.id === pluginId)?.manifest
          return manifest ? (options.getAccountConfig?.(manifest, accountId) ?? null) : null
        }
      })
    })
  }

  discoverBuiltin(module: BuiltinPluginModule<TransportPlugin, TransportRegisterContext>): void {
    this.pluginHost.discoverBuiltin(module)
  }

  async discoverExternal(directories?: string[]): Promise<void> {
    const discovered = await discoverExternalPluginModules<
      TransportPlugin,
      TransportRegisterContext
    >({
      kind: 'transport',
      directories,
      sourceKind: 'user'
    })
    for (const item of discovered) {
      this.pluginHost.discoverBuiltin(item.module, item.sourceKind)
    }
  }

  async activateAll(): Promise<void> {
    await this.pluginHost.activateAll()
    for (const registration of this.pluginHost.list()) {
      this.attachInboundHandler(registration)
      this.attachAccountStatusHandler(registration)
      this.attachAccountSetupHandler(registration)
    }
  }

  async activate(transportId: string): Promise<void> {
    await this.pluginHost.activate(transportId)
    const registration = this.pluginHost.list().find((item) => item.manifest.id === transportId)
    if (registration) {
      this.attachInboundHandler(registration)
      this.attachAccountStatusHandler(registration)
      this.attachAccountSetupHandler(registration)
    }
  }

  async connect(transportId: string, accountId: string): Promise<void> {
    if (this.connectedAccounts.get(transportId)?.has(accountId)) {
      this.writeAccountStatus(transportId, accountId, 'connected')
      return
    }

    this.writeAccountStatus(transportId, accountId, 'connecting')
    try {
      const plugin = this.getTransport(transportId)
      await plugin.connect(accountId)
      const accounts = this.connectedAccounts.get(transportId) ?? new Set<string>()
      accounts.add(accountId)
      this.connectedAccounts.set(transportId, accounts)
      this.writeAccountStatus(transportId, accountId, 'connected')
    } catch (error) {
      const failure = this.resolveAccountFailure(error)
      this.writeAccountStatus(transportId, accountId, failure.state, error, failure.errorCode)
      throw error
    }
  }

  async disconnect(transportId: string, accountId: string): Promise<void> {
    if (!this.connectedAccounts.get(transportId)?.has(accountId)) {
      this.writeAccountStatus(transportId, accountId, 'disconnected')
      return
    }

    try {
      const plugin = this.getTransport(transportId)
      await plugin.disconnect(accountId)
      const accounts = this.connectedAccounts.get(transportId)
      accounts?.delete(accountId)
      this.writeAccountStatus(transportId, accountId, 'disconnected')
    } catch (error) {
      const failure = this.resolveAccountFailure(error)
      this.writeAccountStatus(transportId, accountId, failure.state, error, failure.errorCode)
      throw error
    }
  }

  onInbound(handler: TransportInboundHandler): () => void {
    this.inboundHandlers.add(handler)
    return () => this.inboundHandlers.delete(handler)
  }

  async emitInbound(envelope: Parameters<TransportInboundHandler>[0]): Promise<void> {
    for (const handler of this.inboundHandlers) {
      await handler(envelope)
    }
  }

  onAccountSetupEvent(
    handler: (event: TransportPluginAccountSetupEvent) => Promise<void> | void
  ): () => void {
    this.accountSetupHandlers.add(handler)
    return () => this.accountSetupHandlers.delete(handler)
  }

  async startAccountSetup(
    transportId: string,
    input: TransportPluginAccountSetupStartInput
  ): Promise<TransportPluginAccountSetupStartResult> {
    await this.activate(transportId)
    const plugin = this.getTransport(transportId)
    if (typeof plugin.startAccountSetup !== 'function') {
      throw new Error(`Transport plugin does not support account setup sessions: ${transportId}`)
    }
    const result = await plugin.startAccountSetup(input)
    return {
      ...result,
      pluginId: transportId,
      accountId: result.accountId || input.accountId,
      methodId: result.methodId || input.methodId,
      events: result.events?.map((event) =>
        this.withAccountSetupEventOwner(
          transportId,
          result.accountId || input.accountId,
          result.methodId || input.methodId,
          event
        )
      )
    }
  }

  async cancelAccountSetup(transportId: string, sessionId: string): Promise<void> {
    const plugin = this.getTransport(transportId)
    if (typeof plugin.cancelAccountSetup !== 'function') return
    await plugin.cancelAccountSetup(sessionId)
  }

  async send(command: DeliveryCommand): Promise<DeliveryResult> {
    const plugin = this.getTransport(command.transportId)
    return await plugin.send(command)
  }

  async getCapabilities(transportId: string, accountId: string) {
    const plugin = this.getTransport(transportId)
    return await plugin.getCapabilities(accountId)
  }

  async listTargets(
    transportId: string,
    input: TransportTargetListQuery
  ): Promise<TransportTargetEntry[]> {
    const plugin = this.getTransport(transportId)
    if (typeof plugin.listTargets !== 'function') return []
    return await plugin.listTargets(input)
  }

  listStatuses(): TransportHostStatus[] {
    return this.pluginHost.list().map((registration) => ({
      pluginId: registration.manifest.id,
      displayName: registration.manifest.displayName,
      version: registration.manifest.version,
      sourceKind: registration.sourceKind,
      state: registration.state,
      error: registration.error ?? null
    }))
  }

  listRegistrations(): Array<PluginRegistration<TransportPlugin>> {
    return this.pluginHost.list()
  }

  listConnectedAccounts(transportId: string): string[] {
    return [...(this.connectedAccounts.get(transportId) ?? new Set<string>())]
  }

  getAccountStatuses(transportId: string): TransportAccountStatus[] {
    const accountStatuses = this.accountStatuses.get(transportId)
    if (!accountStatuses) return []
    return Array.from(accountStatuses.values()).map((status) => ({ ...status }))
  }

  async shutdown(): Promise<void> {
    for (const [transportId, accounts] of this.connectedAccounts.entries()) {
      for (const accountId of accounts) {
        await this.disconnect(transportId, accountId)
      }
    }
    for (const unsubscribe of this.unsubscribeByPluginId.values()) {
      unsubscribe()
    }
    this.unsubscribeByPluginId.clear()
    for (const unsubscribe of this.unsubscribeStatusByPluginId.values()) {
      unsubscribe()
    }
    this.unsubscribeStatusByPluginId.clear()
    for (const unsubscribe of this.unsubscribeSetupByPluginId.values()) {
      unsubscribe()
    }
    this.unsubscribeSetupByPluginId.clear()
  }

  private getTransport(transportId: string): TransportPlugin {
    const plugin = this.pluginHost.get(transportId)
    if (!plugin) throw new Error(`Transport plugin is not activated: ${transportId}`)
    if (isImTransportPlugin(plugin)) {
      const existing = this.adaptedImPluginsByPluginId.get(transportId)
      if (existing) return existing
      const adapted = adaptImTransportPluginToTransportPlugin(plugin)
      this.adaptedImPluginsByPluginId.set(transportId, adapted)
      return adapted
    }
    return plugin
  }

  private attachInboundHandler(registration: PluginRegistration<TransportPlugin>): void {
    if (registration.state !== 'activated' || !registration.plugin) return
    if (this.unsubscribeByPluginId.has(registration.manifest.id)) return

    const plugin = this.getTransport(registration.manifest.id)
    const unsubscribe = plugin.onInbound(async (envelope) => {
      await this.emitInbound(envelope)
    })
    this.unsubscribeByPluginId.set(registration.manifest.id, unsubscribe)
  }

  private attachAccountStatusHandler(registration: PluginRegistration<TransportPlugin>): void {
    if (registration.state !== 'activated' || !registration.plugin?.onAccountStatusChange) return
    if (this.unsubscribeStatusByPluginId.has(registration.manifest.id)) return

    const unsubscribe = registration.plugin.onAccountStatusChange(
      async (status: TransportAccountStatusChange) => {
        const accountId = String(status.accountId ?? '').trim()
        if (!accountId) return

        if (status.state === 'connected') {
          const accounts = this.connectedAccounts.get(registration.manifest.id) ?? new Set<string>()
          accounts.add(accountId)
          this.connectedAccounts.set(registration.manifest.id, accounts)
        } else if (
          status.state === 'connecting' ||
          status.state === 'retrying' ||
          status.state === 'disconnected' ||
          status.state === 'fatal'
        ) {
          this.connectedAccounts.get(registration.manifest.id)?.delete(accountId)
        }

        this.writeAccountStatus(
          registration.manifest.id,
          accountId,
          status.state,
          status.error,
          status.errorCode
        )
      }
    )
    this.unsubscribeStatusByPluginId.set(registration.manifest.id, unsubscribe)
  }

  private attachAccountSetupHandler(registration: PluginRegistration<TransportPlugin>): void {
    if (registration.state !== 'activated' || !registration.plugin) return
    if (this.unsubscribeSetupByPluginId.has(registration.manifest.id)) return

    const plugin = this.getTransport(registration.manifest.id)
    if (typeof plugin.onAccountSetupEvent !== 'function') return
    const unsubscribe = plugin.onAccountSetupEvent(async (event) => {
      const accountId = String(event.accountId ?? '').trim()
      const methodId = String(event.methodId ?? '').trim()
      await this.emitAccountSetupEvent(
        this.withAccountSetupEventOwner(registration.manifest.id, accountId, methodId, event)
      )
    })
    this.unsubscribeSetupByPluginId.set(registration.manifest.id, unsubscribe)
  }

  private async emitAccountSetupEvent(event: TransportPluginAccountSetupEvent): Promise<void> {
    for (const handler of this.accountSetupHandlers) {
      await handler(event)
    }
  }

  private withAccountSetupEventOwner(
    transportId: string,
    accountId: string,
    methodId: string,
    event: TransportPluginAccountSetupEvent
  ): TransportPluginAccountSetupEvent {
    return {
      ...event,
      pluginId: event.pluginId ?? transportId,
      accountId: event.accountId ?? accountId,
      methodId: event.methodId ?? methodId
    } as TransportPluginAccountSetupEvent
  }

  private writeAccountStatus(
    transportId: string,
    accountId: string,
    state: TransportAccountRuntimeState,
    error?: unknown,
    errorCode?: string | null
  ): void {
    const existingStatuses =
      this.accountStatuses.get(transportId) ?? new Map<string, TransportAccountStatus>()
    const previous = existingStatuses.get(accountId)
    const now = new Date().toISOString()
    const errorText = error instanceof Error ? error.message : error ? String(error) : null
    const nextErrorCode = errorCode ? String(errorCode) : (previous?.errorCode ?? null)

    existingStatuses.set(accountId, {
      transportId,
      accountId,
      state,
      error: errorText,
      errorCode: errorText ? nextErrorCode : null,
      lastAttemptAt:
        state === 'connecting' || state === 'connected' || state === 'retrying' || state === 'fatal'
          ? now
          : (previous?.lastAttemptAt ?? null),
      lastSuccessAt: state === 'connected' ? now : (previous?.lastSuccessAt ?? null),
      lastFailureAt:
        state === 'retrying' || state === 'fatal' ? now : (previous?.lastFailureAt ?? null),
      updatedAt: now
    })

    this.accountStatuses.set(transportId, existingStatuses)
  }

  private resolveAccountFailure(error: unknown): {
    state: Extract<TransportAccountRuntimeState, 'retrying' | 'fatal'>
    errorCode: string | null
  } {
    if (error instanceof Error && 'retryable' in error) {
      const transportError = error as TransportConnectError
      return {
        state: transportError.retryable === false ? 'fatal' : 'retrying',
        errorCode:
          typeof transportError.code === 'string' && transportError.code.trim()
            ? transportError.code.trim()
            : null
      }
    }

    if (error && typeof error === 'object') {
      const record = error as {
        retryable?: unknown
        fatal?: unknown
        code?: unknown
        errorCode?: unknown
      }
      const code =
        typeof record.errorCode === 'string'
          ? record.errorCode
          : typeof record.code === 'string'
            ? record.code
            : null

      if (record.retryable === false || record.fatal === true) {
        return { state: 'fatal', errorCode: code }
      }
      if (record.retryable === true) {
        return { state: 'retrying', errorCode: code }
      }
    }

    return { state: 'retrying', errorCode: null }
  }
}
