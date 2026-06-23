import type { ChatContentBlock, ChatImageBlock } from './chat-content'

export type EventOrigin = 'runtime' | 'inferred' | 'reconciled'

export type AgentRuntimeSource = 'pi-mono'

export type AgentRuntimeEventName =
  | 'agentRunStarted'
  | 'agentRunUpdated'
  | 'agentRunFinished'
  | 'agentRunFailed'
  | 'agentRunAborted'
  | 'agentQueueConsumed'
  | 'agentTurnStarted'
  | 'agentTurnFinished'
  | 'agentMessageStarted'
  | 'agentMessageThinkingStarted'
  | 'agentMessageThinkingDelta'
  | 'agentMessageThinkingFinished'
  | 'agentMessageDelta'
  | 'agentMessageFinished'
  | 'agentToolCallStarted'
  | 'agentToolCallProgress'
  | 'agentToolCallFinished'
  | 'agentThreadStarted'
  | 'agentThreadSwitched'
  | 'agentThreadForked'
  | 'agentThreadCompacted'
  | 'agentThreadShutdown'
  | 'agentRuntimeUnknownEvent'

export type AgentAppEventType =
  | 'agent.queue.consumed'
  | 'agent.run.started'
  | 'agent.run.updated'
  | 'agent.run.finished'
  | 'agent.run.failed'
  | 'agent.run.aborted'
  | 'agent.turn.started'
  | 'agent.turn.finished'
  | 'agent.message.started'
  | 'agent.message.delta'
  | 'agent.message.finished'
  | 'agent.tool.started'
  | 'agent.tool.progress'
  | 'agent.tool.finished'
  | 'agent.thread.started'
  | 'agent.thread.switched'
  | 'agent.thread.forked'
  | 'agent.thread.compacted'
  | 'agent.thread.shutdown'

export type AgentRunStatus = 'running' | 'done' | 'error' | 'aborted'
export type AgentTurnStatus = 'running' | 'done' | 'error'
export type AgentMessageStatus = 'running' | 'done' | 'error'
export type AgentToolCallStatus = 'running' | 'done' | 'error'
export type AgentToolCallKind = 'tool' | 'question'
export type AgentToolCallInvocation = 'direct' | 'skill'

export interface TraceContext {
  traceId: string
  correlationId: string
  causationId: string | null
  parentEventId: string | null
  sequence: number
}

export interface ChatFileChange {
  path: string
  diff?: string
  addedLines?: number
  removedLines?: number
}

export interface TransportSetupQrProjection {
  transportId: string
  accountId: string
  methodId: string
  sessionId: string
  imageUrl: string
  qrText?: string
  startedAt?: string
  expiresAt?: string
  status?: 'active' | 'scanned' | 'completed' | 'expired' | 'cancelled' | 'failed'
}

export interface ChatToolImageProjection {
  title: string
  mimeType: string
  path: string
  url: string
  width?: number
  height?: number
}

export interface AgentToolCallProjection {
  toolCallId: string
  agentTurnId: string | null
  name: string
  kind: AgentToolCallKind
  invocation: AgentToolCallInvocation
  skillName?: string
  status: AgentToolCallStatus
  args?: unknown
  summary?: string
  accountSetupQr?: TransportSetupQrProjection
  fileChanges?: ChatFileChange[]
  toolImages?: ChatToolImageProjection[]
  startedAt: number
  endedAt?: number
  durationMs?: number
  origin: EventOrigin
}

export interface AgentTurnTimelineTextItem {
  id: string
  kind: 'text'
  text: string
  agentMessageId?: string
  startedAt: number
  endedAt?: number
}

export interface AgentTurnTimelineToolItem {
  id: string
  kind: 'tool'
  toolCallId: string
}

export interface AgentTurnTimelineQuestionAnswerItem {
  id: string
  kind: 'question_answer'
  toolCallId: string
  text: string
  startedAt: number
}

export interface AgentTurnTimelineQuestionnaireQuestionItem {
  id: string
  kind: 'questionnaire_question'
  toolCallId: string
  stepIndex: number
  text: string
  startedAt: number
}

