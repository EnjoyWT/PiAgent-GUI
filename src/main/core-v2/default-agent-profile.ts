import type {
  AgentProfile,
  CoreCommandService,
  CoreQueryService,
  ExecutionPolicy
} from './domain.ts'

export const DEFAULT_AGENT_PROFILE_ID = 'default'
export const DEFAULT_AGENT_PROFILE_SLUG = 'default'
export const DEFAULT_AGENT_PROFILE_DISPLAY_NAME = 'Default'

export const buildDefaultAgentProfileExecutionPolicy = (): ExecutionPolicy => ({
  model: {
    providerId: 'google',
    modelId: 'gemini-2.5-flash',
    reasoningLevel: 'medium'
  },
  contextEngineId: 'global-context-engine',
  memoryProviderId: 'global-memory-provider',
  toolProfileId: 'default',
  sandboxPolicyId: 'workspace-write'
})

export const ensureDefaultAgentProfile = (
  core: Pick<CoreCommandService & CoreQueryService, 'getAgentProfile' | 'upsertAgentProfile'>
): AgentProfile => {
  const existing = core.getAgentProfile(DEFAULT_AGENT_PROFILE_ID)
  if (existing) return existing

  return core.upsertAgentProfile({
    id: DEFAULT_AGENT_PROFILE_ID,
    slug: DEFAULT_AGENT_PROFILE_SLUG,
    displayName: DEFAULT_AGENT_PROFILE_DISPLAY_NAME,
    isDefault: true,
    enabledTransportIds: ['desktop-chat'],
    defaultExecutionPolicy: buildDefaultAgentProfileExecutionPolicy()
  })
}
