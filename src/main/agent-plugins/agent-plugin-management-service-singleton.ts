import { AgentPluginManagementService } from './agent-plugin-management-service.ts'
import { getAgentPluginStateService } from './agent-plugin-state-service-singleton.ts'

let service: AgentPluginManagementService | null = null

export const getAgentPluginManagementService = (): AgentPluginManagementService => {
  if (!service) {
    service = new AgentPluginManagementService({
      stateService: getAgentPluginStateService()
    })
  }
  return service
}