export interface AgentTurnTimelineQuestionnaireAnswerItem {
  id: string
  kind: 'questionnaire_answer'
  toolCallId: string
  stepIndex: number
  text: string
  startedAt: number
}

export interface AgentTurnTimelineThinkingItem {
  id: string
  kind: 'thinking'
  thinking: string
  agentMessageId?: string
  startedAt: number
  endedAt?: number
}

export type AgentTurnTimelineItem =
  | AgentTurnTimelineTextItem
  | AgentTurnTimelineToolItem
  | AgentTurnTimelineQuestionAnswerItem
  | AgentTurnTimelineQuestionnaireQuestionItem
  | AgentTurnTimelineQuestionnaireAnswerItem
  | AgentTurnTimelineThinkingItem

export interface AgentTurnProjection {
  agentTurnId: string
  index: number
  status: AgentTurnStatus
  startedAt: number
  endedAt?: number
  text: string
  terminationReason?: string
  errorMessage?: string
  timelineItems: AgentTurnTimelineItem[]
  toolCallIds: string[]
  toolCalls: AgentToolCallProjection[]
}

export interface AgentMessageProjection {
  agentMessageId: string
  agentTurnId: string | null
  role: string
  status: AgentMessageStatus
  text: string
  submissionId?: string | null
  startedAt: number
  endedAt?: number
  origin: EventOrigin
}

export interface AgentRunTermination {
  kind: 'success' | 'error' | 'aborted'
  code?: string
  message?: string
  retriable?: boolean
  willRetry?: boolean
  retryAttempt?: number
  maxRetryAttempts?: number
  at: number
}

export interface AgentRunProjection {
  threadId: string
  agentRunId: string
  status: AgentRunStatus
  startedAt: number
  endedAt?: number
  turns: AgentTurnProjection[]
  messages: AgentMessageProjection[]
  toolCalls: AgentToolCallProjection[]
  text: string
  termination?: AgentRunTermination
  triggerKind?: 'user_message' | 'transport_message' | 'manual' | 'automation' | 'system_followup'
}

export interface AgentThreadMessageProjection {
  id?: string
  createdAt?: string
  runtimeSequence?: number | null
  agentRunId?: string | null
  agentTurnId?: string | null
  agentEntryId?: string | null
  submissionId?: string | null
  role: 'user' | 'assistant'
  messageKind?:
    | 'chat'
    | 'automation'
    | 'question_answer'
    | 'questionnaire_question'
    | 'questionnaire_answer'
  includeInAgentContext?: boolean
  content: string
  blocks?: ChatContentBlock[]
  isPending: boolean
  widget?: {
    kind: 'html'
    placement: 'inline'
    title?: string
    html?: string
    url?: string
    widgetId?: string
    config?: { showHeader?: boolean; fullWidth?: boolean }
  }
}

export interface AgentThreadProjection {
  threadId: string
  activeRunId: string | null
  isStreaming: boolean
  updatedAt: number
  runs: AgentRunProjection[]
  messages: AgentThreadMessageProjection[]
}

export interface AgentThreadWindowCursor {
  createdAt: string
  runtimeSequence?: number | null
  id: string
}

export interface AgentThreadWindowAroundTarget {
  messageId: string
  before?: number
  after?: number
}

export interface AgentThreadWindowPageInfo {
  hasMoreBefore: boolean
  nextBeforeCursor: AgentThreadWindowCursor | null
}

export interface AgentThreadWindowPage {
  threadId: string
  activeRunId: string | null
  isStreaming: boolean
  updatedAt: number
  runs: AgentRunProjection[]
  messages: AgentThreadMessageProjection[]
  pageInfo: AgentThreadWindowPageInfo
}

export interface AgentSubmittedQueueItem {
  id: string
  threadId: string
  delivery: 'steer' | 'followUp'
  text: string
  submissionId?: string
  createdAt: number
  submittedAt: number
  images?: ChatImageBlock[]
}

export interface NormalizedAgentRuntimeEvent<T = unknown> extends TraceContext {
  id: string
  source: AgentRuntimeSource
  type: AgentRuntimeEventName
  timestamp: number
  threadId: string
  agentRunId: string | null
  runtimeAgentRunId?: string | null
  agentTurnId: string | null
  agentMessageId: string | null
  toolCallId: string | null
  origin: EventOrigin
  payload: T
  raw: unknown
}

