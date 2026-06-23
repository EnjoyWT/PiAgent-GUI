import type Database from 'better-sqlite3'
import { generateId } from '../../shared/id.ts'
import type { ThreadPlanItem, ThreadPlanState } from '../../shared/thread-plan.ts'
import type {
  AgentProfile,
  AgentRun,
  AgentRunStatus,
  AnswerInteractionInput,
  AppendInboundEnvelopeInput,
  CancelInteractionInput,
  Conversation,
  ConversationBinding,
  ConversationBindingMatch,
  ConversationListItem,
  ConversationMessagePage,
  ConversationMessagePageCursor,
  ConversationMessage,
  ConversationSearchInput,
  ConversationSearchResult,
  ConversationSearchResultItem,
  ConversationStatus,
  ConversationWindowProjection,
  CoreCommandService,
  CoreQueryService,
  DeleteConversationInput,
  DeleteConversationMessageInput,
  DeliveryRecord,
  EventLogEntry,
  EventLogAggregateKey,
  ExecutionPolicy,
  ExecutionSnapshot,
  InteractionCheckpoint,
  ListAllConversationMessagesInput,
  ListAllConversationMessagesResult,
  ListConversationMessagesInput,
  ListConversationMessagesResult,
  ListConversationsInput,
  ListConversationsResult,
  MessageRole,
  PruneConversationRuntimeAfterInput,
  RequestDeliveryInput,
  RequestInteractionInput,
  RequestRunInput,
  ResolveConversationForEnvelopeInput,
  ResolveConversationForEnvelopeResult,
  ResolveConversationForTargetInput,
  UpdateDeliveryStatusInput,
  UpdateConversationInput,
  UpsertAgentRunInput,
  UpsertConversationMessageInput,
  UpsertEventLogEntryInput,
  UpsertThreadPlanStateInput,
  UpsertAgentProfileInput
} from './domain.ts'
import {
  createExecutionSnapshot,
  deriveBindingRoutingKey,
  deriveBindingRoutingKeyFromTarget,
  deriveConversationSourceKind,
  mergeExecutionPolicy
} from './domain.ts'
import { migrateCoreV2Schema } from './storage-schema.ts'
import { normalizeCoreTimestamp } from './time.ts'
import {
  claimTransportSetupQrModelNotificationInProjectionTurns,
  normalizeProjectionTurns,
  updateTransportSetupQrInProjectionTurns,
  type AgentRunProjectionPayload,
  type ClaimAgentRunProjectionTransportSetupQrModelNotificationInput,
  type ClaimedAgentRunProjectionTransportSetupQrModelNotification,
  type UpdateAgentRunProjectionTransportSetupQrInput
} from './agent-run-projections.ts'

