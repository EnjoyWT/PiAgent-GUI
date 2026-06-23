import type { ChatContentBlock, ChatImageBlock, ChatMessageContent } from '@shared/chat-content'
import type { ChatToolImageProjection, TransportSetupQrProjection } from '@shared/agent-runtime'

export type ChatFileChange = {
  path: string
  diff?: string
  addedLines?: number
  removedLines?: number
}

export type ChatToolStep = {
  id: string
  toolName: string
  toolKind: 'tool' | 'question'
  invocation: 'direct' | 'skill'
  skillName?: string
  status: 'running' | 'done' | 'error'
  args?: unknown
  summary?: string
  accountSetupQr?: TransportSetupQrProjection
  toolImages?: ChatToolImageProjection[]
  startedAt: number
  endedAt?: number
  durationMs?: number
  fileChanges?: ChatFileChange[]
}

export type AgentRunStatus = 'running' | 'done' | 'error' | 'aborted'

export type AgentRunTermination = {
  kind: 'success' | 'error' | 'aborted'
  code?: string
  message?: string
  retriable?: boolean
  willRetry?: boolean
  retryAttempt?: number
  maxRetryAttempts?: number
  at: number
}

export type AgentToolCall = {
  id: string
  agentTurnId?: string | null
  name: string
  kind: 'tool' | 'question'
  invocation: 'direct' | 'skill'
  skillName?: string
  args: unknown
  status: 'running' | 'done' | 'error'
  summary?: string
  accountSetupQr?: TransportSetupQrProjection
  toolImages?: ChatToolImageProjection[]
  fileChanges?: ChatFileChange[]
  startedAt: number
  endedAt?: number
  durationMs?: number
}

export type AgentTurnTimelineTextItem = {
  id: string
  kind: 'text'
  text: string
  agentMessageId?: string
  startedAt: number
  endedAt?: number
}

export type AgentTurnTimelineToolItem = {
  id: string
  kind: 'tool'
  toolCallId: string
}

export type AgentTurnTimelineQuestionAnswerItem = {
  id: string
  kind: 'question_answer'
  toolCallId: string
  text: string
  startedAt: number
}

export type AgentTurnTimelineQuestionnaireQuestionItem = {
  id: string
  kind: 'questionnaire_question'
  toolCallId: string
  stepIndex: number
  text: string
  startedAt: number
}

export type AgentTurnTimelineQuestionnaireAnswerItem = {
  id: string
  kind: 'questionnaire_answer'
  toolCallId: string
  stepIndex: number
  text: string
  startedAt: number
}

export type AgentTurnTimelineThinkingItem = {
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

export type AgentTurn = {
  id?: string
  index: number
  status?: 'running' | 'done' | 'error'
  toolCalls: AgentToolCall[]
  text: string
  terminationReason?: string
  errorMessage?: string
  timelineItems: AgentTurnTimelineItem[]
  startedAt?: number
  endedAt?: number
}

export type AgentRun = {
  id: string
  threadId: string
  status: AgentRunStatus
  turns: AgentTurn[]
  text: string
  startedAt: number
  endedAt?: number
  termination?: AgentRunTermination
  triggerKind?: 'user_message' | 'transport_message' | 'manual' | 'automation' | 'system_followup'
}

export type QueueRuntimeState = 'idle' | 'running' | 'aborting' | 'dispatching'

export type PendingQueueItemStatus = 'queued' | 'submitted'
export type PendingQueueDelivery = 'steer' | 'followUp'

export type PendingQueueItem = {
  id: string
  text: string
  blocks?: ChatContentBlock[]
  images?: ChatImageBlock[]
  createdAt: number
  status: PendingQueueItemStatus
  submissionId?: string
  submittedAt?: number
  delivery?: PendingQueueDelivery
  runtimeText?: string
}

export type ChatWidget = {
  kind: 'html'
  placement: 'inline'
  title?: string
  html?: string
  url?: string
  widgetId?: string
  config?: { showHeader?: boolean; fullWidth?: boolean }
}

export type ChatMessage = {
  id?: string
  agentEntryId?: string
  agentRunId?: string
  agentTurnId?: string
  submissionId?: string
  createdAt?: string
  runtimeSequence?: number | null
  role: 'user' | 'assistant'
  messageKind?:
    | 'chat'
    | 'automation'
    | 'question_answer'
    | 'questionnaire_question'
    | 'questionnaire_answer'
    | 'context_compaction'
  includeInAgentContext?: boolean
  content: string
  blocks?: ChatContentBlock[]
  isPending?: boolean
  run?: AgentRun
  widget?: ChatWidget
  retryCandidate?: boolean
}

export type { ChatContentBlock, ChatImageBlock, ChatMessageContent }
