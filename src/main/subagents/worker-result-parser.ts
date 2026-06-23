import type { WorkerResultEnvelope } from './subagent-types.ts'

type ResultStatus = WorkerResultEnvelope['status']
type Confidence = WorkerResultEnvelope['confidence']
type ParentAction = WorkerResultEnvelope['recommendedParentAction']

const RESULT_STATUSES = new Set<ResultStatus>([
  'completed',
  'failed',
  'blocked',
  'partial',
  'canceled',
  'timed_out'
])

const CONFIDENCE_VALUES = new Set<Confidence>(['low', 'medium', 'high'])

const PARENT_ACTIONS = new Set<ParentAction>([
  'collect_results',
  'inspect_later',
  'retry',
  'cancel_or_retry',
  'ask_user',
  'none'
])

export const parseWorkerResultFromSessionState = (state: unknown): WorkerResultEnvelope => {
  const text = findLastAssistantText(state)?.trim()

  if (!text) {
    return normalizeWorkerResult({})
  }

  const parsed = parseJsonObject(text)
  if (!parsed) {
    return normalizeWorkerResult({ summary: text })
  }

  return normalizeWorkerResult(parsed)
}

const parseJsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      return null
    }

    try {
      const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1))
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
}

const normalizeWorkerResult = (raw: Record<string, unknown>): WorkerResultEnvelope => {
  const status = isResultStatus(raw.status) ? raw.status : 'completed'
  const summary =
    typeof raw.summary === 'string' && raw.summary.trim().length > 0
      ? raw.summary
      : status === 'completed'
        ? '(no output)'
        : status

  return {
    status,
    summary,
    findings: Array.isArray(raw.findings) ? normalizeFindings(raw.findings) : [],
    artifacts: Array.isArray(raw.artifacts) ? normalizeArtifacts(raw.artifacts) : [],
    blockers: Array.isArray(raw.blockers) ? raw.blockers.filter((item): item is string => typeof item === 'string') : [],
    confidence: isConfidence(raw.confidence) ? raw.confidence : 'medium',
    recommendedParentAction: isParentAction(raw.recommendedParentAction)
      ? raw.recommendedParentAction
      : status === 'completed'
        ? 'collect_results'
        : 'none',
    error: normalizeError(raw.error),
    usage: normalizeUsage(raw.usage),
    rawResultRef: typeof raw.rawResultRef === 'string' ? raw.rawResultRef : undefined
  }
}

const normalizeFindings = (findings: unknown[]): WorkerResultEnvelope['findings'] =>
  findings.filter(isRecord).map((finding) => ({
    title: typeof finding.title === 'string' ? finding.title : '',
    detail: typeof finding.detail === 'string' ? finding.detail : '',
    evidence: Array.isArray(finding.evidence)
      ? finding.evidence.filter((item): item is string => typeof item === 'string')
      : []
  }))

const normalizeArtifacts = (artifacts: unknown[]): WorkerResultEnvelope['artifacts'] =>
  artifacts.filter(isRecord).map((artifact) => ({
    id: typeof artifact.id === 'string' ? artifact.id : '',
    kind: isArtifactKind(artifact.kind) ? artifact.kind : 'raw_result',
    title: typeof artifact.title === 'string' ? artifact.title : ''
  }))

const normalizeError = (error: unknown): WorkerResultEnvelope['error'] | undefined => {
  if (!isRecord(error)) {
    return undefined
  }

  return {
    code: typeof error.code === 'string' ? error.code : 'worker_error',
    message: typeof error.message === 'string' ? error.message : 'Worker failed',
    retryable: typeof error.retryable === 'boolean' ? error.retryable : false
  }
}

const normalizeUsage = (usage: unknown): WorkerResultEnvelope['usage'] | undefined => {
  if (!isRecord(usage) || typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number') {
    return undefined
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: typeof usage.costUsd === 'number' ? usage.costUsd : undefined
  }
}

const findLastAssistantText = (state: unknown): string | null => {
  if (!isRecord(state) || !Array.isArray(state.messages)) {
    return null
  }

  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index]
    if (!isRecord(message) || message.role !== 'assistant') {
      continue
    }

    const text = extractText(message.content)
    if (text.length > 0) {
      return text
    }
  }

  return null
}

const extractText = (content: unknown): string => {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }
      if (isRecord(part) && typeof part.text === 'string') {
        return part.text
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isResultStatus = (value: unknown): value is ResultStatus =>
  typeof value === 'string' && RESULT_STATUSES.has(value as ResultStatus)

const isConfidence = (value: unknown): value is Confidence =>
  typeof value === 'string' && CONFIDENCE_VALUES.has(value as Confidence)

const isParentAction = (value: unknown): value is ParentAction =>
  typeof value === 'string' && PARENT_ACTIONS.has(value as ParentAction)

const isArtifactKind = (value: unknown): value is WorkerResultEnvelope['artifacts'][number]['kind'] =>
  value === 'raw_result' ||
  value === 'transcript' ||
  value === 'diff' ||
  value === 'file' ||
  value === 'log' ||
  value === 'screenshot' ||
  value === 'report'
