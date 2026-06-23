import { generateId } from '../../shared/id.ts'

export type SubagentGroupStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'canceled'
  | 'timed_out'
  | 'interrupted'

export type SubagentTaskStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'timed_out'
  | 'cancel_requested'
  | 'canceled'
  | 'interrupted'

export type SubagentAttemptStatus =
  | 'created'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'timed_out'
  | 'cancel_requested'
  | 'canceled'
  | 'worker_lost'

export type SubagentWaitStrategy =
  | 'none'
  | 'all'
  | 'all_settled'
  | 'first_success'
  | 'first_completed'
  | 'quorum'

export type SubagentEventKind =
  | 'group_created'
  | 'task_queued'
  | 'task_started'
  | 'runtime_event'
  | 'progress'
  | 'task_completed'
  | 'task_failed'
  | 'task_canceled'
  | 'task_timed_out'
  | 'group_settled'
  | 'worker_lost'
  | 'supervisor_report_generated'

export type SubagentEventSeverity = 'debug' | 'info' | 'warning' | 'error'

export type SubagentTaskGroup = {
  id: string
  parentConversationId: string
  parentRunId: string
  parentMessageId?: string | null
  parentToolCallId: string
  idempotencyKey?: string | null
  status: SubagentGroupStatus
  waitStrategy: SubagentWaitStrategy
  createdAt: string
  startedAt?: string | null
  settledAt?: string | null
}

export type SubagentTask = {
  id: string
  groupId: string
  parentConversationId: string
  parentRunId: string
  label?: string | null
  instruction: string
  status: SubagentTaskStatus
  depth: number
  workspaceMode: WorkerWorkspacePolicy['mode']
  cwd: string
  toolAllowlist: string[]
  retryCount: number
  currentAttemptId?: string | null
  resultSummary?: string | null
  error?: string | null
  createdAt: string
  startedAt?: string | null
  settledAt?: string | null
}

export type SubagentAttempt = {
  id: string
  taskId: string
  groupId: string
  parentRunId: string
  correlationId?: string | null
  attemptNumber: number
  status: SubagentAttemptStatus
  workerSessionId?: string | null
  processId?: number | null
  result?: WorkerResultEnvelope | null
  error?: string | null
  createdAt: string
  startedAt?: string | null
  settledAt?: string | null
  leaseExpiresAt?: string | null
}

export type SubagentEventInput = {
  id: string
  groupId: string
  taskId?: string | null
  attemptId?: string | null
  kind: SubagentEventKind
  runtimeEventId?: string | null
  severity: SubagentEventSeverity
  payload: unknown
  createdAt: string
}

export type SubagentEvent = SubagentEventInput & {
  groupEventSeq: number
}

export type WorkerWorkspacePolicy =
  | { mode: 'readonly'; readableRoots: string[]; writableRoots: [] }
  | { mode: 'scratch'; readableRoots: string[]; writableRoots: [string] }
  | { mode: 'worktree'; readableRoots: string[]; writableRoots: [string]; worktreePath: string }

export type WorkerPromptPackage = {
  systemPrompt: string
  contextMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  taskInstruction: string
  resultContract: string
}

export type WorkerPermissionSnapshot = {
  readableRoots: string[]
  writableRoots: string[]
  allowedTools: string[]
  deniedTools: string[]
  network: { enabled: boolean; allowHosts?: string[] }
  secrets: { mode: 'none' | 'explicit'; allowedSecretRefs?: string[] }
  shell: { enabled: boolean; allowedCommands?: string[] }
  environment: { allowedKeys: string[] }
}

export type WorkerModelPolicy = {
  providerId: string
  modelId: string
  reasoningLevel?: string | null
  maxInputTokens?: number | null
  maxOutputTokens?: number | null
}

export type WorkerRuntimeProviderModelConfig = {
  id: string
  name: string
  api?: string
  baseUrl?: string
  reasoning: boolean
  thinkingLevelMap?: Record<string, string | null>
  input: Array<'text' | 'image'>
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  contextWindow: number
  maxTokens: number
  headers?: Record<string, string>
  compat?: unknown
}

export type WorkerRuntimeProviderConfig = {
  baseUrl: string
  api: string
  apiKey?: string
  authHeader?: boolean
  headers?: Record<string, string>
  models: WorkerRuntimeProviderModelConfig[]
}

export type WorkerRuntimeModelConfig = {
  providerId: string
  modelId: string
  reasoningLevel?: string | null
  providerConfig: WorkerRuntimeProviderConfig
}

export type WorkerToolPolicy = {
  activeToolNames: string[]
  blockedToolNames: string[]
}

export type StartWorkerAttemptInput = {
  groupId: string
  taskId: string
  attemptId: string
  parentConversationId: string
  parentRunId: string
  parentMessageId?: string | null
  parentToolCallId: string
  correlationId: string
  attemptNumber: number
  createdAt: string
  timeoutMs: number
  cwd: string
  workspace: WorkerWorkspacePolicy
  promptPackage: WorkerPromptPackage
  permissionSnapshot: WorkerPermissionSnapshot
  modelPolicy: WorkerModelPolicy
  runtimeModel: WorkerRuntimeModelConfig
  toolPolicy: WorkerToolPolicy
}

export type CancelWorkerAttemptInput = {
  groupId: string
  taskId: string
  attemptId: string
  parentRunId: string
  correlationId: string
  reason: string
}

