import path from 'node:path'
import type { AgentRunProjection } from '../../shared/agent-runtime.ts'
import { generateId } from '../../shared/id.ts'
import { serializeChatMessageContent, type ChatMessageContent } from '../../shared/chat-content.ts'
import type { ConversationEventRow, MessageRow, ThreadRow } from '../../preload/db-types.ts'
import { ensureDefaultAgentProfile } from './default-agent-profile.ts'
import type {
  AgentRunStatus,
  ConversationBindingMatch,
  ConversationExecutionOverride,
  CoreCommandService,
  CoreQueryService,
  ExecutionPolicy
} from './domain.ts'
import { createExecutionSnapshot, mergeExecutionPolicy } from './domain.ts'
import { buildLocalThreadRoutingKey } from './local-thread-binding.ts'
import {
  buildLocalThreadMessagePayload,
  parseLocalThreadMessageMeta
} from './local-thread-message-payload.ts'
import {
  getLocalThreadMessageRowByIdFromService,
  getLocalThreadRowFromService,
  listLocalThreadMessageRowsFromService
} from './local-thread-query.ts'
import { getRuntimeContextServices } from '../context/runtime-context-services.ts'
import { getCoreV2Service } from './sqlite-db.ts'
import { normalizeCoreTimestamp, parseCoreTimestampMs } from './time.ts'

type LocalThreadProjectionStore = {
  getThread(threadId: string): ThreadRow | null
  upsertThread(row: ThreadRow): ThreadRow
  deleteThread(threadId: string): void
  listMessages(threadId: string): MessageRow[]
  getMessage(messageId: string): MessageRow | null
  upsertMessage(row: MessageRow): MessageRow
  deleteMessage(messageId: string): void
  pruneRuntimeAfter(threadId: string, cutoffCreatedAt: string): void
  getUserChatOrdinal(threadId: string, messageId: string): number | null
}

type LocalThreadContextPruner = {
  pruneThreadAfter(threadId: string, cutoffCreatedAt: string): number | void
  deleteThread?: (threadId: string) => boolean | void
}

type MessagePersistenceOptions = {
  messageKind?: MessageRow['message_kind']
  includeInAgentContext?: boolean
  agentTurnId?: string | null
  toolCallId?: string
  stepIndex?: number
  runtimeSequence?: number | null
  createdAt?: string | number | Date | null
}

type LocalThreadHostDeps = {
  core: Pick<
    CoreCommandService & CoreQueryService,
    | 'getConversation'
    | 'getConversationByBindingRoutingKey'
    | 'getConversationBinding'
    | 'getAgentProfile'
    | 'getAgentRun'
    | 'getConversationMessages'
    | 'listConversationRuns'
    | 'listConversationWindows'
    | 'resolveConversationForEnvelope'
    | 'updateConversation'
    | 'upsertConversationMessage'
    | 'upsertAgentRun'
    | 'upsertEventLogEntry'
    | 'deleteConversationMessage'
    | 'pruneConversationRuntimeAfter'
    | 'deleteConversation'
  >
  projectionStore: LocalThreadProjectionStore
  contextPruner?: LocalThreadContextPruner
  resolveAgentProfileId: () => string
}

const DEFAULT_TRANSPORT_ID = 'desktop-chat'
const DEFAULT_TRANSPORT_ACCOUNT_ID = 'desktop'

const parseLegacyRuntimeKey = (
  value: string
): {
  providerId?: string
  modelId: string
} | null => {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  const delimiterIndex = normalized.indexOf('::')
  if (delimiterIndex <= 0) return { modelId: normalized }
  const providerId = normalized.slice(0, delimiterIndex).trim()
  const modelId = normalized.slice(delimiterIndex + 2).trim()
  if (!providerId || !modelId) return { modelId: normalized }
  return { providerId, modelId }
}

const createLegacyThreadExecutionOverride = (
  model?: string | null
): ConversationExecutionOverride | null => {
  const parsedModel = parseLegacyRuntimeKey(model ?? '')
  if (!parsedModel) return null
  return { model: parsedModel }
}

const mergeThreadModelExecutionOverride = (
  override: ConversationExecutionOverride | null | undefined,
  model?: string | null
): ConversationExecutionOverride | null => {
  const parsed = createLegacyThreadExecutionOverride(model)
  if (!parsed) return null
  return {
    ...(override ?? {}),
    model: {
      ...(override?.model ?? {}),
      ...parsed.model
    }
  }
}

