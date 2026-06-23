import type { Api, Message, Usage } from '@enjoywt/pi-ai'
import type { AgentRunProjection } from '@shared/agent-runtime'
import type {
  ContextEngineConfig,
  ContextEngineMode,
  ContextPressureEstimate
} from '@shared/context-engine'
import type { PendingQuestion, QuestionToolResult } from '@shared/question-tool'
import type { PendingQuestionnaire, QuestionnaireAnswerPayload } from '@shared/questionnaire-tool'
import type { MessageRow } from '../../preload/db-types.ts'

export type ContextSourceKind = 'message' | 'tool' | 'question' | 'answer' | 'summary'

export type ContextSemanticKind =
  | 'user_message'
  | 'assistant_message'
  | 'tool_result'
  | 'tool_result_summary'
  | 'question_prompt'
  | 'question_answer'
  | 'thread_summary'

export type ContextRole = 'user' | 'assistant' | 'tool' | 'system'

export type ContextCompactPolicy = 'keep' | 'summarize'

export type ContextEntry = {
  id: string
  threadId: string
  seq: number
  agentRunId?: string | null
  agentTurnId?: string | null
  sourceKind: ContextSourceKind
  sourceRef?: string | null
  groupId?: string | null
  role: ContextRole
  semanticKind: ContextSemanticKind
  includeInModelContext: boolean
  includeInMemory: boolean
  compactPolicy: ContextCompactPolicy
  contentText?: string | null
  contentJson?: string | null
  tokenEstimate?: number | null
  createdAt: string
}

export type ContextEntryInput = Omit<ContextEntry, 'id' | 'seq' | 'createdAt'> & {
  createdAt: string | number | Date | null
}

export type ThreadContextHead = {
  threadId: string
  engineName: string
  activeSummaryEntryId?: string | null
  compactedUntilSeq?: number | null
  revision: number
  updatedAt: string
}

export type ContextCompactionReason = 'preflight' | 'after_run' | 'manual' | 'rebuild'

export type ContextCompaction = {
  id: string
  threadId: string
  engineName: string
  reason: ContextCompactionReason
  baseSummaryEntryId?: string | null
  newSummaryEntryId?: string | null
  fromSeqExclusive: number
  compactedUntilSeq: number
  protectedTailStartSeq?: number | null
  estimatedInputTokens?: number | null
  estimatedOutputTokens?: number | null
  createdAt: string
}

export type ContextEngineStateRow = {
  threadId: string
  engineName: string
  stateJson: string
  updatedAt: string
}

export type SummaryCompressorState = {
  previousSummary?: string | null
  failureCount?: number
  lastFailureAt?: string | null
  cooldownUntil?: string | null
}

export type ContextModelSeed = {
  api: Api
  provider: unknown
  id: string
}

export type ModelSeedSnapshot = {
  messages: Message[]
  revision: number
}

export type ContextCompactionResult = {
  changed: boolean
  reason: ContextCompactionReason
  summaryEntryId?: string | null
  revision: number
}

export type ContextCaptureQuestionAnswerInput = {
  threadId: string
  pending: PendingQuestion
  result: QuestionToolResult
  createdAt?: Date | string | number
}

export type ContextCaptureQuestionnaireAnswerInput = {
  threadId: string
  pending: PendingQuestionnaire
  payload: QuestionnaireAnswerPayload
  createdAt?: Date | string | number
}

export type ContextCaptureRunInput = {
  threadId: string
  run: AgentRunProjection
}

export type ContextConsumedUserMessageInput = {
  message: MessageRow
}

export const zeroUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
})

export type { ContextEngineConfig, ContextEngineMode, ContextPressureEstimate }
