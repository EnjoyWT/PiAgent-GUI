import type { NormalizedAgentRuntimeEvent } from '@shared/agent-runtime'

export type {
  AgentAppEvent,
  AgentAppEventBase,
  AgentAppEventType,
  AgentQueueConsumedAppEvent,
  AgentMessageDeltaAppEvent,
  AgentMessageFinishedAppEvent,
  AgentMessageProjection,
  AgentMessageStartedAppEvent,
  AgentRunAbortedAppEvent,
  AgentRunFailedAppEvent,
  AgentRunFinishedAppEvent,
  AgentRunProjection,
  AgentRunStartedAppEvent,
  AgentRunStatus,
  AgentRunTermination,
  AgentRunUpdatedAppEvent,
  AgentThreadLifecycleAppEvent,
  AgentToolCallProjection,
  AgentToolFinishedAppEvent,
  AgentToolProgressAppEvent,
  AgentToolStartedAppEvent,
  AgentTurnTimelineItem,
  AgentTurnFinishedAppEvent,
  AgentTurnProjection,
  AgentTurnStartedAppEvent,
  ChatFileChange,
  EventOrigin
} from '@shared/agent-runtime'

export interface AgentRunStartedPayload {
  rawType: 'agent_start'
}

export interface AgentQueueConsumedPayload {
  rawType: 'queue_consumed'
  queueItemId: string
  delivery: 'steer' | 'followUp'
  submissionId?: string | null
  message?: unknown
}

export interface AgentRunEndedPayload {
  rawType: 'agent_end'
  messages: unknown[]
  requestedStatus: 'finished' | 'failed' | 'aborted'
  willRetry?: boolean
  retryAttempt?: number
  maxRetryAttempts?: number
}

export interface AgentTurnStartedPayload {
  rawType: 'turn_start'
  turnIndex: number
}

export interface AgentTurnFinishedPayload {
  rawType: 'turn_end'
  turnIndex: number
  message?: unknown
  toolResults: unknown[]
}

export interface AgentMessageStartedPayload {
  rawType: 'message_start'
  role: string
  message: unknown
  retrying: boolean
  submissionId?: string | null
}

export interface AgentMessageThinkingStartedPayload {
  rawType: 'message_update'
  message: unknown
  assistantMessageEvent: unknown
}

export interface AgentMessageThinkingDeltaPayload {
  rawType: 'message_update'
  delta: string
  message: unknown
  assistantMessageEvent: unknown
}

export interface AgentMessageThinkingFinishedPayload {
  rawType: 'message_update'
  content: string
  message: unknown
  assistantMessageEvent: unknown
}

export interface AgentMessageDeltaPayload {
  rawType: 'message_update'
  delta: string
  message: unknown
  assistantMessageEvent: unknown
}

export interface AgentMessageFinishedPayload {
  rawType: 'message_end'
  role: string
  message: unknown
  submissionId?: string | null
}

export interface AgentToolCallStartedPayload {
  rawType: 'tool_execution_start'
  toolName: string
  args?: unknown
}

export interface AgentToolCallProgressPayload {
  rawType: 'tool_execution_update'
  toolName: string
  args?: unknown
  partialResult?: unknown
}

export interface AgentToolCallFinishedPayload {
  rawType: 'tool_execution_end'
  toolName: string
  args?: unknown
  result?: unknown
  isError: boolean
}

export interface AgentThreadEventPayload {
  rawType:
    | 'session_start'
    | 'session_switch'
    | 'session_fork'
    | 'session_compact'
    | 'session_shutdown'
  data?: unknown
}

export interface AgentRuntimeUnknownPayload {
  rawType: string
  data?: unknown
}

export type KnownNormalizedAgentRuntimeEvent =
  | NormalizedAgentRuntimeEvent<AgentRunStartedPayload>
  | NormalizedAgentRuntimeEvent<AgentQueueConsumedPayload>
  | NormalizedAgentRuntimeEvent<AgentRunEndedPayload>
  | NormalizedAgentRuntimeEvent<AgentTurnStartedPayload>
  | NormalizedAgentRuntimeEvent<AgentTurnFinishedPayload>
  | NormalizedAgentRuntimeEvent<AgentMessageStartedPayload>
  | NormalizedAgentRuntimeEvent<AgentMessageThinkingStartedPayload>
  | NormalizedAgentRuntimeEvent<AgentMessageThinkingDeltaPayload>
  | NormalizedAgentRuntimeEvent<AgentMessageThinkingFinishedPayload>
  | NormalizedAgentRuntimeEvent<AgentMessageDeltaPayload>
  | NormalizedAgentRuntimeEvent<AgentMessageFinishedPayload>
  | NormalizedAgentRuntimeEvent<AgentToolCallStartedPayload>
  | NormalizedAgentRuntimeEvent<AgentToolCallProgressPayload>
  | NormalizedAgentRuntimeEvent<AgentToolCallFinishedPayload>
  | NormalizedAgentRuntimeEvent<AgentThreadEventPayload>
  | NormalizedAgentRuntimeEvent<AgentRuntimeUnknownPayload>
