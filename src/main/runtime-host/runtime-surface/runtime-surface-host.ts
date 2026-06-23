import { PluginHost } from '../../plugin-system/plugin-host.ts'
import type { ConversationSourceKind } from '../../core-v2/domain.ts'
import { imRuntimeSurfaceModule } from './builtin/im-runtime-surface.ts'
import { localRuntimeSurfaceModule } from './builtin/local-runtime-surface.ts'
import type {
  BuiltinRuntimeSurfaceModule,
  RuntimeSurfacePlugin,
  RuntimeSurfaceRegisterContext
} from './runtime-surface-types.ts'

export class RuntimeSurfaceHost {
  private readonly pluginHost = new PluginHost<RuntimeSurfacePlugin, RuntimeSurfaceRegisterContext>(
    {
      kind: 'runtime-surface'
    }
  )
  private readonly pluginIdBySourceKind = new Map<ConversationSourceKind, string>()

  constructor() {
    this.discoverBuiltin(localRuntimeSurfaceModule)
    this.discoverBuiltin(imRuntimeSurfaceModule)
  }

  discoverBuiltin(module: BuiltinRuntimeSurfaceModule): void {
    this.pluginHost.discoverBuiltin(module)
    this.pluginIdBySourceKind.set(module.sourceKind, module.manifest.id)
  }

  async getSurface(sourceKind: ConversationSourceKind): Promise<RuntimeSurfacePlugin> {
    const pluginId = this.pluginIdBySourceKind.get(sourceKind)
    if (!pluginId) throw new Error(`Runtime surface plugin is not registered for ${sourceKind}`)
    return await this.pluginHost.activate(pluginId)
  }
}
