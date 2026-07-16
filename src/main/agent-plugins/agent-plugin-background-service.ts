import { app } from 'electron'
import {
  DefaultResourceLoader,
  type ExtensionFactory,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'
import { getDefaultAgentDir } from '../paths.ts'
import {
  resolveAgentPluginResources,
  type PluginMcpServerConfig
} from './agent-plugin-resource-resolver.ts'
import type { AgentPluginDiagnostic } from './agent-plugin-discovery.ts'

type BackgroundLoader = {
  reload: () => Promise<void>
  getExtensions: () => {
    errors: Array<{ path: string; error: string }>
  }
}

type BackgroundResourceSnapshot = {
  skillPaths: string[]
  mcpServers: PluginMcpServerConfig[]
  tools: ToolDefinition[]
  extensionPaths: string[]
  extensionFactories: ExtensionFactory[]
  diagnostics: AgentPluginDiagnostic[]
  signature: string
}

type BackgroundLoaderOptions = {
  cwd: string
  agentDir: string
  additionalExtensionPaths: string[]
  extensionFactories: ExtensionFactory[]
  noExtensions: boolean
}

export type AgentPluginBackgroundExtensionStartResult = {
  loaded: boolean
  extensionPathCount: number
  errors: Array<{ path: string; error: string }>
}

export type AgentPluginBackgroundExtensionServiceOptions = {
  cwd?: () => string
  agentDir?: () => string
  resolveResources?: () => Promise<BackgroundResourceSnapshot>
  createLoader?: (options: BackgroundLoaderOptions) => BackgroundLoader
}

const logDiagnostics = (diagnostics: readonly unknown[], prefix: string): void => {
  for (const diagnostic of diagnostics) {
    console.warn(prefix, diagnostic)
  }
}

export class AgentPluginBackgroundExtensionService {
  private readonly cwd: () => string
  private readonly agentDir: () => string
  private readonly resolveResources: () => Promise<BackgroundResourceSnapshot>
  private readonly createLoader: (options: BackgroundLoaderOptions) => BackgroundLoader
  private loader: BackgroundLoader | null = null
  private signature = ''

  constructor(options: AgentPluginBackgroundExtensionServiceOptions = {}) {
    this.cwd = options.cwd ?? (() => app.getPath('userData'))
    this.agentDir = options.agentDir ?? getDefaultAgentDir
    this.resolveResources = options.resolveResources ?? resolveAgentPluginResources
    this.createLoader =
      options.createLoader ??
      ((loaderOptions) => new DefaultResourceLoader(loaderOptions) as BackgroundLoader)
  }

  async start(): Promise<AgentPluginBackgroundExtensionStartResult> {
    const resources = await this.resolveResources()
    if (resources.extensionPaths.length === 0 && resources.extensionFactories.length === 0) {
      this.signature = resources.signature
      return {
        loaded: false,
        extensionPathCount: 0,
        errors: []
      }
    }

    if (this.loader && this.signature === resources.signature) {
      return {
        loaded: false,
        extensionPathCount: resources.extensionPaths.length,
        errors: this.loader.getExtensions().errors
      }
    }

    const loader = this.createLoader({
      cwd: this.cwd(),
      agentDir: this.agentDir(),
      additionalExtensionPaths: resources.extensionFactories.length > 0 ? [] : resources.extensionPaths,
      extensionFactories: resources.extensionFactories,
      noExtensions: true
    })
    await loader.reload()

    const errors = loader.getExtensions().errors
    if (resources.diagnostics.length > 0) {
      logDiagnostics(resources.diagnostics, 'Agent plugin background diagnostic')
    }
    if (errors.length > 0) {
      logDiagnostics(errors, 'Agent plugin background extension error')
    }

    this.loader = loader
    this.signature = resources.signature
    return {
      loaded: true,
      extensionPathCount: resources.extensionPaths.length,
      errors
    }
  }
}

let backgroundExtensionService: AgentPluginBackgroundExtensionService | null = null

export const getAgentPluginBackgroundExtensionService =
  (): AgentPluginBackgroundExtensionService => {
    if (!backgroundExtensionService) {
      backgroundExtensionService = new AgentPluginBackgroundExtensionService()
    }
    return backgroundExtensionService
  }

export const startAgentPluginBackgroundExtensions =
  async (): Promise<AgentPluginBackgroundExtensionStartResult> =>
    getAgentPluginBackgroundExtensionService().start()
