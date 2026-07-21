import { nanoid } from 'nanoid'
import { ContextStore } from '../context-store.ts'
import type {
  ContextCompactionResult,
  ContextEngineConfig,
  ContextEntry,
  ContextPressureEstimate,
  ModelSeedSnapshot,
  SummaryCompressorState
} from '../context-types.ts'
import type { ContextEngine } from './context-engine.ts'
import { SummaryPromptBuilder, createEmptySummarySections } from '../summary-prompt-builder.ts'
import type {
  ContextSummaryModelClient,
  ContextSummaryModelResult
} from '../context-model-client.ts'

const FAILURE_COOLDOWN_MS = 5 * 60 * 1000

const zeroEstimate: ContextPressureEstimate = {
  contextWindow: 0,
  estimatedPromptTokens: 0,
  thresholdTokens: 0,
  estimateMode: 'heuristic_only',
  warningLevel: 'normal'
}

const parseState = (raw: string | null | undefined): SummaryCompressorState => {
  const text = String(raw ?? '').trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as SummaryCompressorState) : {}
  } catch {
    return {}
  }
}

const isCooldownActive = (state: SummaryCompressorState): boolean => {
  const raw = String(state.cooldownUntil ?? '').trim()
  if (!raw) return false
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

const normalizeModelKeyChain = (items: Array<string | null | undefined>): string[] =>
  Array.from(new Set(items.map((item) => String(item ?? '').trim()).filter(Boolean)))

type SummaryCompressorEngineOptions = {
  store: ContextStore
  config: ContextEngineConfig
  promptBuilder: SummaryPromptBuilder
  modelClient: ContextSummaryModelClient
}

export type SummaryCompactionPlan = {
  existingSummary: ContextEntry | null
  nonSummaryActiveEntries: ContextEntry[]
  protectedHeadEntries: ContextEntry[]
  protectedTailEntries: ContextEntry[]
  summarizableEntries: ContextEntry[]
  additionalProtectedHeadEntries: ContextEntry[]
}

export const planSummaryCompaction = (input: {
  allEntries: ContextEntry[]
  activeEntries: ContextEntry[]
  activeSummaryEntryId?: string | null
  protectFirstEntries: number
  protectLastEntries: number
}): SummaryCompactionPlan => {
  const protectFirstEntries = Math.max(0, Math.trunc(input.protectFirstEntries || 0))
  const protectLastEntries = Math.max(0, Math.trunc(input.protectLastEntries || 0))
  const existingSummary =
    input.activeSummaryEntryId == null
      ? null
      : (input.activeEntries.find((entry) => entry.id === input.activeSummaryEntryId) ?? null)

  const headCandidates = input.allEntries.filter(
    (entry) => entry.includeInModelContext && entry.semanticKind !== 'thread_summary'
  )
  const alreadyProtectedHeadEntries = headCandidates.filter(
    (entry) => entry.compactPolicy === 'keep'
  )
  const additionalProtectedHeadEntries =
    alreadyProtectedHeadEntries.length >= protectFirstEntries
      ? []
      : headCandidates
          .filter((entry) => entry.compactPolicy !== 'keep')
          .slice(0, protectFirstEntries - alreadyProtectedHeadEntries.length)

  const protectedHeadIds = new Set(
    [...alreadyProtectedHeadEntries, ...additionalProtectedHeadEntries]
      .slice(0, protectFirstEntries)
      .map((entry) => entry.id)
  )
  const protectedHeadEntries =
    protectFirstEntries === 0
      ? []
      : headCandidates
          .filter((entry) => protectedHeadIds.has(entry.id))
          .slice(0, protectFirstEntries)

  const nonSummaryActiveEntries = input.activeEntries.filter(
    (entry) => entry.id !== existingSummary?.id
  )
  const summarizablePool = nonSummaryActiveEntries.filter(
    (entry) => !protectedHeadIds.has(entry.id)
  )
  const protectedTailEntries = summarizablePool.slice(
    Math.max(0, summarizablePool.length - protectLastEntries)
  )
  const protectedTailIds = new Set(protectedTailEntries.map((entry) => entry.id))
  const summarizableEntries = summarizablePool.filter((entry) => !protectedTailIds.has(entry.id))

  return {
    existingSummary,
    nonSummaryActiveEntries,
    protectedHeadEntries,
    protectedTailEntries,
    summarizableEntries,
    additionalProtectedHeadEntries
  }
}

export class SummaryCompressorEngine implements ContextEngine {
  readonly name = 'summary-compressor'

  private readonly store: ContextStore
  private readonly config: ContextEngineConfig
  private readonly promptBuilder: SummaryPromptBuilder
  private readonly modelClient: ContextSummaryModelClient

  constructor(options: SummaryCompressorEngineOptions) {
    this.store = options.store
    this.config = options.config
    this.promptBuilder = options.promptBuilder
    this.modelClient = options.modelClient
  }

  async onThreadStart(): Promise<void> {}

  async updateModel(): Promise<void> {}

  async estimate(): Promise<ContextPressureEstimate> {
    return { ...zeroEstimate }
  }

  shouldCompact(input: { estimate: ContextPressureEstimate }): boolean {
    return (
      input.estimate.thresholdTokens > 0 &&
      input.estimate.estimatedPromptTokens >= input.estimate.thresholdTokens
    )
  }

  async buildActiveContext(): Promise<ModelSeedSnapshot> {
    return {
      messages: [],
      revision: 0
    }
  }

  async compact(input: {
    threadId: string
    modelKey: string
    reason: 'preflight' | 'after_run' | 'manual' | 'rebuild'
  }): Promise<ContextCompactionResult> {
    const head =
      this.store.getThreadHead(input.threadId) ??
      this.store.ensureThreadHead(input.threadId, this.name)
    const stateRow = this.store.getEngineState(input.threadId, this.name)
    const state = parseState(stateRow?.stateJson)
    if (input.reason !== 'manual' && isCooldownActive(state)) {
      return {
        changed: false,
        reason: input.reason,
        revision: head.revision
      }
    }
    const activeEntries = this.store.listActiveEntries(input.threadId)
    const compactionPlan = planSummaryCompaction({
      allEntries: this.store.listEntries(input.threadId),
      activeEntries,
      activeSummaryEntryId: head.activeSummaryEntryId ?? null,
      protectFirstEntries: this.config.limits.protectFirstEntries,
      protectLastEntries: this.config.limits.protectLastEntries
    })
    if (compactionPlan.additionalProtectedHeadEntries.length > 0) {
      this.store.updateCompactPolicy(
        compactionPlan.additionalProtectedHeadEntries.map((entry) => entry.id),
        'keep'
      )
    }

    const { existingSummary, protectedTailEntries, summarizableEntries } = compactionPlan

    if (summarizableEntries.length === 0) {
      return {
        changed: false,
        reason: input.reason,
        revision: head.revision
      }
    }

    try {
      const completion = await this.generateSummary(
        input.modelKey,
        existingSummary,
        state,
        summarizableEntries
      )
      const sections = completion.text
        ? this.promptBuilder.parseSections(completion.text)
        : createEmptySummarySections()
      const summaryBody = this.promptBuilder.renderSections(sections)
      const now = new Date()
      const compactionId = nanoid(16)
      const summaryEntry = this.store.appendEntry({
        threadId: input.threadId,
        sourceKind: 'summary',
        sourceRef: `compaction:${compactionId}:summary`,
        groupId: compactionId,
        role: 'system',
        semanticKind: 'thread_summary',
        includeInModelContext: true,
        includeInMemory: false,
        compactPolicy: 'keep',
        contentText: summaryBody,
        contentJson: JSON.stringify(sections),
        tokenEstimate: null,
        createdAt: now
      })

      const compactedUntilSeq = summarizableEntries.at(-1)?.seq ?? head.compactedUntilSeq ?? 0
      const nextHead = this.store.upsertThreadHead({
        threadId: input.threadId,
        engineName: this.name,
        activeSummaryEntryId: summaryEntry.id,
        compactedUntilSeq
      })

      this.store.addCompaction({
        id: compactionId,
        threadId: input.threadId,
        engineName: this.name,
        reason: input.reason,
        baseSummaryEntryId: existingSummary?.id ?? null,
        newSummaryEntryId: summaryEntry.id,
        fromSeqExclusive: head.compactedUntilSeq ?? 0,
        compactedUntilSeq,
        protectedTailStartSeq: protectedTailEntries.at(0)?.seq ?? null,
        estimatedInputTokens: null,
        estimatedOutputTokens: null,
        createdAt: now.toISOString()
      })

      this.store.setEngineState(
        input.threadId,
        this.name,
        JSON.stringify({
          previousSummary: summaryBody,
          failureCount: 0,
          lastFailureAt: null,
          cooldownUntil: null,
          lastModelKey: completion.modelKey
        })
      )

      return {
        changed: true,
        reason: input.reason,
        summaryEntryId: summaryEntry.id,
        revision: nextHead.revision
      }
    } catch (error) {
      const now = new Date()
      const failureCount = Math.max(0, Number(state.failureCount ?? 0)) + 1
      this.store.setEngineState(
        input.threadId,
        this.name,
        JSON.stringify({
          ...state,
          failureCount,
          lastFailureAt: now.toISOString(),
          cooldownUntil: new Date(now.getTime() + FAILURE_COOLDOWN_MS).toISOString()
        })
      )
      throw error
    }
  }

  private async generateSummary(
    modelKey: string,
    existingSummary: ContextEntry | null,
    state: SummaryCompressorState,
    summarizableEntries: ContextEntry[]
  ): Promise<ContextSummaryModelResult> {
    const previousSummary = String(
      state.previousSummary ?? existingSummary?.contentText ?? ''
    ).trim()
    const mode = previousSummary ? 'iterative' : 'initial'
    const prompt = this.promptBuilder.build({
      mode,
      previousSummary,
      entries: summarizableEntries
    })

    const modelKeys = normalizeModelKeyChain([
      this.config.summaryModel,
      this.config.summaryFallbackModel,
      modelKey
    ])

    if (modelKeys.length === 0) {
      throw new Error(
        'No summary model available; configure a summary model or initialize the agent session first'
      )
    }

    const result = await this.modelClient.summarize({
      modelKeys,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      maxTokens: Math.max(512, Math.min(this.config.limits.summaryBudgetCap, 4096)),
      timeoutMs: this.config.summaryTimeoutMs
    })

    if (!result?.text?.trim()) {
      const attempted = modelKeys.length > 0 ? modelKeys.join(', ') : '(none)'
      throw new Error(
        `Summary model did not return summary text. Attempted models: [${attempted}]. ` +
          'Check that the summary model is properly configured with a valid API key and is reachable.'
      )
    }

    return result
  }
}