const createSyntheticResolveEnvelope = (
  threadId: string,
  workspacePath: string,
  title?: string | null
) => ({
  envelopeId: `local-thread:${threadId}`,
  transportId: DEFAULT_TRANSPORT_ID,
  transportAccountId: DEFAULT_TRANSPORT_ACCOUNT_ID,
  externalMessageId: `local-thread:${threadId}`,
  externalChatId: threadId,
  externalUserId: 'local-user',
  externalUserDisplayName: title?.trim() || path.basename(workspacePath) || 'Local Chat',
  channelKind: 'dm' as const,
  receivedAt: normalizeCoreTimestamp()
})

const mapLegacyMessageDirection = (row: MessageRow): 'inbound' | 'outbound' | 'internal' => {
  if (row.role === 'user') return 'inbound'
  if (row.role === 'assistant') return 'outbound'
  return 'internal'
}

const normalizeMessageKind = (
  value?: MessagePersistenceOptions['messageKind']
): MessageRow['message_kind'] => {
  if (
    value === 'question_answer' ||
    value === 'questionnaire_question' ||
    value === 'questionnaire_answer'
  ) {
    return value
  }
  return 'chat'
}

const mapRuntimeRunStatus = (status: AgentRunProjection['status']): AgentRunStatus => {
  if (status === 'done') return 'finished'
  if (status === 'error') return 'failed'
  if (status === 'aborted') return 'aborted'
  return 'running'
}

const compareExternalIds = (
  left: string | null | undefined,
  right: string | null | undefined
): number => String(left ?? '').localeCompare(String(right ?? ''))

const normalizeMessageText = (value: string | null | undefined): string =>
  String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()