export interface AgentAppEventBase extends TraceContext {
  id: string
  type: AgentAppEventType
  timestamp: number
  threadId: string
  agentRunId: string | null
  agentTurnId: string | null
}

export interface AgentRunStartedAppEvent extends AgentAppEventBase {
  type: 'agent.run.started'
  agentRunId: string
  run: AgentRunProjection
}

export interface AgentRunUpdatedAppEvent extends AgentAppEventBase {
  type: 'agent.run.updated'
  agentRunId: string
  run: AgentRunProjection
}

export interface AgentRunFinishedAppEvent extends AgentAppEventBase {
  type: 'agent.run.finished'
  agentRunId: string
  run: AgentRunProjection
}

export interface AgentRunFailedAppEvent extends AgentAppEventBase {
  type: 'agent.run.failed'
  agentRunId: string
  run: AgentRunProjection
}

export interface AgentRunAbortedAppEvent extends AgentAppEventBase {
  type: 'agent.run.aborted'
  agentRunId: string
  run: AgentRunProjection
}

export interface AgentQueueConsumedAppEvent extends AgentAppEventBase {
  type: 'agent.queue.consumed'
  queueItemId: string
  delivery: 'steer' | 'followUp'
  text: string
  submissionId?: string | null
}

export interface AgentTurnStartedAppEvent extends AgentAppEventBase {
  type: 'agent.turn.started'
  agentRunId: string
  agentTurnId: string
  turn: AgentTurnProjection
}

export interface AgentTurnFinishedAppEvent extends AgentAppEventBase {
  type: 'agent.turn.finished'
  agentRunId: string
  agentTurnId: string
  turn: AgentTurnProjection
}

export interface AgentMessageStartedAppEvent extends AgentAppEventBase {
  type: 'agent.message.started'
  agentRunId: string
  agentMessageId: string
  agentTurnId: string | null
  queueItemId?: string | null
  submissionId?: string | null
  message: AgentMessageProjection
}

export interface AgentMessageDeltaAppEvent extends AgentAppEventBase {
  type: 'agent.message.delta'
  agentRunId: string
  agentMessageId: string
  agentTurnId: string | null
  contentKind: 'text' | 'thinking'
  delta: string
}

export interface AgentMessageFinishedAppEvent extends AgentAppEventBase {
  type: 'agent.message.finished'
  agentRunId: string
  agentMessageId: string
  agentTurnId: string | null
  submissionId?: string | null
  message: AgentMessageProjection
}

export interface AgentToolStartedAppEvent extends AgentAppEventBase {
  type: 'agent.tool.started'
  agentRunId: string
  toolCallId: string
  tool: AgentToolCallProjection
}

export interface AgentToolProgressAppEvent extends AgentAppEventBase {
  type: 'agent.tool.progress'
  agentRunId: string
  toolCallId: string
  tool: AgentToolCallProjection
}

export interface AgentToolFinishedAppEvent extends AgentAppEventBase {
  type: 'agent.tool.finished'
  agentRunId: string
  toolCallId: string
  tool: AgentToolCallProjection
}

export interface AgentThreadLifecycleAppEvent extends AgentAppEventBase {
  type:
    | 'agent.thread.started'
    | 'agent.thread.switched'
    | 'agent.thread.forked'
    | 'agent.thread.compacted'
    | 'agent.thread.shutdown'
}

export type AgentAppEvent =
  | AgentQueueConsumedAppEvent
  | AgentRunStartedAppEvent
  | AgentRunUpdatedAppEvent
  | AgentRunFinishedAppEvent
  | AgentRunFailedAppEvent
  | AgentRunAbortedAppEvent
  | AgentTurnStartedAppEvent
  | AgentTurnFinishedAppEvent
  | AgentMessageStartedAppEvent
  | AgentMessageDeltaAppEvent
  | AgentMessageFinishedAppEvent
  | AgentToolStartedAppEvent
  | AgentToolProgressAppEvent
  | AgentToolFinishedAppEvent
  | AgentThreadLifecycleAppEvent