const asCoreTimestamp = (value?: string | number | Date | null): string => {
  return normalizeCoreTimestamp(value)
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const toSqliteBool = (value: boolean): number => (value ? 1 : 0)

const normalizeSearchQuery = (value: string): string =>
  String(value ?? '')
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')

const escapeFtsPhrase = (value: string): string => value.replace(/"/g, '""')

const toFtsQuery = (value: string): string =>
  normalizeSearchQuery(value)
    .split(' ')
    .filter(Boolean)
    .map((part) => `"${escapeFtsPhrase(part)}"`)
    .join(' AND ')

const createConversationTitle = (input: {
  title?: string | null
  externalUserDisplayName?: string | null
  externalChatId: string
  transportId: string
  transportAccountId: string
}): string =>
  input.title?.trim() ||
  input.externalUserDisplayName?.trim() ||
  input.externalChatId ||
  `${input.transportId}:${input.transportAccountId}`

type AgentProfileRow = {
  id: string
  slug: string
  display_name: string
  is_default: number
  default_execution_policy_json: string
  enabled_transport_ids_json: string
  created_at: string
  updated_at: string
}

type ConversationRow = {
  id: string
  agent_profile_id: string
  workspace_id: string | null
  title: string | null
  status: Conversation['status']
  active_binding_id: string | null
  last_run_id: string | null
  execution_override_json: string | null
  desktop_visibility_mode: Conversation['desktopVisibilityMode']
  created_at: string
  updated_at: string
}

type ConversationBindingRow = {
  id: string
  conversation_id: string
  transport_id: string
  transport_account_id: string
  external_chat_id: string
  external_thread_id: string | null
  external_user_id: string | null
  channel_kind: ConversationBinding['channelKind']
  routing_key: string
  session_scope: ConversationBinding['sessionScope'] | null
  shared_multi_user: number
  person_id: string | null
  tenant_id: string | null
  last_external_message_id: string | null
  last_inbound_trace_id: string | null
  readonly_in_desktop: number
  created_at: string
  updated_at: string
}

type ConversationMessageRow = {
  id: string
  conversation_id: string
  binding_id: string | null
  external_message_id: string | null
  role: ConversationMessage['role']
  direction: ConversationMessage['direction']
  text: string | null
  payload_json: string | null
  created_at: string
}

type ConversationSearchRow = {
  message_id: string
  conversation_id: string
  thread_id: string
  role: ConversationSearchResultItem['role']
  title: string | null
  workspace_path: string | null
  text: string | null
  snippet: string | null
  created_at: string
  rank: number
}

type AgentRunRow = {
  id: string
  conversation_id: string
  instance_id: string | null
  trigger_kind: AgentRun['triggerKind']
  requested_execution_policy_json: string
  effective_execution_snapshot_json: string
  status: AgentRun['status']
  trace_id: string
  started_at: string
  ended_at: string | null
}

type ThreadPlanStateRow = {
  thread_id: string
  conversation_id: string | null
  revision: number
  active_run_id: string | null
  source_tool_call_id: string | null
  items_json: string
  closed: number
  updated_at: string
}

type AgentRunProjectionRow = {
  run_id: string
  projection_text: string
  projection_turns_json: string
  updated_at: string
}

type AgentRunProjectionWithConversationRow = AgentRunProjectionRow & {
  conversation_id: string
}

type InteractionCheckpointRow = {
  id: string
  conversation_id: string
  run_id: string | null
  kind: InteractionCheckpoint['kind']
  prompt: string
  status: InteractionCheckpoint['status']
  expected_binding_id: string | null
  expected_person_id: string | null
  accepted_reply_modes_json: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

type DeliveryRecordRow = {
  id: string
  conversation_id: string
  binding_id: string
  mode: DeliveryRecord['mode']
  payload_json: string
  status: DeliveryRecord['status']
  transport_delivery_mode: DeliveryRecord['transportDeliveryMode'] | null
  reply_context_json: string | null
  degrade_mode: DeliveryRecord['degradeMode']
  external_message_id: string | null
  doctor_trace_id: string | null
  last_error: string | null
  attempt_count: number
  created_at: string
  updated_at: string
}

type EventLogRow = {
  id: string
  event_type: string
  trace_id: string
  correlation_id: string
  causation_id: string | null
  parent_event_id: string | null
  sequence: number
  aggregate_type: EventLogEntry['aggregateType']
  aggregate_id: string
  payload_json: string
  created_at: string
}

type ConversationWindowProjectionRow = {
  conversation_id: string
  agent_profile_id: string
  workspace_id: string | null
  primary_source_kind: ConversationWindowProjection['primarySourceKind']
  primary_transport_id: string | null
  primary_transport_account_id: string | null
  primary_external_label: string | null
  desktop_visibility_mode: ConversationWindowProjection['desktopVisibilityMode']
  started_at: string | null
  last_message_at: string | null
  last_run_status: ConversationWindowProjection['lastRunStatus']
  pending_interaction_kind: ConversationWindowProjection['pendingInteractionKind']
  unread_count: number
  needs_attention: number
  is_pinned: number
  updated_at: string
}

type SqliteCoreServiceOptions = {
  migrate?: boolean
}

export class SqliteCoreService implements CoreCommandService, CoreQueryService {
  private readonly db: Database.Database

  constructor(db: Database.Database, options: SqliteCoreServiceOptions = {}) {
    this.db = db
    this.db.pragma('foreign_keys = ON')
    if (options.migrate !== false) {
      migrateCoreV2Schema(this.db)
    }
  }

  upsertAgentProfile(input: UpsertAgentProfileInput): AgentProfile {
    const tx = this.db.transaction(() => {
      const existingById = input.id ? this.getAgentProfile(input.id) : null
      const existingBySlug = this.getAgentProfileBySlug(input.slug)
      const existing = existingById ?? existingBySlug
      const now = asCoreTimestamp()
      const id = existing?.id ?? input.id ?? generateId()
      const isDefault = input.isDefault ?? existing?.isDefault ?? false
      const enabledTransportIds = input.enabledTransportIds ?? existing?.enabledTransportIds ?? []
      const createdAt = existing?.createdAt ?? now

      if (isDefault) {
        this.db
          .prepare(
            `UPDATE agent_profiles SET is_default = 0, updated_at = ? WHERE id != ? AND is_default = 1`
          )
          .run(now, id)
      }

      this.db
        .prepare(
          `
            INSERT INTO agent_profiles (
              id,
              slug,
              display_name,
              is_default,
              default_execution_policy_json,
              enabled_transport_ids_json,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              slug = excluded.slug,
              display_name = excluded.display_name,
              is_default = excluded.is_default,
              default_execution_policy_json = excluded.default_execution_policy_json,
              enabled_transport_ids_json = excluded.enabled_transport_ids_json,
              updated_at = excluded.updated_at
          `
        )
        .run(
          id,
          input.slug,
          input.displayName,
          toSqliteBool(isDefault),
          JSON.stringify(input.defaultExecutionPolicy),
          JSON.stringify(enabledTransportIds),
          createdAt,
          now
        )

      const profile = this.requireAgentProfile(id)
      this.insertEvent({
        eventType: 'agent_profile.upserted',
        aggregateType: 'agent_profile',
        aggregateId: profile.id,
        payload: profile,
        createdAt: now
      })

      return profile
    })

    return tx()
  }

  resolveConversationForEnvelope(
    input: ResolveConversationForEnvelopeInput
  ): ResolveConversationForEnvelopeResult {
    const tx = this.db.transaction(() => {
      this.requireAgentProfile(input.agentProfileId)

      const now = asCoreTimestamp(input.envelope.receivedAt)
      const routingKey = deriveBindingRoutingKey(input.envelope)
      const existingBindingRow = this.db
        .prepare(`SELECT * FROM conversation_bindings WHERE routing_key = ?`)
        .get(routingKey) as ConversationBindingRow | undefined

      if (existingBindingRow) {
        const existingBinding = this.mapConversationBinding(existingBindingRow)
        const existingConversation = this.requireConversation(existingBinding.conversationId)
        const nextConversation: Conversation =
          existingConversation.workspaceId == null && input.workspaceId != null
            ? {
                ...existingConversation,
                workspaceId: input.workspaceId,
                activeBindingId: existingConversation.activeBindingId ?? existingBinding.id,
                updatedAt: now
              }
            : existingConversation

        if (nextConversation !== existingConversation) {
          this.db
            .prepare(
              `
                UPDATE conversations
                SET workspace_id = ?, active_binding_id = ?, updated_at = ?
                WHERE id = ?
              `
            )
            .run(
              nextConversation.workspaceId ?? null,
              nextConversation.activeBindingId ?? null,
              nextConversation.updatedAt,
              nextConversation.id
            )
        }

        this.insertEvent({
          eventType: 'conversation.binding.resolved',
          aggregateType: 'conversation_binding',
          aggregateId: existingBinding.id,
          payload: {
            conversationId: nextConversation.id,
            bindingId: existingBinding.id,
            routingKey
          },
          createdAt: now,
          correlationId: input.envelope.envelopeId
        })
        this.db
          .prepare(
            `
              UPDATE conversation_bindings
              SET last_external_message_id = ?, last_inbound_trace_id = ?, updated_at = ?
              WHERE id = ?
            `
          )
          .run(
            input.envelope.externalMessageId,
            input.envelope.imTraceId ?? existingBinding.lastInboundTraceId ?? null,
            now,
            existingBinding.id
          )
        this.rebuildConversationWindowProjection(nextConversation.id)

        return {
          conversation: this.requireConversation(nextConversation.id),
          binding: this.requireBinding(existingBinding.id),
          createdConversation: false,
          createdBinding: false
        }
      }

      const conversationId = generateId()
      const bindingId = generateId()
      const conversation: Conversation = {
        id: conversationId,
        agentProfileId: input.agentProfileId,
        workspaceId: input.workspaceId ?? null,
        title: createConversationTitle({
          title: input.title,
          externalUserDisplayName: input.envelope.externalUserDisplayName,
          externalChatId: input.envelope.externalChatId,
          transportId: input.envelope.transportId,
          transportAccountId: input.envelope.transportAccountId
        }),
        status: 'active',
        activeBindingId: bindingId,
        lastRunId: null,
        executionOverride: input.executionOverride ?? null,
        desktopVisibilityMode: input.desktopVisibilityMode ?? 'readonly',
        createdAt: now,
        updatedAt: now
      }

      const binding: ConversationBinding = {
        id: bindingId,
        conversationId,
        transportId: input.envelope.transportId,
        transportAccountId: input.envelope.transportAccountId,
        externalChatId: input.envelope.externalChatId,
        externalThreadId: input.envelope.externalThreadId ?? null,
        externalUserId: input.envelope.externalUserId ?? null,
        channelKind: input.envelope.channelKind,
        routingKey,
        sessionScope: input.envelope.sessionScope ?? null,
        sharedMultiUser: input.envelope.sharedMultiUser ?? false,
        personId: input.envelope.personId ?? null,
        tenantId: input.envelope.tenantId ?? null,
        lastExternalMessageId: input.envelope.externalMessageId,
        lastInboundTraceId: input.envelope.imTraceId ?? null,
        readonlyInDesktop: (input.desktopVisibilityMode ?? 'readonly') !== 'read_write',
        createdAt: now,
        updatedAt: now
      }

      this.db
        .prepare(
          `
            INSERT INTO conversations (
              id,
              agent_profile_id,
              workspace_id,
              title,
              status,
              active_binding_id,
              last_run_id,
              execution_override_json,
              desktop_visibility_mode,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          conversation.id,
          conversation.agentProfileId,
          conversation.workspaceId ?? null,
          conversation.title ?? null,
          conversation.status,
          conversation.activeBindingId ?? null,
          conversation.lastRunId ?? null,
          conversation.executionOverride ? JSON.stringify(conversation.executionOverride) : null,
          conversation.desktopVisibilityMode,
          conversation.createdAt,
          conversation.updatedAt
        )

      this.db
        .prepare(
          `
            INSERT INTO conversation_bindings (
              id,
              conversation_id,
              transport_id,
              transport_account_id,
              external_chat_id,
              external_thread_id,
              external_user_id,
              channel_kind,
              routing_key,
              session_scope,
              shared_multi_user,
              person_id,
              tenant_id,
              last_external_message_id,
              last_inbound_trace_id,
              readonly_in_desktop,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          binding.id,
          binding.conversationId,
          binding.transportId,
          binding.transportAccountId,
          binding.externalChatId,
          binding.externalThreadId ?? null,
          binding.externalUserId ?? null,
          binding.channelKind,
          binding.routingKey,
          binding.sessionScope ?? null,
          toSqliteBool(binding.sharedMultiUser),
          binding.personId ?? null,
          binding.tenantId ?? null,
          binding.lastExternalMessageId ?? null,
          binding.lastInboundTraceId ?? null,
          toSqliteBool(binding.readonlyInDesktop),
          binding.createdAt,
          binding.updatedAt
        )

      this.insertEvent({
        eventType: 'conversation.created',
        aggregateType: 'conversation',
        aggregateId: conversation.id,
        payload: conversation,
        createdAt: now,
        correlationId: input.envelope.envelopeId
      })
      this.insertEvent({
        eventType: 'conversation.binding.created',
        aggregateType: 'conversation_binding',
        aggregateId: binding.id,
        payload: binding,
        createdAt: now,
        correlationId: input.envelope.envelopeId
      })
      this.rebuildConversationWindowProjection(conversation.id)

      return {
        conversation,
        binding,
        createdConversation: true,
        createdBinding: true
      }
    })

    return tx()
  }

  resolveConversationForTarget(
    input: ResolveConversationForTargetInput
  ): ResolveConversationForEnvelopeResult {
    const tx = this.db.transaction(() => {
      this.requireAgentProfile(input.agentProfileId)

      const now = asCoreTimestamp()
      const routingKey = deriveBindingRoutingKeyFromTarget(input.target)
      const existingBindingRow = this.db
        .prepare(`SELECT * FROM conversation_bindings WHERE routing_key = ?`)
        .get(routingKey) as ConversationBindingRow | undefined

      if (existingBindingRow) {
        const existingBinding = this.mapConversationBinding(existingBindingRow)
        const existingConversation = this.requireConversation(existingBinding.conversationId)
        if (input.conversationId && existingConversation.id !== input.conversationId) {
          throw new Error(
            `Route ${routingKey} is already attached to conversation ${existingConversation.id}`
          )
        }

        const nextConversation: Conversation =
          (existingConversation.workspaceId == null && input.workspaceId != null) ||
          (input.setAsActiveBinding && existingConversation.activeBindingId !== existingBinding.id)
            ? {
                ...existingConversation,
                workspaceId:
                  existingConversation.workspaceId == null && input.workspaceId != null
                    ? input.workspaceId
                    : existingConversation.workspaceId,
                activeBindingId: input.setAsActiveBinding
                  ? existingBinding.id
                  : existingConversation.activeBindingId,
                updatedAt: now
              }
            : existingConversation

        if (nextConversation !== existingConversation) {
          this.db
            .prepare(
              `
                UPDATE conversations
                SET workspace_id = ?, active_binding_id = ?, updated_at = ?
                WHERE id = ?
              `
            )
            .run(
              nextConversation.workspaceId ?? null,
              nextConversation.activeBindingId ?? null,
              nextConversation.updatedAt,
              nextConversation.id
            )
        }

        this.insertEvent({
          eventType: 'conversation.binding.resolved',
          aggregateType: 'conversation_binding',
          aggregateId: existingBinding.id,
          payload: {
            conversationId: nextConversation.id,
            bindingId: existingBinding.id,
            routingKey
          },
          createdAt: now
        })
        this.rebuildConversationWindowProjection(nextConversation.id)

        return {
          conversation: this.requireConversation(nextConversation.id),
          binding: existingBinding,
          createdConversation: false,
          createdBinding: false
        }
      }

      if (input.conversationId) {
        const conversation = this.requireConversation(input.conversationId)
        const bindingId = generateId()
        const nextConversation: Conversation = {
          ...conversation,
          workspaceId:
            conversation.workspaceId == null && input.workspaceId != null
              ? input.workspaceId
              : conversation.workspaceId,
          activeBindingId:
            input.setAsActiveBinding || !conversation.activeBindingId
              ? bindingId
              : conversation.activeBindingId,
          updatedAt: now
        }

        const binding: ConversationBinding = {
          id: bindingId,
          conversationId: conversation.id,
          transportId: input.target.transportId,
          transportAccountId: input.target.transportAccountId,
          externalChatId: input.target.externalChatId,
          externalThreadId: input.target.externalThreadId ?? null,
          externalUserId: input.target.externalUserId ?? null,
          channelKind: input.target.channelKind,
          routingKey,
          sessionScope: input.target.sessionScope ?? null,
          sharedMultiUser: input.target.sharedMultiUser ?? false,
          personId: input.target.personId ?? null,
          tenantId: input.target.tenantId ?? null,
          lastExternalMessageId: null,
          lastInboundTraceId: null,
          readonlyInDesktop: conversation.desktopVisibilityMode !== 'read_write',
          createdAt: now,
          updatedAt: now
        }

        this.db
          .prepare(
            `
              INSERT INTO conversation_bindings (
                id,
                conversation_id,
                transport_id,
                transport_account_id,
                external_chat_id,
                external_thread_id,
                external_user_id,
                channel_kind,
                routing_key,
                session_scope,
                shared_multi_user,
                person_id,
                tenant_id,
                last_external_message_id,
                last_inbound_trace_id,
                readonly_in_desktop,
                created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            binding.id,
            binding.conversationId,
            binding.transportId,
            binding.transportAccountId,
            binding.externalChatId,
            binding.externalThreadId ?? null,
            binding.externalUserId ?? null,
            binding.channelKind,
            binding.routingKey,
            binding.sessionScope ?? null,
            toSqliteBool(binding.sharedMultiUser),
            binding.personId ?? null,
            binding.tenantId ?? null,
            binding.lastExternalMessageId ?? null,
            binding.lastInboundTraceId ?? null,
            toSqliteBool(binding.readonlyInDesktop),
            binding.createdAt,
            binding.updatedAt
          )

        this.db
          .prepare(
            `
              UPDATE conversations
              SET workspace_id = ?, active_binding_id = ?, updated_at = ?
              WHERE id = ?
            `
          )
          .run(
            nextConversation.workspaceId ?? null,
            nextConversation.activeBindingId ?? null,
            nextConversation.updatedAt,
            nextConversation.id
          )

        this.insertEvent({
          eventType: 'conversation.binding.created',
          aggregateType: 'conversation_binding',
          aggregateId: binding.id,
          payload: binding,
          createdAt: now
        })
        this.rebuildConversationWindowProjection(conversation.id)

        return {
          conversation: this.requireConversation(conversation.id),
          binding,
          createdConversation: false,
          createdBinding: true
        }
      }

      const conversationId = generateId()
      const bindingId = generateId()
      const conversation: Conversation = {
        id: conversationId,
        agentProfileId: input.agentProfileId,
        workspaceId: input.workspaceId ?? null,
        title: createConversationTitle({
          title: input.title,
          externalUserDisplayName: input.target.externalUserDisplayName,
          externalChatId: input.target.externalChatId,
          transportId: input.target.transportId,
          transportAccountId: input.target.transportAccountId
        }),
        status: 'active',
        activeBindingId: bindingId,
        lastRunId: null,
        executionOverride: input.executionOverride ?? null,
        desktopVisibilityMode: input.desktopVisibilityMode ?? 'readonly',
        createdAt: now,
        updatedAt: now
      }

      const binding: ConversationBinding = {
        id: bindingId,
        conversationId,
        transportId: input.target.transportId,
        transportAccountId: input.target.transportAccountId,
        externalChatId: input.target.externalChatId,
        externalThreadId: input.target.externalThreadId ?? null,
        externalUserId: input.target.externalUserId ?? null,
        channelKind: input.target.channelKind,
        routingKey,
        sessionScope: input.target.sessionScope ?? null,
        sharedMultiUser: input.target.sharedMultiUser ?? false,
        personId: input.target.personId ?? null,
        tenantId: input.target.tenantId ?? null,
        lastExternalMessageId: null,
        lastInboundTraceId: null,
        readonlyInDesktop: (input.desktopVisibilityMode ?? 'readonly') !== 'read_write',
        createdAt: now,
        updatedAt: now
      }

      this.db
        .prepare(
          `
            INSERT INTO conversations (
              id,
              agent_profile_id,
              workspace_id,
              title,
              status,
              active_binding_id,
              last_run_id,
              execution_override_json,
              desktop_visibility_mode,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          conversation.id,
          conversation.agentProfileId,
          conversation.workspaceId ?? null,
          conversation.title ?? null,
          conversation.status,
          conversation.activeBindingId ?? null,
          conversation.lastRunId ?? null,
          conversation.executionOverride ? JSON.stringify(conversation.executionOverride) : null,
          conversation.desktopVisibilityMode,
          conversation.createdAt,
          conversation.updatedAt
        )

      this.db
        .prepare(
          `
            INSERT INTO conversation_bindings (
              id,
              conversation_id,
              transport_id,
              transport_account_id,
              external_chat_id,
              external_thread_id,
              external_user_id,
              channel_kind,
              routing_key,
              session_scope,
              shared_multi_user,
              person_id,
              tenant_id,
              last_external_message_id,
              last_inbound_trace_id,
              readonly_in_desktop,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          binding.id,
          binding.conversationId,
          binding.transportId,
          binding.transportAccountId,
          binding.externalChatId,
          binding.externalThreadId ?? null,
          binding.externalUserId ?? null,
          binding.channelKind,
          binding.routingKey,
          binding.sessionScope ?? null,
          toSqliteBool(binding.sharedMultiUser),
          binding.personId ?? null,
          binding.tenantId ?? null,
          binding.lastExternalMessageId ?? null,
          binding.lastInboundTraceId ?? null,
          toSqliteBool(binding.readonlyInDesktop),
          binding.createdAt,
          binding.updatedAt
        )

      this.insertEvent({
        eventType: 'conversation.created',
        aggregateType: 'conversation',
        aggregateId: conversation.id,
        payload: conversation,
        createdAt: now
      })
      this.insertEvent({
        eventType: 'conversation.binding.created',
        aggregateType: 'conversation_binding',
        aggregateId: binding.id,
        payload: binding,
        createdAt: now
      })
      this.rebuildConversationWindowProjection(conversation.id)

      return {
        conversation,
        binding,
        createdConversation: true,
        createdBinding: true
      }
    })

    return tx()
  }

  appendInboundEnvelope(input: AppendInboundEnvelopeInput): ConversationMessage {
    const tx = this.db.transaction(() => {
      this.requireConversation(input.conversationId)
      this.requireBinding(input.bindingId)

      const createdAt = asCoreTimestamp(input.envelope.receivedAt)
      const message: ConversationMessage = {
        id: generateId(),
        conversationId: input.conversationId,
        bindingId: input.bindingId,
        externalMessageId: input.envelope.externalMessageId,
        role: 'user',
        direction: 'inbound',
        text: input.envelope.text ?? null,
        payloadJson:
          input.envelope.attachments && input.envelope.attachments.length > 0
            ? JSON.stringify({ attachments: input.envelope.attachments })
            : null,
        createdAt
      }

      this.db
        .prepare(
          `
            INSERT INTO conversation_messages (
              id,
              conversation_id,
              binding_id,
              external_message_id,
              role,
              direction,
              text,
              payload_json,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          message.id,
          message.conversationId,
          message.bindingId ?? null,
          message.externalMessageId ?? null,
          message.role,
          message.direction,
          message.text ?? null,
          message.payloadJson ?? null,
          message.createdAt
        )

      this.db
        .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
        .run(createdAt, input.conversationId)

      this.db
        .prepare(
          `
            UPDATE conversation_bindings
            SET last_external_message_id = ?, last_inbound_trace_id = ?, updated_at = ?
            WHERE id = ?
          `
        )
        .run(
          input.envelope.externalMessageId,
          input.envelope.imTraceId ?? null,
          createdAt,
          input.bindingId
        )

      if (input.envelope.imTraceId && input.envelope.dedupeKey) {
        this.db
          .prepare(
            `
              INSERT OR IGNORE INTO im_inbound_events (
                id,
                im_trace_id,
                dedupe_key,
                transport_id,
                transport_account_id,
                conversation_id,
                binding_id,
                person_id,
                session_scope,
                routing_key,
                message_type,
                status,
                envelope_json,
                error,
                received_at,
                created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            generateId(),
            input.envelope.imTraceId,
            input.envelope.dedupeKey,
            input.envelope.transportId,
            input.envelope.transportAccountId,
            input.conversationId,
            input.bindingId,
            input.envelope.personId ?? null,
            input.envelope.sessionScope ?? null,
            deriveBindingRoutingKey(input.envelope),
            input.envelope.messageType ?? 'text',
            'received',
            JSON.stringify(input.envelope),
            null,
            createdAt,
            createdAt,
            createdAt
          )
      }

      this.insertEvent({
        eventType: 'transport.message.received',
        aggregateType: 'conversation_message',
        aggregateId: message.id,
        payload: {
          conversationId: message.conversationId,
          bindingId: message.bindingId,
          envelopeId: input.envelope.envelopeId,
          externalMessageId: message.externalMessageId
        },
        createdAt,
        correlationId: input.envelope.envelopeId
      })
      this.rebuildConversationWindowProjection(input.conversationId)

      return message
    })

    return tx()
  }

  upsertConversationMessage(input: UpsertConversationMessageInput): ConversationMessage {
    const tx = this.db.transaction(() => {
      this.requireConversation(input.conversationId)
      if (input.bindingId) this.requireBinding(input.bindingId)

      const createdAt = asCoreTimestamp(input.createdAt)
      const existingRow =
        input.externalMessageId != null
          ? (this.db
              .prepare(
                `
                  SELECT *
                  FROM conversation_messages
                  WHERE conversation_id = ? AND external_message_id = ?
                  LIMIT 1
                `
              )
              .get(input.conversationId, input.externalMessageId) as
              | ConversationMessageRow
              | undefined)
          : undefined

      if (existingRow) {
        this.db
          .prepare(
            `
              UPDATE conversation_messages
              SET binding_id = ?,
                  role = ?,
                  direction = ?,
                  text = ?,
                  payload_json = ?,
                  created_at = ?
              WHERE id = ?
            `
          )
          .run(
            input.bindingId ?? existingRow.binding_id ?? null,
            input.role,
            input.direction,
            input.text ?? null,
            input.payload == null ? null : JSON.stringify(input.payload),
            createdAt,
            existingRow.id
          )

        this.db
          .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
          .run(createdAt, input.conversationId)
        this.rebuildConversationWindowProjection(input.conversationId)

        return this.getConversationMessages(input.conversationId).find(
          (item) => item.id === existingRow.id
        )!
      }

      const message: ConversationMessage = {
        id: generateId(),
        conversationId: input.conversationId,
        bindingId: input.bindingId ?? null,
        externalMessageId: input.externalMessageId ?? null,
        role: input.role,
        direction: input.direction,
        text: input.text ?? null,
        payloadJson: input.payload == null ? null : JSON.stringify(input.payload),
        createdAt
      }

      this.db
        .prepare(
          `
            INSERT INTO conversation_messages (
              id,
              conversation_id,
              binding_id,
              external_message_id,
              role,
              direction,
              text,
              payload_json,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          message.id,
          message.conversationId,
          message.bindingId ?? null,
          message.externalMessageId ?? null,
          message.role,
          message.direction,
          message.text ?? null,
          message.payloadJson ?? null,
          message.createdAt
        )

      this.db
        .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
        .run(createdAt, input.conversationId)
      this.rebuildConversationWindowProjection(input.conversationId)

      return message
    })

    return tx()
  }

  updateConversation(input: UpdateConversationInput): Conversation {
    const tx = this.db.transaction(() => {
      const existing = this.requireConversation(input.conversationId)
      if (input.activeBindingId !== undefined && input.activeBindingId !== null) {
        const binding = this.requireBinding(input.activeBindingId)
        if (binding.conversationId !== existing.id) {
          throw new Error(`Binding ${binding.id} does not belong to conversation ${existing.id}`)
        }
      }
      const updatedAt = asCoreTimestamp()
      const next: Conversation = {
        ...existing,
        title: input.title !== undefined ? input.title : existing.title,
        workspaceId: input.workspaceId !== undefined ? input.workspaceId : existing.workspaceId,
        executionOverride:
          input.executionOverride !== undefined
            ? input.executionOverride
            : existing.executionOverride,
        desktopVisibilityMode: input.desktopVisibilityMode ?? existing.desktopVisibilityMode,
        activeBindingId:
          input.activeBindingId !== undefined ? input.activeBindingId : existing.activeBindingId,
        updatedAt
      }

      this.db
        .prepare(
          `
            UPDATE conversations
            SET workspace_id = ?,
                title = ?,
                execution_override_json = ?,
                active_binding_id = ?,
                desktop_visibility_mode = ?,
                updated_at = ?
            WHERE id = ?
          `
        )
        .run(
          next.workspaceId ?? null,
          next.title ?? null,
          next.executionOverride ? JSON.stringify(next.executionOverride) : null,
          next.activeBindingId ?? null,
          next.desktopVisibilityMode,
          next.updatedAt,
          next.id
        )

      this.rebuildConversationWindowProjection(next.id)
      return this.requireConversation(next.id)
    })

    return tx()
  }

  requestRun(input: RequestRunInput): AgentRun {
    const tx = this.db.transaction(() => {
      const conversation = this.requireConversation(input.conversationId)
      const profile = this.requireAgentProfile(conversation.agentProfileId)
      const now = asCoreTimestamp()
      const requestedExecutionPolicy = mergeExecutionPolicy(
        profile.defaultExecutionPolicy,
        conversation.executionOverride ?? null,
        input.triggerExecutionOverride ?? null
      )

      const run: AgentRun = {
        id: generateId(),
        conversationId: conversation.id,
        instanceId: null,
        triggerKind: input.triggerKind,
        requestedExecutionPolicy,
        effectiveExecutionSnapshot: createExecutionSnapshot(requestedExecutionPolicy, now),
        status: 'requested',
        traceId: input.traceId ?? generateId(),
        startedAt: now,
        endedAt: null
      }

      this.db
        .prepare(
          `
            INSERT INTO agent_runs (
              id,
              conversation_id,
              instance_id,
              trigger_kind,
              requested_execution_policy_json,
              effective_execution_snapshot_json,
              status,
              trace_id,
              started_at,
              ended_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          run.id,
          run.conversationId,
          run.instanceId ?? null,
          run.triggerKind,
          JSON.stringify(run.requestedExecutionPolicy),
          JSON.stringify(run.effectiveExecutionSnapshot),
          run.status,
          run.traceId,
          run.startedAt,
          run.endedAt ?? null
        )

      this.db
        .prepare(`UPDATE conversations SET last_run_id = ?, updated_at = ? WHERE id = ?`)
        .run(run.id, now, conversation.id)

      this.insertEvent({
        eventType: 'agent.run.requested',
        aggregateType: 'agent_run',
        aggregateId: run.id,
        payload: run,
        createdAt: now,
        traceId: run.traceId,
        correlationId: run.id
      })
      this.rebuildConversationWindowProjection(conversation.id)

      return run
    })

    return tx()
  }

  upsertAgentRun(input: UpsertAgentRunInput): AgentRun {
    const tx = this.db.transaction(() => {
      const conversation = this.requireConversation(input.conversationId)
      const startedAt = asCoreTimestamp(input.startedAt)
      const endedAt = input.endedAt == null ? null : asCoreTimestamp(input.endedAt)
      const existing = this.getAgentRun(input.id)

      const run: AgentRun = {
        id: input.id,
        conversationId: conversation.id,
        instanceId: input.instanceId ?? existing?.instanceId ?? null,
        triggerKind: input.triggerKind,
        requestedExecutionPolicy: {
          ...input.requestedExecutionPolicy,
          model: { ...input.requestedExecutionPolicy.model }
        },
        effectiveExecutionSnapshot: {
          ...input.effectiveExecutionSnapshot,
          model: { ...input.effectiveExecutionSnapshot.model }
        },
        status: input.status,
        traceId: input.traceId,
        startedAt,
        endedAt
      }

      this.db
        .prepare(
          `
            INSERT INTO agent_runs (
              id,
              conversation_id,
              instance_id,
              trigger_kind,
              requested_execution_policy_json,
              effective_execution_snapshot_json,
              status,
              trace_id,
              started_at,
              ended_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              conversation_id = excluded.conversation_id,
              instance_id = excluded.instance_id,
              trigger_kind = excluded.trigger_kind,
              requested_execution_policy_json = excluded.requested_execution_policy_json,
              effective_execution_snapshot_json = excluded.effective_execution_snapshot_json,
              status = excluded.status,
              trace_id = excluded.trace_id,
              started_at = excluded.started_at,
              ended_at = excluded.ended_at
          `
        )
        .run(
          run.id,
          run.conversationId,
          run.instanceId ?? null,
          run.triggerKind,
          JSON.stringify(run.requestedExecutionPolicy),
          JSON.stringify(run.effectiveExecutionSnapshot),
          run.status,
          run.traceId,
          run.startedAt,
          run.endedAt ?? null
        )

      const currentLastRun = conversation.lastRunId
        ? this.getAgentRun(conversation.lastRunId)
        : null
      const shouldPromoteLastRun =
        !conversation.lastRunId ||
        conversation.lastRunId === run.id ||
        !currentLastRun ||
        run.startedAt >= currentLastRun.startedAt

      this.db
        .prepare(`UPDATE conversations SET last_run_id = ?, updated_at = ? WHERE id = ?`)
        .run(
          shouldPromoteLastRun ? run.id : (conversation.lastRunId ?? null),
          run.endedAt ?? run.startedAt,
          conversation.id
        )

      const hasProjectionPayload =
        Object.prototype.hasOwnProperty.call(input, 'projectionText') ||
        Object.prototype.hasOwnProperty.call(input, 'projectionTurns')
      if (hasProjectionPayload) {
        this.upsertAgentRunProjection({
          runId: run.id,
          projectionText: input.projectionText ?? '',
          projectionTurns: normalizeProjectionTurns(input.projectionTurns),
          updatedAt: run.endedAt ?? run.startedAt
        })
      }

      this.upsertEventLogEntry({
        eventType: 'agent.run.upserted',
        aggregateType: 'agent_run',
        aggregateId: run.id,
        payload: {
          run,
          projectionStored: hasProjectionPayload
        },
        createdAt: run.endedAt ?? run.startedAt,
        traceId: run.traceId,
        correlationId: run.id
      })
      this.rebuildConversationWindowProjection(conversation.id)

      return this.requireAgentRun(run.id)
    })

    return tx()
  }

  requestInteraction(input: RequestInteractionInput): InteractionCheckpoint {
    const tx = this.db.transaction(() => {
      this.requireConversation(input.conversationId)
      if (input.runId) {
        const run = this.getAgentRun(input.runId)
        if (!run) {
          throw new Error(`Unknown AgentRun: ${input.runId}`)
        }
      }

      const now = asCoreTimestamp()
      const checkpoint: InteractionCheckpoint = {
        id: generateId(),
        conversationId: input.conversationId,
        runId: input.runId ?? null,
        kind: input.kind,
        prompt: input.prompt,
        status: 'pending',
        expectedBindingId: input.expectedBindingId ?? null,
        expectedPersonId: input.expectedPersonId ?? null,
        acceptedReplyModes: input.acceptedReplyModes ?? null,
        expiresAt: input.expiresAt == null ? null : asCoreTimestamp(input.expiresAt),
        createdAt: now,
        updatedAt: now
      }

      this.db
        .prepare(
          `
            INSERT INTO interaction_checkpoints (
              id,
              conversation_id,
              run_id,
              kind,
              prompt,
              status,
              expected_binding_id,
              expected_person_id,
              accepted_reply_modes_json,
              expires_at,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          checkpoint.id,
          checkpoint.conversationId,
          checkpoint.runId ?? null,
          checkpoint.kind,
          checkpoint.prompt,
          checkpoint.status,
          checkpoint.expectedBindingId ?? null,
          checkpoint.expectedPersonId ?? null,
          checkpoint.acceptedReplyModes ? JSON.stringify(checkpoint.acceptedReplyModes) : null,
          checkpoint.expiresAt ?? null,
          checkpoint.createdAt,
          checkpoint.updatedAt
        )

      this.db
        .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
        .run(now, input.conversationId)

      this.insertEvent({
        eventType: 'interaction.requested',
        aggregateType: 'interaction_checkpoint',
        aggregateId: checkpoint.id,
        payload: checkpoint,
        createdAt: now,
        correlationId: checkpoint.id
      })
      this.rebuildConversationWindowProjection(input.conversationId)

      return checkpoint
    })

    return tx()
  }

  answerInteraction(input: AnswerInteractionInput): InteractionCheckpoint {
    const tx = this.db.transaction(() => {
      const existing = this.requireInteractionCheckpoint(input.interactionId)
      const updatedAt = asCoreTimestamp(input.answeredAt)
      const checkpoint: InteractionCheckpoint = {
        ...existing,
        status: 'answered',
        updatedAt
      }

      this.db
        .prepare(`UPDATE interaction_checkpoints SET status = ?, updated_at = ? WHERE id = ?`)
        .run(checkpoint.status, checkpoint.updatedAt, checkpoint.id)

      this.insertEvent({
        eventType: 'interaction.answered',
        aggregateType: 'interaction_checkpoint',
        aggregateId: checkpoint.id,
        payload: checkpoint,
        createdAt: checkpoint.updatedAt,
        correlationId: checkpoint.id
      })
      this.rebuildConversationWindowProjection(checkpoint.conversationId)

      return checkpoint
    })

    return tx()
  }

  cancelInteraction(input: CancelInteractionInput): InteractionCheckpoint {
    const tx = this.db.transaction(() => {
      const existing = this.requireInteractionCheckpoint(input.interactionId)
      const updatedAt = asCoreTimestamp(input.cancelledAt)
      const checkpoint: InteractionCheckpoint = {
        ...existing,
        status: 'cancelled',
        updatedAt
      }

      this.db
        .prepare(`UPDATE interaction_checkpoints SET status = ?, updated_at = ? WHERE id = ?`)
        .run(checkpoint.status, checkpoint.updatedAt, checkpoint.id)

      this.insertEvent({
        eventType: 'interaction.cancelled',
        aggregateType: 'interaction_checkpoint',
        aggregateId: checkpoint.id,
        payload: checkpoint,
        createdAt: checkpoint.updatedAt,
        correlationId: checkpoint.id
      })
      this.rebuildConversationWindowProjection(checkpoint.conversationId)

      return checkpoint
    })

    return tx()
  }

  requestDelivery(input: RequestDeliveryInput): DeliveryRecord {
    const tx = this.db.transaction(() => {
      this.requireConversation(input.conversationId)
      this.requireBinding(input.bindingId)

      const now = asCoreTimestamp()
      const record: DeliveryRecord = {
        id: generateId(),
        conversationId: input.conversationId,
        bindingId: input.bindingId,
        mode: input.mode,
        payloadJson: JSON.stringify(input.payload),
        status: 'requested',
        transportDeliveryMode: input.transportDeliveryMode ?? null,
        replyContext: input.replyContext ?? null,
        degradeMode: input.degradeMode ?? null,
        externalMessageId: input.externalMessageId ?? null,
        doctorTraceId: input.doctorTraceId ?? null,
        lastError: null,
        attemptCount: 0,
        createdAt: now,
        updatedAt: now
      }

      this.db
        .prepare(
          `
            INSERT INTO delivery_records (
              id,
              conversation_id,
              binding_id,
              mode,
              payload_json,
              status,
              transport_delivery_mode,
              reply_context_json,
              degrade_mode,
              external_message_id,
              doctor_trace_id,
              last_error,
              attempt_count,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          record.id,
          record.conversationId,
          record.bindingId,
          record.mode,
          record.payloadJson,
          record.status,
          record.transportDeliveryMode ?? null,
          record.replyContext == null ? null : JSON.stringify(record.replyContext),
          record.degradeMode ?? null,
          record.externalMessageId ?? null,
          record.doctorTraceId ?? null,
          record.lastError ?? null,
          record.attemptCount,
          record.createdAt,
          record.updatedAt
        )

      this.insertEvent({
        eventType: 'delivery.requested',
        aggregateType: 'delivery_record',
        aggregateId: record.id,
        payload: record,
        createdAt: now,
        correlationId: record.id
      })

      return record
    })

    return tx()
  }

  updateDeliveryStatus(input: UpdateDeliveryStatusInput): DeliveryRecord {
    const tx = this.db.transaction(() => {
      const existing = this.requireDeliveryRecord(input.deliveryId)
      const updatedAt = asCoreTimestamp(input.updatedAt)

      this.db
        .prepare(`UPDATE delivery_records SET status = ?, updated_at = ? WHERE id = ?`)
        .run(input.status, updatedAt, input.deliveryId)

      const updated = this.requireDeliveryRecord(input.deliveryId)
      this.insertEvent({
        eventType: input.status === 'sent' ? 'delivery.sent' : 'delivery.failed',
        aggregateType: 'delivery_record',
        aggregateId: updated.id,
        payload: {
          delivery: updated,
          result: input.result ?? null
        },
        createdAt: updatedAt,
        correlationId: updated.id
      })
      this.rebuildConversationWindowProjection(existing.conversationId)

      return updated
    })

    return tx()
  }

  deleteConversationMessage(input: DeleteConversationMessageInput): boolean {
    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `
            SELECT *
            FROM conversation_messages
            WHERE conversation_id = ? AND external_message_id = ?
            LIMIT 1
          `
        )
        .get(input.conversationId, input.externalMessageId) as ConversationMessageRow | undefined
      if (!existing) return false

      this.db.prepare(`DELETE FROM conversation_messages WHERE id = ?`).run(existing.id)

      const latestMessage = this.db
        .prepare(
          `
            SELECT created_at
            FROM conversation_messages
            WHERE conversation_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          `
        )
        .get(input.conversationId) as { created_at?: string } | undefined

      this.db
        .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
        .run(latestMessage?.created_at ?? asCoreTimestamp(), input.conversationId)

      this.rebuildConversationWindowProjection(input.conversationId)
      this.insertEvent({
        eventType: 'conversation.message.deleted',
        aggregateType: 'conversation_message',
        aggregateId: existing.id,
        payload: {
          conversationId: input.conversationId,
          externalMessageId: input.externalMessageId
        },
        createdAt: asCoreTimestamp(),
        correlationId: existing.id
      })

      return true
    })

    return tx()
  }

  pruneConversationRuntimeAfter(input: PruneConversationRuntimeAfterInput): void {
    const tx = this.db.transaction(() => {
      this.requireConversation(input.conversationId)
      const cutoff = asCoreTimestamp(input.cutoffCreatedAt)
      const runRows = this.db
        .prepare(
          `
            SELECT id
            FROM agent_runs
            WHERE conversation_id = ?
              AND (
                started_at > ?
                OR COALESCE(ended_at, started_at) > ?
              )
          `
        )
        .all(input.conversationId, cutoff, cutoff) as Array<{ id: string }>

      if (runRows.length > 0) {
        const runIds = runRows.map((row) => row.id)
        const placeholders = runIds.map(() => '?').join(', ')
        this.db
          .prepare(
            `DELETE FROM event_log WHERE aggregate_type = 'agent_run' AND aggregate_id IN (${placeholders})`
          )
          .run(...runIds)
        this.db
          .prepare(`DELETE FROM agent_runs WHERE conversation_id = ? AND id IN (${placeholders})`)
          .run(input.conversationId, ...runIds)
      }

      this.db
        .prepare(
          `
            DELETE FROM conversation_messages
            WHERE conversation_id = ?
              AND created_at > ?
          `
        )
        .run(input.conversationId, cutoff)

      this.db
        .prepare(
          `
            DELETE FROM event_log
            WHERE aggregate_type = 'conversation'
              AND aggregate_id = ?
              AND created_at > ?
          `
        )
        .run(input.conversationId, cutoff)

      this.db
        .prepare(
          `
            DELETE FROM thread_plan_states
            WHERE conversation_id = ?
              AND updated_at > ?
          `
        )
        .run(input.conversationId, cutoff)

      const latestRun = this.db
        .prepare(
          `
            SELECT id, started_at
            FROM agent_runs
            WHERE conversation_id = ?
            ORDER BY started_at DESC
            LIMIT 1
          `
        )
        .get(input.conversationId) as { id?: string; started_at?: string } | undefined

      this.db
        .prepare(`UPDATE conversations SET last_run_id = ?, updated_at = ? WHERE id = ?`)
        .run(latestRun?.id ?? null, latestRun?.started_at ?? cutoff, input.conversationId)

      this.rebuildConversationWindowProjection(input.conversationId)
      this.insertEvent({
        eventType: 'conversation.runtime.pruned',
        aggregateType: 'conversation',
        aggregateId: input.conversationId,
        payload: {
          conversationId: input.conversationId,
          cutoffCreatedAt: cutoff
        },
        createdAt: cutoff,
        correlationId: input.conversationId
      })
    })

    tx()
  }

  deleteConversation(input: DeleteConversationInput): boolean {
    const tx = this.db.transaction(() => {
      const existing = this.getConversation(input.conversationId)
      if (!existing) return false

      // 获取所有关联的 agent_run ids
      const runRows = this.db
        .prepare(`SELECT id FROM agent_runs WHERE conversation_id = ?`)
        .all(input.conversationId) as Array<{ id: string }>

      // 删除 agent_run 相关的 event_log
      if (runRows.length > 0) {
        const runIds = runRows.map((row) => row.id)
        const placeholders = runIds.map(() => '?').join(', ')
        this.db
          .prepare(
            `DELETE FROM event_log WHERE aggregate_type = 'agent_run' AND aggregate_id IN (${placeholders})`
          )
          .run(...runIds)
      }

      // 删除 conversation 相关的 event_log
      this.db
        .prepare(`DELETE FROM event_log WHERE aggregate_type = 'conversation' AND aggregate_id = ?`)
        .run(input.conversationId)

      // 删除 conversations (CASCADE 会自动清理关联表)
      this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(input.conversationId)

      return true
    })

    return tx()
  }

  /**
   * 清理旧的 event_log 记录
   * @param retentionDays 保留天数，默认 30 天
   * @returns 删除的记录数
   */
  pruneOldEventLog(retentionDays: number = 30): number {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    const cutoff = cutoffDate.toISOString()

    const result = this.db
      .prepare(`DELETE FROM event_log WHERE created_at < ?`)
      .run(cutoff)

    return result.changes
  }

  /**
   * 获取 event_log 表的统计信息
   */
  getEventLogStats(): { totalCount: number; oldestEntry: string | null; newestEntry: string | null } {
    const stats = this.db
      .prepare(
        `
          SELECT
            COUNT(*) as totalCount,
            MIN(created_at) as oldestEntry,
            MAX(created_at) as newestEntry
          FROM event_log
        `
      )
      .get() as { totalCount: number; oldestEntry: string | null; newestEntry: string | null }

    return stats
  }

  upsertThreadPlanState(input: UpsertThreadPlanStateInput): ThreadPlanState {
    const threadId = String(input.threadId ?? '').trim()
    if (!threadId) throw new Error('threadId is required')
    const conversationId = String(input.conversationId ?? '').trim() || null
    const existing = this.getThreadPlanState(threadId)
    const revision = (existing?.revision ?? 0) + 1
    const updatedAt = asCoreTimestamp(input.updatedAt)
    const items = input.items.map((item) => ({
      id: item.id,
      text: item.text,
      status: item.status
    }))

    this.db
      .prepare(
        `
          INSERT INTO thread_plan_states (
            thread_id,
            conversation_id,
            revision,
            active_run_id,
            source_tool_call_id,
            items_json,
            closed,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET
            conversation_id = excluded.conversation_id,
            revision = excluded.revision,
            active_run_id = excluded.active_run_id,
            source_tool_call_id = excluded.source_tool_call_id,
            items_json = excluded.items_json,
            closed = excluded.closed,
            updated_at = excluded.updated_at
        `
      )
      .run(
        threadId,
        conversationId,
        revision,
        input.activeRunId ?? null,
        input.sourceToolCallId ?? null,
        JSON.stringify(items),
        input.closed ? 1 : 0,
        updatedAt
      )

    return this.requireThreadPlanState(threadId)
  }

  clearThreadPlanState(threadId: string): boolean {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) return false
    const result = this.db
      .prepare(`DELETE FROM thread_plan_states WHERE thread_id = ?`)
      .run(normalizedThreadId)
    return result.changes > 0
  }

  upsertEventLogEntry(input: UpsertEventLogEntryInput): EventLogEntry {
    const createdAt = asCoreTimestamp(input.createdAt)
    const existing = input.id
      ? ((this.db.prepare(`SELECT * FROM event_log WHERE id = ?`).get(input.id) as
          | EventLogRow
          | undefined) ?? null)
      : null
    const entryId = input.id ?? generateId()
    const sequence = existing?.sequence ?? this.getNextEventSequence()

    this.db
      .prepare(
        `
          INSERT INTO event_log (
            id,
            event_type,
            trace_id,
            correlation_id,
            causation_id,
            parent_event_id,
            sequence,
            aggregate_type,
            aggregate_id,
            payload_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            event_type = excluded.event_type,
            trace_id = excluded.trace_id,
            correlation_id = excluded.correlation_id,
            causation_id = excluded.causation_id,
            parent_event_id = excluded.parent_event_id,
            aggregate_type = excluded.aggregate_type,
            aggregate_id = excluded.aggregate_id,
            payload_json = excluded.payload_json,
            created_at = excluded.created_at
        `
      )
      .run(
        entryId,
        input.eventType,
        input.traceId,
        input.correlationId,
        input.causationId ?? null,
        input.parentEventId ?? null,
        sequence,
        input.aggregateType,
        input.aggregateId,
        JSON.stringify(input.payload),
        createdAt
      )

    return this.requireEventLogEntry(entryId)
  }

  getAgentProfile(id: string): AgentProfile | null {
    const row = this.db.prepare(`SELECT * FROM agent_profiles WHERE id = ?`).get(id) as
      | AgentProfileRow
      | undefined
    return row ? this.mapAgentProfile(row) : null
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as
      | ConversationRow
      | undefined
    return row ? this.mapConversation(row) : null
  }

  getConversationBinding(id: string): ConversationBinding | null {
    const row = this.db.prepare(`SELECT * FROM conversation_bindings WHERE id = ?`).get(id) as
      | ConversationBindingRow
      | undefined
    return row ? this.mapConversationBinding(row) : null
  }

  listConversationBindings(options?: {
    conversationId?: string | null
    transportId?: string | null
    transportAccountId?: string | null
  }): ConversationBinding[] {
    const clauses: string[] = []
    const params: string[] = []

    if (options?.conversationId) {
      clauses.push('conversation_id = ?')
      params.push(options.conversationId)
    }
    if (options?.transportId) {
      clauses.push('transport_id = ?')
      params.push(options.transportId)
    }
    if (options?.transportAccountId) {
      clauses.push('transport_account_id = ?')
      params.push(options.transportAccountId)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM conversation_bindings
          ${where}
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(...params) as ConversationBindingRow[]
    return rows.map((row) => this.mapConversationBinding(row))
  }

  getConversationBindingByRoutingKey(routingKey: string): ConversationBinding | null {
    const row = this.db
      .prepare(`SELECT * FROM conversation_bindings WHERE routing_key = ?`)
      .get(routingKey) as ConversationBindingRow | undefined
    return row ? this.mapConversationBinding(row) : null
  }

  getConversationByBindingRoutingKey(routingKey: string): ConversationBindingMatch | null {
    const binding = this.getConversationBindingByRoutingKey(routingKey)
    if (!binding) return null
    const conversation = this.getConversation(binding.conversationId)
    if (!conversation) return null
    return { conversation, binding }
  }

  getConversationMessages(conversationId: string): ConversationMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC`
      )
      .all(conversationId) as ConversationMessageRow[]
    return rows.map((row) => this.mapConversationMessage(row))
  }

  searchConversationMessages(input: ConversationSearchInput): ConversationSearchResult {
    const normalizedQuery = normalizeSearchQuery(input.query)
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50), 100))
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))
    if (normalizedQuery.length < 2) {
      return { items: [], total: 0, limit, offset, hasMore: false }
    }

    const ftsQuery = toFtsQuery(normalizedQuery)
    const clauses = ['conversation_message_search_fts MATCH ?']
    const params: Array<string | number> = [ftsQuery]
    const countParams: Array<string | number> = [ftsQuery]

    const addFilter = (sql: string, value: string): void => {
      clauses.push(sql)
      params.push(value)
      countParams.push(value)
    }

    if (input.workspacePath) addFilter('workspace_path = ?', input.workspacePath)
    if (input.conversationId) addFilter('conversation_id = ?', input.conversationId)
    if (input.threadId) addFilter('thread_id = ?', input.threadId)

    const roles = (input.roles ?? [])
      .map((role) => String(role ?? '').trim())
      .filter((role): role is ConversationSearchResultItem['role'] =>
        role === 'user' || role === 'assistant' || role === 'tool'
      )
    if (roles.length > 0) {
      clauses.push(`role IN (${roles.map(() => '?').join(', ')})`)
      params.push(...roles)
      countParams.push(...roles)
    }

    const where = clauses.join(' AND ')
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM conversation_message_search_fts WHERE ${where}`)
      .get(...countParams) as { total?: number } | undefined
    const total = Math.max(0, Number(totalRow?.total ?? 0))

    const rows = this.db
      .prepare(
        `
          SELECT
            message_id,
            conversation_id,
            thread_id,
            role,
            NULLIF(title, '') AS title,
            NULLIF(workspace_path, '') AS workspace_path,
            text,
            snippet(conversation_message_search_fts, 6, '<mark>', '</mark>', '…', 24) AS snippet,
            created_at,
            bm25(conversation_message_search_fts, 4.0, 0.0, 0.0, 0.0, 2.0, 0.0, 1.0, 0.0) AS rank
          FROM conversation_message_search_fts
          WHERE ${where}
          ORDER BY rank ASC, created_at DESC, message_id ASC
          LIMIT ? OFFSET ?
        `
      )
      .all(...params, limit, offset) as ConversationSearchRow[]

    return {
      items: rows.map((row) => this.mapConversationSearchRow(row)),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total
    }
  }

  listConversationMessagesPage(
    conversationId: string,
    options?: { limit?: number; before?: ConversationMessagePageCursor | null }
  ): ConversationMessagePage {
    const normalizedLimit = Math.max(1, Math.min(Math.trunc(options?.limit ?? 50), 200))
    const before = options?.before ?? null
    const params: Array<string | number> = [conversationId]
    let sql = `
      SELECT *
      FROM conversation_messages
      WHERE conversation_id = ?
    `

    if (before?.createdAt && before?.id) {
      sql += `
        AND (
          created_at < ?
          OR (created_at = ? AND COALESCE(external_message_id, id) < ?)
        )
      `
      params.push(before.createdAt, before.createdAt, before.id)
    }

    sql += `
      ORDER BY created_at DESC, COALESCE(external_message_id, id) DESC
      LIMIT ?
    `
    params.push(normalizedLimit + 1)

    const rows = this.db.prepare(sql).all(...params) as ConversationMessageRow[]
    const hasMoreBefore = rows.length > normalizedLimit
    const pageRows = hasMoreBefore ? rows.slice(0, normalizedLimit) : rows
    pageRows.reverse()
    const oldest = pageRows[0]

    return {
      rows: pageRows.map((row) => this.mapConversationMessage(row)),
      hasMoreBefore,
      nextBeforeCursor: oldest
        ? {
            createdAt: oldest.created_at,
            id: oldest.external_message_id ?? oldest.id
          }
        : null
    }
  }

  getAgentRun(id: string): AgentRun | null {
    const row = this.db.prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(id) as
      | AgentRunRow
      | undefined
    return row ? this.mapAgentRun(row) : null
  }

  listConversationRuns(conversationId: string): AgentRun[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM agent_runs
          WHERE conversation_id = ?
          ORDER BY started_at ASC
        `
      )
      .all(conversationId) as AgentRunRow[]

    return rows.map((row) => this.mapAgentRun(row))
  }

  listAgentRunsByIds(runIds: string[]): AgentRun[] {
    const normalizedIds = Array.from(
      new Set(runIds.map((id) => String(id ?? '').trim()).filter(Boolean))
    )
    if (normalizedIds.length === 0) return []
    const placeholders = normalizedIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM agent_runs
          WHERE id IN (${placeholders})
          ORDER BY started_at ASC
        `
      )
      .all(...normalizedIds) as AgentRunRow[]
    return rows.map((row) => this.mapAgentRun(row))
  }

  listAgentRunProjectionPayloadsByIds(runIds: string[]): AgentRunProjectionPayload[] {
    const normalizedIds = [...new Set(runIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
    if (normalizedIds.length === 0) return []

    const placeholders = normalizedIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM agent_run_projections
          WHERE run_id IN (${placeholders})
        `
      )
      .all(...normalizedIds) as AgentRunProjectionRow[]
    return rows.map((row) => this.mapAgentRunProjectionPayload(row))
  }

  updateAgentRunProjectionTransportSetupQr(
    input: UpdateAgentRunProjectionTransportSetupQrInput
  ): number {
    const normalizedSessionId = String(input.sessionId ?? '').trim()
    if (!normalizedSessionId) return 0
    const updatedAt = asCoreTimestamp(input.updatedAt)

    const tx = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `
            SELECT *
            FROM agent_run_projections
            WHERE projection_turns_json LIKE ?
          `
        )
        .all(`%${normalizedSessionId}%`) as AgentRunProjectionRow[]

      let changed = 0
      for (const row of rows) {
        const update = updateTransportSetupQrInProjectionTurns(row.projection_turns_json, {
          ...input,
          sessionId: normalizedSessionId,
          updatedAt
        })
        if (!update.changed) continue
        this.db
          .prepare(
            `
              UPDATE agent_run_projections
              SET projection_turns_json = ?, updated_at = ?
              WHERE run_id = ?
            `
          )
          .run(JSON.stringify(update.projectionTurns), updatedAt, row.run_id)
        changed += 1
      }
      return changed
    })

    return tx()
  }

  claimAgentRunProjectionTransportSetupQrModelNotification(
    input: ClaimAgentRunProjectionTransportSetupQrModelNotificationInput
  ): ClaimedAgentRunProjectionTransportSetupQrModelNotification[] {
    const normalizedSessionId = String(input.sessionId ?? '').trim()
    if (!normalizedSessionId) return []
    const updatedAt = asCoreTimestamp(input.updatedAt)

    const tx = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `
            SELECT
              agent_run_projections.*,
              agent_runs.conversation_id
            FROM agent_run_projections
            INNER JOIN agent_runs
              ON agent_runs.id = agent_run_projections.run_id
            WHERE agent_run_projections.projection_turns_json LIKE ?
          `
        )
        .all(`%${normalizedSessionId}%`) as AgentRunProjectionWithConversationRow[]

      const claims: ClaimedAgentRunProjectionTransportSetupQrModelNotification[] = []
      for (const row of rows) {
        const update = claimTransportSetupQrModelNotificationInProjectionTurns(
          row.projection_turns_json,
          {
            ...input,
            sessionId: normalizedSessionId
          }
        )
        if (!update.changed) continue
        this.db
          .prepare(
            `
              UPDATE agent_run_projections
              SET projection_turns_json = ?, updated_at = ?
              WHERE run_id = ?
            `
          )
          .run(JSON.stringify(update.projectionTurns), updatedAt, row.run_id)
        claims.push({
          runId: row.run_id,
          conversationId: row.conversation_id,
          sessionId: normalizedSessionId,
          status: input.status,
          transportId: input.transportId ?? null,
          accountId: input.accountId ?? null,
          methodId: input.methodId ?? null
        })
      }
      return claims
    })

    return tx()
  }

  listPendingInteractions(conversationId?: string): InteractionCheckpoint[] {
    const rows = conversationId
      ? (this.db
          .prepare(
            `
              SELECT *
              FROM interaction_checkpoints
              WHERE status = 'pending' AND conversation_id = ?
              ORDER BY updated_at DESC
            `
          )
          .all(conversationId) as InteractionCheckpointRow[])
      : (this.db
          .prepare(
            `
              SELECT *
              FROM interaction_checkpoints
              WHERE status = 'pending'
              ORDER BY updated_at DESC
            `
          )
          .all() as InteractionCheckpointRow[])

    return rows.map((row) => this.mapInteractionCheckpoint(row))
  }

  getDeliveryRecords(conversationId: string): DeliveryRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM delivery_records
          WHERE conversation_id = ?
          ORDER BY created_at DESC
        `
      )
      .all(conversationId) as DeliveryRecordRow[]

    return rows.map((row) => this.mapDeliveryRecord(row))
  }

  getDeliveryRecord(id: string): DeliveryRecord | null {
    const row = this.db.prepare(`SELECT * FROM delivery_records WHERE id = ?`).get(id) as
      | DeliveryRecordRow
      | undefined
    return row ? this.mapDeliveryRecord(row) : null
  }

  listDeliveryRecords(status?: DeliveryRecord['status']): DeliveryRecord[] {
    const rows = status
      ? (this.db
          .prepare(
            `
              SELECT *
              FROM delivery_records
              WHERE status = ?
              ORDER BY created_at ASC
            `
          )
          .all(status) as DeliveryRecordRow[])
      : (this.db
          .prepare(
            `
              SELECT *
              FROM delivery_records
              ORDER BY created_at ASC
            `
          )
          .all() as DeliveryRecordRow[])

    return rows.map((row) => this.mapDeliveryRecord(row))
  }

  getThreadPlanState(threadId: string): ThreadPlanState | null {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) return null
    const row = this.db
      .prepare(`SELECT * FROM thread_plan_states WHERE thread_id = ?`)
      .get(normalizedThreadId) as ThreadPlanStateRow | undefined
    return row ? this.mapThreadPlanState(row) : null
  }

  listConversationWindows(
    sourceKind: 'local' | 'im' | 'all' = 'all'
  ): ConversationWindowProjection[] {
    const rows =
      sourceKind === 'all'
        ? (this.db
            .prepare(
              `
                SELECT *
                FROM conversation_window_projection
                ORDER BY COALESCE(last_message_at, updated_at) DESC, conversation_id ASC
              `
            )
            .all() as ConversationWindowProjectionRow[])
        : (this.db
            .prepare(
              `
                SELECT *
                FROM conversation_window_projection
                WHERE primary_source_kind = ?
                ORDER BY COALESCE(last_message_at, updated_at) DESC, conversation_id ASC
              `
            )
            .all(sourceKind) as ConversationWindowProjectionRow[])

    return rows.map((row) => this.mapConversationWindowProjection(row))
  }

  listEventLog(): EventLogEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM event_log ORDER BY sequence ASC`)
      .all() as EventLogRow[]
    return rows.map((row) => this.mapEventLogEntry(row))
  }

  listEventLogByAggregateKeys(keys: EventLogAggregateKey[]): EventLogEntry[] {
    const normalizedKeys = keys.filter((key): key is EventLogAggregateKey =>
      Boolean(String(key?.aggregateType ?? '').trim() && String(key?.aggregateId ?? '').trim())
    )
    if (normalizedKeys.length === 0) return []

    const clauses: string[] = []
    const params: string[] = []
    for (const key of normalizedKeys) {
      clauses.push('(aggregate_type = ? AND aggregate_id = ?)')
      params.push(key.aggregateType, key.aggregateId)
    }

    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM event_log
          WHERE ${clauses.join(' OR ')}
          ORDER BY sequence ASC
        `
      )
      .all(...params) as EventLogRow[]
    return rows.map((row) => this.mapEventLogEntry(row))
  }

  private rebuildConversationWindowProjection(conversationId: string): void {
    const conversation = this.requireConversation(conversationId)
    const binding = this.getPrimaryBindingForConversation(conversation)
    const startedMessageAt = (
      this.db
        .prepare(
          `SELECT created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 1`
        )
        .get(conversationId) as { created_at: string } | undefined
    )?.created_at
    const startedRunAt = (
      this.db
        .prepare(
          `SELECT started_at FROM agent_runs WHERE conversation_id = ? ORDER BY started_at ASC LIMIT 1`
        )
        .get(conversationId) as { started_at: string } | undefined
    )?.started_at
    const lastMessageAt = (
      this.db
        .prepare(
          `SELECT created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(conversationId) as { created_at: string } | undefined
    )?.created_at
    const lastRunStatus = (
      this.db
        .prepare(
          `SELECT status FROM agent_runs WHERE conversation_id = ? ORDER BY started_at DESC LIMIT 1`
        )
        .get(conversationId) as { status: AgentRun['status'] } | undefined
    )?.status
    const pendingInteractionKind = (
      this.db
        .prepare(
          `
            SELECT kind
            FROM interaction_checkpoints
            WHERE conversation_id = ? AND status = 'pending'
            ORDER BY updated_at DESC
            LIMIT 1
          `
        )
        .get(conversationId) as
        | { kind: ConversationWindowProjection['pendingInteractionKind'] }
        | undefined
    )?.kind
    const projection: ConversationWindowProjection = {
      conversationId,
      agentProfileId: conversation.agentProfileId,
      workspaceId: conversation.workspaceId ?? null,
      primarySourceKind: binding ? deriveConversationSourceKind(binding.transportId) : 'local',
      primaryTransportId: binding?.transportId ?? null,
      primaryTransportAccountId: binding?.transportAccountId ?? null,
      primaryExternalLabel:
        conversation.title ?? binding?.externalUserId ?? binding?.externalChatId ?? conversation.id,
      desktopVisibilityMode: conversation.desktopVisibilityMode,
      startedAt:
        startedMessageAt && startedRunAt
          ? startedMessageAt <= startedRunAt
            ? startedMessageAt
            : startedRunAt
          : (startedMessageAt ?? startedRunAt ?? null),
      lastMessageAt: lastMessageAt ?? null,
      lastRunStatus: lastRunStatus ?? null,
      pendingInteractionKind: pendingInteractionKind ?? null,
      unreadCount: 0,
      needsAttention: Boolean(pendingInteractionKind) || lastRunStatus === 'failed',
      isPinned: false,
      updatedAt: conversation.updatedAt
    }

    this.db
      .prepare(
        `
          INSERT INTO conversation_window_projection (
            conversation_id,
            agent_profile_id,
            workspace_id,
            primary_source_kind,
            primary_transport_id,
            primary_transport_account_id,
            primary_external_label,
            desktop_visibility_mode,
            started_at,
            last_message_at,
            last_run_status,
            pending_interaction_kind,
            unread_count,
            needs_attention,
            is_pinned,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(conversation_id) DO UPDATE SET
            agent_profile_id = excluded.agent_profile_id,
            workspace_id = excluded.workspace_id,
            primary_source_kind = excluded.primary_source_kind,
            primary_transport_id = excluded.primary_transport_id,
            primary_transport_account_id = excluded.primary_transport_account_id,
            primary_external_label = excluded.primary_external_label,
            desktop_visibility_mode = excluded.desktop_visibility_mode,
            started_at = excluded.started_at,
            last_message_at = excluded.last_message_at,
            last_run_status = excluded.last_run_status,
            pending_interaction_kind = excluded.pending_interaction_kind,
            unread_count = excluded.unread_count,
            needs_attention = excluded.needs_attention,
            is_pinned = excluded.is_pinned,
            updated_at = excluded.updated_at
        `
      )
      .run(
        projection.conversationId,
        projection.agentProfileId,
        projection.workspaceId ?? null,
        projection.primarySourceKind,
        projection.primaryTransportId ?? null,
        projection.primaryTransportAccountId ?? null,
        projection.primaryExternalLabel ?? null,
        projection.desktopVisibilityMode,
        projection.startedAt ?? null,
        projection.lastMessageAt ?? null,
        projection.lastRunStatus ?? null,
        projection.pendingInteractionKind ?? null,
        projection.unreadCount,
        toSqliteBool(projection.needsAttention),
        toSqliteBool(projection.isPinned),
        projection.updatedAt
      )
  }

  private insertEvent(input: {
    eventType: string
    aggregateType: EventLogEntry['aggregateType']
    aggregateId: string
    payload: unknown
    createdAt: string
    traceId?: string
    correlationId?: string
    causationId?: string | null
    parentEventId?: string | null
  }): void {
    this.upsertEventLogEntry({
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      createdAt: input.createdAt,
      traceId: input.traceId ?? generateId(),
      correlationId: input.correlationId ?? generateId(),
      causationId: input.causationId ?? null,
      parentEventId: input.parentEventId ?? null
    })
  }

  private getNextEventSequence(): number {
    return (
      (
        this.db
          .prepare(`SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM event_log`)
          .get() as {
          max_sequence: number
        }
      ).max_sequence + 1
    )
  }

  private getAgentProfileBySlug(slug: string): AgentProfile | null {
    const row = this.db.prepare(`SELECT * FROM agent_profiles WHERE slug = ?`).get(slug) as
      | AgentProfileRow
      | undefined
    return row ? this.mapAgentProfile(row) : null
  }

  private getPrimaryBindingForConversation(conversation: Conversation): ConversationBinding | null {
    if (conversation.activeBindingId) {
      const activeBinding = this.getConversationBinding(conversation.activeBindingId)
      if (activeBinding) return activeBinding
    }

    const row = this.db
      .prepare(
        `
          SELECT *
          FROM conversation_bindings
          WHERE conversation_id = ?
          ORDER BY created_at ASC
          LIMIT 1
        `
      )
      .get(conversation.id) as ConversationBindingRow | undefined

    return row ? this.mapConversationBinding(row) : null
  }

  private mapAgentProfile(row: AgentProfileRow): AgentProfile {
    return {
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      isDefault: Boolean(row.is_default),
      defaultExecutionPolicy: parseJson<ExecutionPolicy>(row.default_execution_policy_json, {
        model: { providerId: '', modelId: '' },
        contextEngineId: '',
        memoryProviderId: ''
      }),
      enabledTransportIds: parseJson<string[]>(row.enabled_transport_ids_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapConversation(row: ConversationRow): Conversation {
    return {
      id: row.id,
      agentProfileId: row.agent_profile_id,
      workspaceId: row.workspace_id,
      title: row.title,
      status: row.status,
      activeBindingId: row.active_binding_id,
      lastRunId: row.last_run_id,
      executionOverride: parseJson(row.execution_override_json, null),
      desktopVisibilityMode: row.desktop_visibility_mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapConversationBinding(row: ConversationBindingRow): ConversationBinding {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      transportId: row.transport_id,
      transportAccountId: row.transport_account_id,
      externalChatId: row.external_chat_id,
      externalThreadId: row.external_thread_id,
      externalUserId: row.external_user_id,
      channelKind: row.channel_kind,
      routingKey: row.routing_key,
      sessionScope: row.session_scope,
      sharedMultiUser: Boolean(row.shared_multi_user),
      personId: row.person_id,
      tenantId: row.tenant_id,
      lastExternalMessageId: row.last_external_message_id,
      lastInboundTraceId: row.last_inbound_trace_id,
      readonlyInDesktop: Boolean(row.readonly_in_desktop),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapConversationMessage(row: ConversationMessageRow): ConversationMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      bindingId: row.binding_id,
      externalMessageId: row.external_message_id,
      role: row.role,
      direction: row.direction,
      text: row.text,
      payloadJson: row.payload_json,
      createdAt: row.created_at
    }
  }

  private mapConversationSearchRow(row: ConversationSearchRow): ConversationSearchResultItem {
    return {
      messageId: row.message_id,
      conversationId: row.conversation_id,
      threadId: row.thread_id,
      role: row.role,
      title: row.title ?? null,
      workspacePath: row.workspace_path ?? null,
      text: row.text ?? '',
      snippet: row.snippet ?? row.text ?? '',
      createdAt: row.created_at,
      rank: Number(row.rank ?? 0)
    }
  }

  private mapAgentRun(row: AgentRunRow): AgentRun {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      instanceId: row.instance_id,
      triggerKind: row.trigger_kind,
      requestedExecutionPolicy: parseJson<ExecutionPolicy>(row.requested_execution_policy_json, {
        model: { providerId: '', modelId: '' },
        contextEngineId: '',
        memoryProviderId: ''
      }),
      effectiveExecutionSnapshot: parseJson<ExecutionSnapshot>(
        row.effective_execution_snapshot_json,
        {
          model: { providerId: '', modelId: '' },
          contextEngineId: '',
          memoryProviderId: '',
          resolvedAt: row.started_at
        }
      ),
      status: row.status,
      traceId: row.trace_id,
      startedAt: row.started_at,
      endedAt: row.ended_at
    }
  }

  private mapAgentRunProjectionPayload(row: AgentRunProjectionRow): AgentRunProjectionPayload {
    return {
      runId: row.run_id,
      projectionText: row.projection_text ?? '',
      projectionTurns: normalizeProjectionTurns(row.projection_turns_json),
      updatedAt: row.updated_at
    }
  }

  private upsertAgentRunProjection(input: AgentRunProjectionPayload): void {
    this.db
      .prepare(
        `
          INSERT INTO agent_run_projections (
            run_id,
            projection_text,
            projection_turns_json,
            updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET
            projection_text = excluded.projection_text,
            projection_turns_json = excluded.projection_turns_json,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.runId,
        input.projectionText,
        JSON.stringify(normalizeProjectionTurns(input.projectionTurns)),
        input.updatedAt
      )
  }

  private mapInteractionCheckpoint(row: InteractionCheckpointRow): InteractionCheckpoint {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      runId: row.run_id,
      kind: row.kind,
      prompt: row.prompt,
      status: row.status,
      expectedBindingId: row.expected_binding_id,
      expectedPersonId: row.expected_person_id,
      acceptedReplyModes: parseJson<string[] | null>(row.accepted_reply_modes_json, null),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapDeliveryRecord(row: DeliveryRecordRow): DeliveryRecord {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      bindingId: row.binding_id,
      mode: row.mode,
      payloadJson: row.payload_json,
      status: row.status,
      transportDeliveryMode: row.transport_delivery_mode,
      replyContext: parseJson(row.reply_context_json, null),
      degradeMode: row.degrade_mode,
      externalMessageId: row.external_message_id,
      doctorTraceId: row.doctor_trace_id,
      lastError: row.last_error,
      attemptCount: row.attempt_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapConversationWindowProjection(
    row: ConversationWindowProjectionRow
  ): ConversationWindowProjection {
    return {
      conversationId: row.conversation_id,
      agentProfileId: row.agent_profile_id,
      workspaceId: row.workspace_id,
      primarySourceKind: row.primary_source_kind,
      primaryTransportId: row.primary_transport_id,
      primaryTransportAccountId: row.primary_transport_account_id,
      primaryExternalLabel: row.primary_external_label,
      desktopVisibilityMode: row.desktop_visibility_mode,
      startedAt: row.started_at,
      lastMessageAt: row.last_message_at,
      lastRunStatus: row.last_run_status,
      pendingInteractionKind: row.pending_interaction_kind,
      unreadCount: row.unread_count,
      needsAttention: Boolean(row.needs_attention),
      isPinned: Boolean(row.is_pinned),
      updatedAt: row.updated_at
    }
  }

  private mapThreadPlanState(row: ThreadPlanStateRow): ThreadPlanState {
    return {
      threadId: row.thread_id,
      conversationId: row.conversation_id,
      revision: row.revision,
      activeRunId: row.active_run_id,
      sourceToolCallId: row.source_tool_call_id,
      items: parseJson<ThreadPlanItem[]>(row.items_json, []),
      closed: Boolean(row.closed),
      updatedAt: row.updated_at
    }
  }

  private mapEventLogEntry(row: EventLogRow): EventLogEntry {
    return {
      id: row.id,
      eventType: row.event_type,
      traceId: row.trace_id,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      parentEventId: row.parent_event_id,
      sequence: row.sequence,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payloadJson: row.payload_json,
      createdAt: row.created_at
    }
  }

  private requireAgentProfile(id: string): AgentProfile {
    const profile = this.getAgentProfile(id)
    if (!profile) {
      throw new Error(`Unknown AgentProfile: ${id}`)
    }
    return profile
  }

  private requireConversation(id: string): Conversation {
    const conversation = this.getConversation(id)
    if (!conversation) {
      throw new Error(`Unknown Conversation: ${id}`)
    }
    return conversation
  }

  private requireBinding(id: string): ConversationBinding {
    const binding = this.getConversationBinding(id)
    if (!binding) {
      throw new Error(`Unknown ConversationBinding: ${id}`)
    }
    return binding
  }

  private requireDeliveryRecord(id: string): DeliveryRecord {
    const record = this.getDeliveryRecord(id)
    if (!record) {
      throw new Error(`Unknown DeliveryRecord: ${id}`)
    }
    return record
  }

  private requireAgentRun(id: string): AgentRun {
    const run = this.getAgentRun(id)
    if (!run) {
      throw new Error(`Unknown AgentRun: ${id}`)
    }
    return run
  }

  private requireThreadPlanState(threadId: string): ThreadPlanState {
    const state = this.getThreadPlanState(threadId)
    if (!state) {
      throw new Error(`Unknown ThreadPlanState: ${threadId}`)
    }
    return state
  }

  private requireInteractionCheckpoint(id: string): InteractionCheckpoint {
    const row = this.db.prepare(`SELECT * FROM interaction_checkpoints WHERE id = ?`).get(id) as
      | InteractionCheckpointRow
      | undefined
    if (!row) {
      throw new Error(`Unknown InteractionCheckpoint: ${id}`)
    }
    return this.mapInteractionCheckpoint(row)
  }

  private requireEventLogEntry(id: string): EventLogEntry {
    const row = this.db.prepare(`SELECT * FROM event_log WHERE id = ?`).get(id) as
      | EventLogRow
      | undefined
    if (!row) {
      throw new Error(`Unknown EventLogEntry: ${id}`)
    }
    return this.mapEventLogEntry(row)
  }

  // === Conversation Query Tool ===

  listConversations(input: ListConversationsInput): ListConversationsResult {
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 20), 200))
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))

    const clauses: string[] = []
    const params: Array<string | number> = []

    if (input.sourceKind && input.sourceKind !== 'all') {
      const isLocal = input.sourceKind === 'local'
      clauses.push(
        isLocal
          ? `(
              SELECT transport_id FROM conversation_bindings cb
              WHERE cb.conversation_id = conversations.id
              ORDER BY cb.created_at ASC LIMIT 1
            ) IN ('desktop', 'desktop-chat', 'transport-desktop-chat')`
          : `(
              SELECT transport_id FROM conversation_bindings cb
              WHERE cb.conversation_id = conversations.id
              ORDER BY cb.created_at ASC LIMIT 1
            ) NOT IN ('desktop', 'desktop-chat', 'transport-desktop-chat')`
      )
    }

    if (input.dateAfter) {
      clauses.push('(COALESCE(cwp.last_message_at, c.updated_at)) >= ?')
      params.push(input.dateAfter)
    }
    if (input.dateBefore) {
      clauses.push('(COALESCE(cwp.last_message_at, c.updated_at)) <= ?')
      params.push(input.dateBefore)
    }
    if (input.query) {
      const escaped = input.query.replace(/'/g, "''")
      clauses.push('(conversations.title LIKE ? OR conversations.id LIKE ?)')
      params.push(`%${escaped}%`, `%${escaped}%`)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

    // Total count
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM conversations c LEFT JOIN conversation_window_projection cwp ON cwp.conversation_id = c.id ${where}`)
      .get(...params) as { total?: number } | undefined
    const total = Math.max(0, Number(totalRow?.total ?? 0))

    // Items with binding and message count
    const rows = this.db
      .prepare(`
        SELECT
          c.id AS conversation_id,
          c.title,
          c.status,
          c.updated_at,
          c.created_at,
          c.last_run_id,
          cb.id AS binding_id,
          cb.transport_id,
          cb.external_chat_id,
          cb.external_user_id,
          COUNT(cm.id) AS message_count
        FROM conversations c
        LEFT JOIN conversation_window_projection cwp ON cwp.conversation_id = c.id
        LEFT JOIN conversation_bindings cb
          ON cb.conversation_id = c.id
          AND cb.id = (
            SELECT id FROM conversation_bindings
            WHERE conversation_id = c.id
            ORDER BY created_at ASC LIMIT 1
          )
        LEFT JOIN conversation_messages cm
          ON cm.conversation_id = c.id
        ${where}
        GROUP BY c.id
        ORDER BY COALESCE(cwp.last_message_at, c.updated_at) DESC, c.id ASC
        LIMIT ? OFFSET ?
      `)
      .all(...params, limit, offset) as Array<Record<string, unknown>>

    const items = rows.map((row) => {
      const transportId = String(row.transport_id ?? '')
      const sourceKind = deriveConversationSourceKind(transportId)

      return {
        conversationId: String(row.conversation_id),
        title: row.title ? String(row.title) || null : null,
        status: String(row.status) as ConversationStatus,
        sourceKind,
        primaryTransportId: transportId || null,
        primaryExternalLabel:
          (row.title && String(row.title)) ||
          (row.external_user_id && String(row.external_user_id)) ||
          (row.external_chat_id && String(row.external_chat_id)) ||
          null,
        lastMessageAt: null as string | null, // computed from window projection
        lastRunStatus: null as AgentRunStatus | null, // fetched separately
        messageCount: Number(row.message_count) || 0,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
      } as ConversationListItem
    })

    // Enrich with lastMessageAt and lastRunStatus from projections
    const conversationIds = items.map((i) => i.conversationId)
    if (conversationIds.length > 0) {
      const placeholders = conversationIds.map(() => '?').join(',')
      const projections = this.db
        .prepare(
          `
            SELECT conversation_id, last_message_at, last_run_status
            FROM conversation_window_projection
            WHERE conversation_id IN (${placeholders})
          `
        )
        .all(...conversationIds) as Array<{
          conversation_id: string
          last_message_at: string | null
          last_run_status: string | null
        }>
      const projMap = new Map<string, { last_message_at: string | null; last_run_status: string | null }>()
      for (const p of projections) {
        projMap.set(p.conversation_id, {
          last_message_at: p.last_message_at,
          last_run_status: p.last_run_status
        })
      }
      for (const item of items) {
        const proj = projMap.get(item.conversationId)
        if (proj) {
          item.lastMessageAt = proj.last_message_at
          item.lastRunStatus = proj.last_run_status as AgentRunStatus | null
        }
      }
    }

    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total
    }
  }

  listConversationMessages(input: ListConversationMessagesInput): ListConversationMessagesResult {
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50), 200))
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))

    const clauses: string[] = ['cm.conversation_id = ?']
    const params: Array<string | number> = [input.conversationId]

    if (input.dateAfter) {
      clauses.push('cm.created_at >= ?')
      params.push(input.dateAfter)
    }
    if (input.dateBefore) {
      clauses.push('cm.created_at <= ?')
      params.push(input.dateBefore)
    }
    if (input.role) {
      clauses.push('cm.role = ?')
      params.push(input.role)
    }

    const where = `WHERE ${clauses.join(' AND ')}`

    // Total count
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM conversation_messages cm ${where}`)
      .get(...params) as { total?: number } | undefined
    const total = Math.max(0, Number(totalRow?.total ?? 0))

    // Fetch messages ordered by created_at
    const rows = this.db
      .prepare(`
        SELECT
          cm.id AS message_id,
          cm.conversation_id,
          cm.role,
          cm.text,
          cm.created_at,
          c.title AS conversation_title
        FROM conversation_messages cm
        JOIN conversations c ON c.id = cm.conversation_id
        ${where}
        ORDER BY cm.created_at ASC, cm.id ASC
        LIMIT ? OFFSET ?
      `)
      .all(...params, limit, offset) as Array<{
        message_id: string
        conversation_id: string
        role: string
        text: string | null
        created_at: string
        conversation_title: string | null
      }>

    const items = rows.map((row) => ({
      messageId: String(row.message_id),
      conversationId: String(row.conversation_id),
      conversationTitle: row.conversation_title || null,
      role: String(row.role) as MessageRole,
      text: row.text,
      createdAt: String(row.created_at)
    }))

    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total
    }
  }

  listAllConversationMessages(input: ListAllConversationMessagesInput): ListAllConversationMessagesResult {
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50), 200))
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))

    const clauses: string[] = []
    const params: Array<string | number> = []

    if (input.conversationId) {
      clauses.push('cm.conversation_id = ?')
      params.push(input.conversationId)
    }
    if (input.dateAfter) {
      clauses.push('cm.created_at >= ?')
      params.push(input.dateAfter)
    }
    if (input.dateBefore) {
      clauses.push('cm.created_at <= ?')
      params.push(input.dateBefore)
    }
    if (input.role) {
      clauses.push('cm.role = ?')
      params.push(input.role)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

    // Total count
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM conversation_messages cm ${where}`)
      .get(...params) as { total?: number } | undefined
    const total = Math.max(0, Number(totalRow?.total ?? 0))

    // Fetch messages ordered by created_at
    const rows = this.db
      .prepare(`
        SELECT
          cm.id AS message_id,
          cm.conversation_id,
          c.title AS conversation_title,
          cm.role,
          cm.text,
          cm.created_at
        FROM conversation_messages cm
        JOIN conversations c ON c.id = cm.conversation_id
        ${where}
        ORDER BY cm.created_at ASC, cm.id ASC
        LIMIT ? OFFSET ?
      `)
      .all(...params, limit, offset) as Array<{
        message_id: string
        conversation_id: string
        conversation_title: string | null
        role: string
        text: string | null
        created_at: string
      }>

    const items = rows.map((row) => ({
      messageId: String(row.message_id),
      conversationId: String(row.conversation_id),
      conversationTitle: row.conversation_title || null,
      role: String(row.role) as MessageRole,
      text: row.text,
      createdAt: String(row.created_at)
    }))

    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total
    }
  }
}