const safeParseJson = (value: string | null): unknown => {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const createCoreBackedProjectionStore = (
  core: LocalThreadHostDeps['core']
): LocalThreadProjectionStore => ({
  getThread: (threadId: string) => getLocalThreadRowFromService(core, threadId),
  upsertThread: (row: ThreadRow) => getLocalThreadRowFromService(core, row.id) ?? { ...row },
  deleteThread: () => {},
  listMessages: (threadId: string) => listLocalThreadMessageRowsFromService(core, threadId),
  getMessage: (messageId: string) => getLocalThreadMessageRowByIdFromService(core, messageId),
  upsertMessage: (row: MessageRow) =>
    getLocalThreadMessageRowByIdFromService(core, row.id) ?? { ...row },
  deleteMessage: () => {},
  pruneRuntimeAfter: () => {},
  getUserChatOrdinal: (threadId: string, messageId: string) => {
    const rows = listLocalThreadMessageRowsFromService(core, threadId).filter(
      (message) => message.role === 'user' && message.message_kind === 'chat'
    )
    const index = rows.findIndex((message) => message.id === messageId)
    return index >= 0 ? index : null
  }
})

export class LocalThreadHostService {
  private readonly core: LocalThreadHostDeps['core']
  private readonly projectionStore: LocalThreadProjectionStore
  private readonly contextPruner?: LocalThreadContextPruner
  private readonly resolveAgentProfileId: () => string

  constructor(deps: LocalThreadHostDeps) {
    this.core = deps.core
    this.projectionStore = deps.projectionStore
    this.contextPruner = deps.contextPruner
    this.resolveAgentProfileId = deps.resolveAgentProfileId
  }

  createThread(input: {
    workspacePath: string
    model?: string | null
    title?: string | null
  }): ThreadRow {
    const threadId = generateId()
    const title = input.title?.trim() || 'newchat'
    const agentProfileId = this.resolveAgentProfileId()
    const executionOverride = createLegacyThreadExecutionOverride(input.model)
    const resolved = this.core.resolveConversationForEnvelope({
      agentProfileId,
      envelope: createSyntheticResolveEnvelope(threadId, input.workspacePath, title),
      workspaceId: input.workspacePath,
      title,
      desktopVisibilityMode: 'read_write',
      executionOverride
    })
    this.core.updateConversation({
      conversationId: resolved.conversation.id,
      workspaceId: input.workspacePath,
      title,
      executionOverride,
      desktopVisibilityMode: 'read_write'
    })

    const row: ThreadRow = {
      id: threadId,
      workspace_path: input.workspacePath,
      title,
      model: input.model ?? null,
      created_at: normalizeCoreTimestamp(resolved.conversation.createdAt),
      started_at: null
    }
    return this.projectionStore.upsertThread(row)
  }

  updateThread(
    threadId: string,
    fields: Partial<Pick<ThreadRow, 'title' | 'started_at' | 'model'>>
  ): ThreadRow {
    const normalizedThreadId = String(threadId ?? '').trim()
    const existing = this.requireThread(normalizedThreadId)
    const match = this.ensureConversationBinding(existing)
    const nextTitle = fields.title !== undefined ? fields.title : existing.title
    const nextModel = fields.model !== undefined ? fields.model : existing.model
    const nextStartedAt = fields.started_at !== undefined ? fields.started_at : existing.started_at

    if (fields.title !== undefined || fields.model !== undefined) {
      this.core.updateConversation({
        conversationId: match.conversation.id,
        title: nextTitle,
        executionOverride:
          fields.model !== undefined
            ? mergeThreadModelExecutionOverride(match.conversation.executionOverride, nextModel)
            : undefined,
        desktopVisibilityMode: 'read_write'
      })
    }

    return this.projectionStore.upsertThread({
      ...existing,
      title: nextTitle ?? null,
      model: nextModel ?? null,
      started_at: nextStartedAt ?? null
    })
  }

  deleteThread(threadId: string): void {
    const normalizedThreadId = String(threadId ?? '').trim()
    const match = this.core.getConversationByBindingRoutingKey(
      buildLocalThreadRoutingKey(normalizedThreadId)
    )
    if (match) {
      this.core.deleteConversation({ conversationId: match.conversation.id })
    }
    this.projectionStore.deleteThread(normalizedThreadId)

    // 清理 context.db 中的相关数据
    if (this.contextPruner?.deleteThread) {
      this.contextPruner.deleteThread(normalizedThreadId)
    }
  }

  addMessage(
    threadId: string,
    role: MessageRow['role'],
    content: string,
    agentRunId?: string | null,
    contentJson?: ChatMessageContent | null,
    options?: MessagePersistenceOptions
  ): MessageRow {
    const thread = this.requireThread(threadId)
    const match = this.ensureConversationBinding(thread)
    const candidate = this.buildMessageRow(
      generateId(),
      thread.id,
      role,
      content,
      agentRunId,
      contentJson,
      options
    )
    const existing = this.findExistingMessageForAdd(thread.id, candidate)
    const row = existing ? this.mergeExistingMessageForAdd(existing, candidate, options) : candidate
    this.core.upsertConversationMessage({
      conversationId: match.conversation.id,
      bindingId: match.binding.id,
      externalMessageId: row.id,
      role: row.role,
      direction: mapLegacyMessageDirection(row),
      text: row.content,
      payload: buildLocalThreadMessagePayload(row),
      createdAt: row.created_at
    })
    return this.projectionStore.upsertMessage(row)
  }

  updateMessage(
    id: string,
    content: string,
    contentJson?: ChatMessageContent | null
  ): MessageRow | null {
    const existing = this.projectionStore.getMessage(id)
    if (!existing) return null
    const thread = this.requireThread(existing.thread_id)
    const match = this.ensureConversationBinding(thread)
    const next: MessageRow = {
      ...existing,
      content,
      content_json: serializeChatMessageContent(contentJson) ?? null
    }
    this.upsertCoreMessage(match, next)
    return this.projectionStore.upsertMessage(next)
  }

  setMessageAgentEntryId(id: string, agentEntryId: string): MessageRow | null {
    const existing = this.projectionStore.getMessage(id)
    if (!existing) return null
    const thread = this.requireThread(existing.thread_id)
    const match = this.ensureConversationBinding(thread)
    const next: MessageRow = {
      ...existing,
      agent_entry_id: String(agentEntryId ?? '').trim() || null
    }
    this.upsertCoreMessage(match, next)
    return this.projectionStore.upsertMessage(next)
  }

  updateUserMessageRuntimeLink(
    id: string,
    fields: {
      agentRunId?: string | null
      agentTurnId?: string | null
      runtimeSequence?: number | null
      createdAt?: string | number | Date | null
    }
  ): MessageRow | null {
    const existing = this.projectionStore.getMessage(id)
    if (!existing) return null
    if (existing.role !== 'user' || existing.message_kind !== 'chat') return existing
    const thread = this.requireThread(existing.thread_id)
    const match = this.ensureConversationBinding(thread)
    const next: MessageRow = {
      ...existing,
      agent_run_id:
        fields.agentRunId === undefined
          ? existing.agent_run_id
          : String(fields.agentRunId ?? '').trim() || null,
      agent_turn_id:
        fields.agentTurnId === undefined
          ? existing.agent_turn_id
          : String(fields.agentTurnId ?? '').trim() || null,
      runtime_sequence:
        typeof fields.runtimeSequence === 'number' && Number.isFinite(fields.runtimeSequence)
          ? Math.trunc(fields.runtimeSequence)
          : existing.runtime_sequence,
      created_at:
        fields.createdAt === undefined
          ? existing.created_at
          : normalizeCoreTimestamp(fields.createdAt)
    }
    this.upsertCoreMessage(match, next)
    return this.projectionStore.upsertMessage(next)
  }

  prepareUserMessageForRetry(id: string): MessageRow | null {
    const existing = this.projectionStore.getMessage(id)
    if (!existing) return null
    if (existing.role !== 'user' || existing.message_kind !== 'chat') return existing
    const thread = this.requireThread(existing.thread_id)
    const match = this.ensureConversationBinding(thread)
    const next: MessageRow = {
      ...existing,
      agent_run_id: null,
      agent_turn_id: null,
      runtime_sequence: null
    }
    this.upsertCoreMessage(match, next)
    return this.projectionStore.upsertMessage(next)
  }

  deleteMessage(id: string): boolean {
    const existing = this.projectionStore.getMessage(id)
    if (!existing) return false
    const thread = this.projectionStore.getThread(existing.thread_id)
    if (thread) {
      const match = this.ensureConversationBinding(thread)
      this.core.deleteConversationMessage({
        conversationId: match.conversation.id,
        externalMessageId: existing.id
      })
    }
    this.projectionStore.deleteMessage(id)
    return true
  }

  ensureConsumedUserMessage(input: {
    threadId: string
    text: string
    agentRunId: string
    agentTurnId?: string | null
    consumedAt: string | number | Date
    runtimeSequence?: number | null
  }): MessageRow | null {
    const normalizedThreadId = String(input.threadId ?? '').trim()
    const normalizedText = String(input.text ?? '')
      .replace(/\r\n/g, '\n')
      .trim()
    const normalizedRunId = String(input.agentRunId ?? '').trim()
    if (!normalizedThreadId || !normalizedText || !normalizedRunId) return null

    const consumedAt = normalizeCoreTimestamp(input.consumedAt)
    const recentCandidates = this.projectionStore
      .listMessages(normalizedThreadId)
      .filter(
        (row) =>
          row.role === 'user' &&
          row.message_kind === 'chat' &&
          row.content.replace(/\r\n/g, '\n').trim() === normalizedText
      )
      .sort(
        (left, right) =>
          right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id)
      )
      .slice(0, 20)

    const matchedCandidate = recentCandidates.find((row) => {
      const delta = Math.abs(
        parseCoreTimestampMs(row.created_at) - parseCoreTimestampMs(consumedAt)
      )
      return Number.isFinite(delta) && delta <= 60_000
    })

    if (matchedCandidate) {
      // Preserve the original local send timestamp. Overwriting with runtime
      // consumedAt (message.started) is later than run/turn start, which can make
      // live recovered assistants sort before the user message mid-stream.
      return this.updateUserMessageRuntimeLink(matchedCandidate.id, {
        agentRunId: normalizedRunId,
        agentTurnId: input.agentTurnId ?? null,
        runtimeSequence: input.runtimeSequence ?? null
      })
    }

    // No local row yet (e.g. swallowed follow-up): create with consume time.
    return this.addMessage(normalizedThreadId, 'user', normalizedText, normalizedRunId, null, {
      agentTurnId: input.agentTurnId ?? null,
      runtimeSequence: input.runtimeSequence ?? null,
      createdAt: consumedAt
    })
  }

  persistRuntimeEvents(threadId: string, rows: ConversationEventRow[]): number {
    const thread = this.requireThread(threadId)
    const match = this.ensureConversationBinding(thread)

    for (const row of rows) {
      const aggregateType = row.agent_run_id ? 'agent_run' : 'conversation'
      const aggregateId = row.agent_run_id || match.conversation.id
      this.core.upsertEventLogEntry({
        id: row.id,
        eventType: row.event_type,
        traceId: row.agent_run_id || row.correlation_id || match.conversation.id,
        correlationId: row.correlation_id || row.id,
        aggregateType,
        aggregateId,
        payload: {
          payload: safeParseJson(row.payload_json),
          localThread: {
            threadId: row.thread_id,
            agentRunId: row.agent_run_id,
            eventOrigin: row.event_origin,
            raw: safeParseJson(row.raw_json)
          }
        },
        createdAt: row.created_at
      })
    }

    return rows.length
  }

  persistFinalizedRun(threadId: string, run: AgentRunProjection): void {
    const thread = this.requireThread(threadId)
    const match = this.ensureConversationBinding(thread)
    const requestedExecutionPolicy = this.buildRequestedExecutionPolicy(match, thread)
    const startedAt = normalizeCoreTimestamp(run.startedAt)
    const endedAt = run.endedAt == null ? null : normalizeCoreTimestamp(run.endedAt)

    this.core.upsertAgentRun({
      id: run.agentRunId,
      conversationId: match.conversation.id,
      triggerKind: 'user_message',
      requestedExecutionPolicy,
      effectiveExecutionSnapshot: createExecutionSnapshot(requestedExecutionPolicy, startedAt),
      status: mapRuntimeRunStatus(run.status),
      traceId: run.agentRunId,
      projectionText: run.text,
      projectionTurns: run.turns,
      startedAt,
      endedAt
    })
  }

  pruneRuntimeAfter(threadId: string, cutoffCreatedAt: string): void {
    const thread = this.requireThread(threadId)
    const match = this.ensureConversationBinding(thread)
    this.core.pruneConversationRuntimeAfter({
      conversationId: match.conversation.id,
      cutoffCreatedAt
    })
    this.contextPruner?.pruneThreadAfter(threadId, cutoffCreatedAt)
    this.projectionStore.pruneRuntimeAfter(threadId, cutoffCreatedAt)
  }

  getUserChatOrdinal(threadId: string, messageId: string): number | null {
    const thread = this.requireThread(threadId)
    const match = this.ensureConversationBinding(thread)
    const messages = this.core
      .getConversationMessages(match.conversation.id)
      .filter((message) => message.role === 'user')
      .map((message) => {
        const messageKind = parseLocalThreadMessageMeta(message).messageKind
        return {
          externalMessageId: message.externalMessageId,
          createdAt: message.createdAt,
          messageKind
        }
      })
      .filter((message) => message.messageKind === 'chat')
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          compareExternalIds(left.externalMessageId, right.externalMessageId)
      )
    const index = messages.findIndex((message) => message.externalMessageId === messageId)
    if (index >= 0) return index
    return this.projectionStore.getUserChatOrdinal(threadId, messageId)
  }

  private requireThread(threadId: string): ThreadRow {
    const thread = this.projectionStore.getThread(threadId)
    if (!thread) throw new Error(`Unknown local thread: ${threadId}`)
    return thread
  }

  private ensureConversationBinding(thread: ThreadRow): ConversationBindingMatch {
    const routingKey = buildLocalThreadRoutingKey(thread.id)
    const existing = this.core.getConversationByBindingRoutingKey(routingKey)
    if (existing) return existing

    const agentProfileId = this.resolveAgentProfileId()
    const executionOverride = createLegacyThreadExecutionOverride(thread.model)
    const resolved = this.core.resolveConversationForEnvelope({
      agentProfileId,
      envelope: createSyntheticResolveEnvelope(thread.id, thread.workspace_path, thread.title),
      workspaceId: thread.workspace_path,
      title: thread.title?.trim() || path.basename(thread.workspace_path) || 'Local Chat',
      desktopVisibilityMode: 'read_write',
      executionOverride
    })
    const conversation = this.core.updateConversation({
      conversationId: resolved.conversation.id,
      workspaceId: thread.workspace_path,
      title: thread.title?.trim() || resolved.conversation.title,
      executionOverride,
      desktopVisibilityMode: 'read_write'
    })
    return {
      conversation,
      binding: resolved.binding
    }
  }

  private buildRequestedExecutionPolicy(
    match: ConversationBindingMatch,
    thread: ThreadRow
  ): ExecutionPolicy {
    const profile = this.core.getAgentProfile(match.conversation.agentProfileId)
    if (!profile) {
      throw new Error(`Unknown AgentProfile: ${match.conversation.agentProfileId}`)
    }
    return mergeExecutionPolicy(
      profile.defaultExecutionPolicy,
      match.conversation.executionOverride ?? createLegacyThreadExecutionOverride(thread.model),
      null
    )
  }

  private findExistingMessageForAdd(threadId: string, candidate: MessageRow): MessageRow | null {
    const messages = this.projectionStore
      .listMessages(threadId)
      .slice()
      .sort(
        (left, right) =>
          left.created_at.localeCompare(right.created_at) || compareExternalIds(left.id, right.id)
      )

    if (candidate.role === 'user' && candidate.message_kind === 'chat' && candidate.agent_run_id) {
      return (
        messages.find(
          (message) =>
            message.role === 'user' &&
            message.message_kind === 'chat' &&
            message.agent_run_id === candidate.agent_run_id &&
            normalizeMessageText(message.content) === normalizeMessageText(candidate.content)
        ) ?? null
      )
    }

    if (candidate.role === 'assistant' && candidate.agent_run_id && candidate.agent_turn_id) {
      return (
        messages.find(
          (message) =>
            message.role === 'assistant' &&
            message.agent_run_id === candidate.agent_run_id &&
            message.agent_turn_id === candidate.agent_turn_id
        ) ?? null
      )
    }

    if (candidate.role === 'assistant' && candidate.agent_run_id && !candidate.agent_turn_id) {
      return (
        messages.find(
          (message) =>
            message.role === 'assistant' &&
            message.agent_run_id === candidate.agent_run_id &&
            !String(message.agent_turn_id ?? '').trim()
        ) ?? null
      )
    }

    if (
      candidate.tool_call_id &&
      (candidate.message_kind === 'question_answer' ||
        candidate.message_kind === 'questionnaire_question' ||
        candidate.message_kind === 'questionnaire_answer')
    ) {
      return (
        messages.find(
          (message) =>
            message.role === candidate.role &&
            message.message_kind === candidate.message_kind &&
            message.tool_call_id === candidate.tool_call_id &&
            (message.step_index ?? null) === (candidate.step_index ?? null)
        ) ?? null
      )
    }

    return null
  }

  private mergeExistingMessageForAdd(
    existing: MessageRow,
    candidate: MessageRow,
    options?: MessagePersistenceOptions
  ): MessageRow {
    return {
      ...existing,
      ...candidate,
      id: existing.id,
      agent_entry_id: existing.agent_entry_id,
      created_at: options?.createdAt === undefined ? existing.created_at : candidate.created_at
    }
  }

  private buildMessageRow(
    id: string,
    threadId: string,
    role: MessageRow['role'],
    content: string,
    agentRunId?: string | null,
    contentJson?: ChatMessageContent | null,
    options?: MessagePersistenceOptions
  ): MessageRow {
    return {
      id,
      thread_id: threadId,
      role,
      message_kind: normalizeMessageKind(options?.messageKind),
      include_in_agent_context: options?.includeInAgentContext === false ? 0 : 1,
      content,
      content_json: serializeChatMessageContent(contentJson) ?? null,
      agent_run_id: String(agentRunId ?? '').trim() || null,
      agent_entry_id: null,
      agent_turn_id: String(options?.agentTurnId ?? '').trim() || null,
      tool_call_id: String(options?.toolCallId ?? '').trim() || null,
      step_index:
        typeof options?.stepIndex === 'number' && Number.isInteger(options.stepIndex)
          ? options.stepIndex
          : null,
      runtime_sequence:
        typeof options?.runtimeSequence === 'number' && Number.isFinite(options.runtimeSequence)
          ? Math.trunc(options.runtimeSequence)
          : null,
      created_at: normalizeCoreTimestamp(options?.createdAt)
    }
  }

  private upsertCoreMessage(match: ConversationBindingMatch, row: MessageRow): void {
    this.core.upsertConversationMessage({
      conversationId: match.conversation.id,
      bindingId: match.binding.id,
      externalMessageId: row.id,
      role: row.role,
      direction: mapLegacyMessageDirection(row),
      text: row.content,
      payload: buildLocalThreadMessagePayload(row),
      createdAt: row.created_at
    })
  }
}

let localThreadHostSingleton: LocalThreadHostService | null = null

export const getLocalThreadHostService = async (): Promise<LocalThreadHostService> => {
  if (localThreadHostSingleton) return localThreadHostSingleton
  const coreService = getCoreV2Service()
  localThreadHostSingleton = new LocalThreadHostService({
    core: coreService,
    projectionStore: createCoreBackedProjectionStore(coreService),
    contextPruner: getRuntimeContextServices().hostService,
    resolveAgentProfileId: () => ensureDefaultAgentProfile(coreService).id
  })
  return localThreadHostSingleton
}
