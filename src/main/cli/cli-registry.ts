import { createCliFailureResult } from './cli-errors'
import type { CliExecuteRequest, CliExecuteResult, CliHandler } from './cli-types'
import { registerPluginsCliModule } from './modules/plugins-cli-module'
import { registerSkillsCliModule } from './modules/skills-cli-module'
import { registerTestCliModule } from './modules/test-cli-module'
import { registerDatabaseCleanupCliModule } from './modules/database-cleanup-cli-module'
import { registerMcpCliModule } from './modules/mcp-cli-module'

export class CliRegistry {
  private readonly handlers = new Map<string, CliHandler>()

  register(moduleName: string, actionName: string, handler: CliHandler): void {
    this.handlers.set(this.getKey(moduleName, actionName), handler)
  }

  async execute(request: CliExecuteRequest): Promise<CliExecuteResult> {
    const handler = this.handlers.get(this.getKey(request.module, request.action))
    if (!handler) {
      return createCliFailureResult(4, `Unknown CLI command: ${request.module} ${request.action}`)
    }
    return await handler(request)
  }

  private getKey(moduleName: string, actionName: string): string {
    return `${moduleName.trim().toLowerCase()}:${actionName.trim().toLowerCase()}`
  }
}

export const createCliRegistry = (): CliRegistry => {
  const registry = new CliRegistry()
  registerPluginsCliModule(registry)
  registerSkillsCliModule(registry)
  registerMcpCliModule(registry)
  registerTestCliModule(registry)
  registerDatabaseCleanupCliModule(registry)
  return registry
}
