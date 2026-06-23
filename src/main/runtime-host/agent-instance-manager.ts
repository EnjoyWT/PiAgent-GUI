import { generateId } from '../../shared/id.ts'
import type {
  AgentInstance,
  AgentInstanceStatus,
  Conversation,
  CoreQueryService,
  ExecutionPolicy
} from '../core-v2/domain.ts'
import { mergeExecutionPolicy } from '../core-v2/domain.ts'

export type AcquireAgentInstanceInput = {
  conversationId: string
  reloadReason?: AgentInstance['lastReloadReason']
}

export type AgentInstanceManagerDeps = {
  core: Pick<CoreQueryService, 'getAgentProfile' | 'getConversation'>
}

const policyKey = (policy: ExecutionPolicy): string =>
  JSON.stringify({
    model: policy.model,
    contextEngineId: policy.contextEngineId,
    memoryProviderId: policy.memoryProviderId,
    toolProfileId: policy.toolProfileId ?? null,
    sandboxPolicyId: policy.sandboxPolicyId ?? null
  })

export class AgentInstanceManager {
  private readonly core: AgentInstanceManagerDeps['core']
  private readonly instancesByConversationId = new Map<string, AgentInstance>()

  constructor(deps: AgentInstanceManagerDeps) {
    this.core = deps.core
  }

  acquire(input: AcquireAgentInstanceInput): AgentInstance {
    const conversation = this.requireConversation(input.conversationId)
    const effectiveExecutionPolicy = this.resolveExecutionPolicy(conversation)
    const existing = this.instancesByConversationId.get(conversation.id) ?? null
    const now = new Date().toISOString()

    if (
      existing &&
      existing.status !== 'disposed' &&
      existing.status !== 'failed' &&
      policyKey(existing.effectiveExecutionPolicy) === policyKey(effectiveExecutionPolicy) &&
      !input.reloadReason
    ) {
      const reused = {
        ...existing,
        status: existing.status === 'acquiring' ? 'idle' : existing.status,
        lastActiveAt: now
      } satisfies AgentInstance
      this.instancesByConversationId.set(conversation.id, reused)
      return reused
    }

    const next: AgentInstance = {
      id: generateId(),
      agentProfileId: conversation.agentProfileId,
      conversationId: conversation.id,
      status: 'idle',
      effectiveExecutionPolicy,
      runtimeGeneration: (existing?.runtimeGeneration ?? 0) + 1,
      loadedAt: now,
      lastActiveAt: now,
      lastReloadReason:
        input.reloadReason ??
        (existing &&
        policyKey(existing.effectiveExecutionPolicy) !== policyKey(effectiveExecutionPolicy)
          ? 'execution_policy_change'
          : undefined)
    }

    this.instancesByConversationId.set(conversation.id, next)
    return next
  }

  updateStatus(conversationId: string, status: AgentInstanceStatus): AgentInstance {
    const existing = this.instancesByConversationId.get(conversationId)
    if (!existing) throw new Error(`No AgentInstance for Conversation: ${conversationId}`)
    const next = {
      ...existing,
      status,
      lastActiveAt: new Date().toISOString()
    } satisfies AgentInstance
    this.instancesByConversationId.set(conversationId, next)
    return next
  }

  dispose(conversationId: string): AgentInstance | null {
    const existing = this.instancesByConversationId.get(conversationId)
    if (!existing) return null
    const next = {
      ...existing,
      status: 'disposed',
      lastActiveAt: new Date().toISOString()
    } satisfies AgentInstance
    this.instancesByConversationId.set(conversationId, next)
    return next
  }

  get(conversationId: string): AgentInstance | null {
    return this.instancesByConversationId.get(conversationId) ?? null
  }

  list(): AgentInstance[] {
    return [...this.instancesByConversationId.values()]
  }

  private resolveExecutionPolicy(conversation: Conversation): ExecutionPolicy {
    const profile = this.core.getAgentProfile(conversation.agentProfileId)
    if (!profile) throw new Error(`Unknown AgentProfile: ${conversation.agentProfileId}`)
    return mergeExecutionPolicy(
      profile.defaultExecutionPolicy,
      conversation.executionOverride ?? null,
      null
    )
  }

  private requireConversation(conversationId: string): Conversation {
    const conversation = this.core.getConversation(conversationId)
    if (!conversation) throw new Error(`Unknown Conversation: ${conversationId}`)
    return conversation
  }
}
