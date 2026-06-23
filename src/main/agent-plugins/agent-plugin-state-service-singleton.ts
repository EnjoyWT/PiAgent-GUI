import { getConfigDb } from '../db/config-db.ts'
import { AgentPluginStateService } from './agent-plugin-state-service.ts'

let service: AgentPluginStateService | null = null

export const getAgentPluginStateService = (): AgentPluginStateService => {
  if (!service) service = new AgentPluginStateService(getConfigDb())
  return service
}