export type WorkerHostCommand =
  | {
      kind: 'start_attempt'
      sequence: number
      timestamp: string
      input: StartWorkerAttemptInput
    }
  | ({
      kind: 'cancel_attempt'
      sequence: number
      timestamp: string
    } & CancelWorkerAttemptInput)

export type WorkerHandle = {
  taskId: string
  attemptId: string
  processId: number | null
  startedAt: string
}

export type WorkerSessionHandle = {
  workerSessionId: string
  run(signal: AbortSignal, onEvent: (event: unknown) => void): Promise<WorkerResultEnvelope>
  dispose(): Promise<void>
}

export interface WorkerHostClient {
  startAttempt(input: StartWorkerAttemptInput): Promise<WorkerHandle>
  cancelAttempt(input: CancelWorkerAttemptInput): Promise<void>
  disposeAttempt(attemptId: string): Promise<void>
}

export type WorkerResultEnvelope = {
  status: 'completed' | 'failed' | 'blocked' | 'partial' | 'canceled' | 'timed_out'
  summary: string
  findings: Array<{
    title: string
    detail: string
    evidence: string[]
  }>
  artifacts: Array<{
    id: string
    kind: 'raw_result' | 'transcript' | 'diff' | 'file' | 'log' | 'screenshot' | 'report'
    title: string
  }>
  blockers: string[]
  confidence: 'low' | 'medium' | 'high'
  recommendedParentAction:
    | 'collect_results'
    | 'inspect_later'
    | 'retry'
    | 'cancel_or_retry'
    | 'ask_user'
    | 'none'
  error?: {
    code: string
    message: string
    retryable: boolean
  }
  usage?: {
    inputTokens: number
    outputTokens: number
    costUsd?: number
  }
  rawResultRef?: string
}

export type WorkerEventBase = {
  groupId: string
  taskId: string
  attemptId: string
  parentRunId: string
  correlationId: string
  sequence: number
  timestamp: string
}

export type WorkerReadyEvent = WorkerEventBase & {
  kind: 'worker_ready'
  processId: number | null
  workerSessionId: string
}

export type WorkerRuntimeEvent = WorkerEventBase & {
  kind: 'runtime_event'
  runtimeEventId: string
  runtimeRunId?: string | null
  runtimeTurnId?: string | null
  runtimeToolCallId?: string | null
  eventType: string
  payload: unknown
}

export type WorkerProgressEvent = WorkerEventBase & {
  kind: 'progress'
  summary: string
  currentToolName?: string | null
}

export type WorkerHeartbeatEvent = WorkerEventBase & {
  kind: 'heartbeat'
  leaseExpiresAt: string
}

export type WorkerSettledEvent = WorkerEventBase & {
  kind: 'settle_attempt'
  result: WorkerResultEnvelope
}

export type WorkerCancelAckEvent = WorkerEventBase & {
  kind: 'cancel_ack'
  reason: string
}

export type WorkerHostErrorEvent = WorkerEventBase & {
  kind: 'worker_error'
  error: {
    code:
      | 'worker_start_failed'
      | 'worker_ipc_error'
      | 'worker_runtime_error'
      | 'worker_result_parse_error'
      | 'worker_heartbeat_timeout'
      | 'worker_killed_after_cancel'
    message: string
    retryable: boolean
  }
}

export type WorkerHostEvent =
  | WorkerReadyEvent
  | WorkerRuntimeEvent
  | WorkerProgressEvent
  | WorkerHeartbeatEvent
  | WorkerSettledEvent
  | WorkerCancelAckEvent
  | WorkerHostErrorEvent

export type DelegateWorkerTaskInput = {
  label?: string | null
  instruction: string
  workspaceMode: WorkerWorkspacePolicy['mode']
  toolAllowlist: string[]
  timeoutMs?: number
}

export type DelegateWorkersInput = {
  parentConversationId: string
  parentRunId: string
  parentMessageId?: string | null
  parentToolCallId: string
  optionalRequestId?: string | null
  cwd: string
  runtimeModel: WorkerRuntimeModelConfig
  tasks: DelegateWorkerTaskInput[]
  waitStrategy?: SubagentWaitStrategy
}

export type DelegateWorkersResult = {
  groupId: string
  tasks: Array<{ taskId: string; label?: string | null; status: SubagentTaskStatus }>
}

export type WaitForGroupInput = {
  groupId: string
  timeoutMs: number
}

export type WaitForGroupResult = {
  waitStatus: 'settled' | 'timeout' | 'canceled' | 'failed'
  groupStatus: SubagentGroupStatus
  completedResults: WorkerResultEnvelope[]
}

export type CollectWorkerResultsInput = {
  groupId: string
}

export type CollectWorkerResultsResult = {
  groupId: string
  groupStatus: SubagentGroupStatus
  completedResults: WorkerResultEnvelope[]
}

export type RetryWorkerInput = {
  taskId: string
}

export type RetryWorkerResult = {
  taskId: string
  attemptId: string
  attemptNumber: number
  status: SubagentTaskStatus
}

export type CancelWorkerInput = {
  taskId: string
  reason: string
}

export type CancelWorkerResult = {
  taskId: string
  attemptId?: string | null
  status: SubagentTaskStatus
}

export type CancelWorkerGroupInput = {
  groupId: string
  reason: string
}

export type CancelWorkerGroupResult = {
  groupId: string
  groupStatus: SubagentGroupStatus
  tasks: CancelWorkerResult[]
}

export type IdFactory = (prefix: string) => string

export const defaultSubagentIdFactory: IdFactory = (prefix) => `${prefix}-${generateId(12)}`
