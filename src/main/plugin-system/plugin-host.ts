import {
  createConsolePluginLogger,
  validatePluginManifest,
  type BuiltinPluginModule,
  type PluginKind,
  type PluginRegisterContext,
  type PluginRegistration,
  type PluginSourceKind
} from './plugin-types.ts'

export type PluginHostOptions<TContext extends PluginRegisterContext> = {
  kind: PluginKind
  createContext?: (pluginId: string) => TContext
}

export class PluginHost<TPlugin, TContext extends PluginRegisterContext = PluginRegisterContext> {
  private readonly kind: PluginKind
  private readonly createContext: (pluginId: string) => TContext
  private readonly modules = new Map<string, BuiltinPluginModule<TPlugin, TContext>>()
  private readonly registrations = new Map<string, PluginRegistration<TPlugin>>()

  constructor(options: PluginHostOptions<TContext>) {
    this.kind = options.kind
    this.createContext =
      options.createContext ??
      ((pluginId: string) =>
        ({
          logger: createConsolePluginLogger(pluginId)
        }) as TContext)
  }

  discoverBuiltin(
    module: BuiltinPluginModule<TPlugin, TContext>,
    sourceKind: PluginSourceKind = 'builtin'
  ): PluginRegistration<TPlugin> {
    const manifest = validatePluginManifest(module.manifest)
    if (manifest.kind !== this.kind) {
      throw new Error(`Plugin ${manifest.id} has kind ${manifest.kind}, expected ${this.kind}`)
    }
    if (this.registrations.has(manifest.id)) {
      throw new Error(`Duplicate plugin id: ${manifest.id}`)
    }

    const registration: PluginRegistration<TPlugin> = {
      manifest,
      sourceKind,
      state: 'discovered',
      error: null
    }
    this.modules.set(manifest.id, module)
    this.registrations.set(manifest.id, registration)
    return registration
  }

  async activate(id: string): Promise<TPlugin> {
    const registration = this.registrations.get(id)
    if (!registration) throw new Error(`Unknown plugin: ${id}`)
    if (registration.state === 'activated' && registration.plugin) return registration.plugin

    const module = this.modules.get(id)
    if (!module) throw new Error(`Plugin module not loaded: ${id}`)

    try {
      const plugin = await module.register(this.createContext(id))
      const next: PluginRegistration<TPlugin> = {
        ...registration,
        state: 'activated',
        plugin,
        error: null
      }
      this.registrations.set(id, next)
      return plugin
    } catch (error) {
      this.registrations.set(id, {
        ...registration,
        state: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  async activateAll(): Promise<TPlugin[]> {
    const plugins: TPlugin[] = []
    for (const id of this.registrations.keys()) {
      plugins.push(await this.activate(id))
    }
    return plugins
  }

  deactivate(id: string): void {
    const registration = this.registrations.get(id)
    if (!registration) return
    this.registrations.set(id, {
      ...registration,
      state: 'deactivated',
      plugin: undefined
    })
  }

  get(id: string): TPlugin | null {
    return this.registrations.get(id)?.plugin ?? null
  }

  list(): Array<PluginRegistration<TPlugin>> {
    return [...this.registrations.values()].map((registration) => ({ ...registration }))
  }
}
