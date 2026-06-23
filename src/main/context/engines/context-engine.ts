import type {
  ContextCompactionResult,
  ContextPressureEstimate,
  ModelSeedSnapshot
} from '../context-types.ts'

export interface ContextEngine {
  readonly name: string

  onThreadStart(input: { threadId: string; modelKey: string; contextWindow: number }): Promise<void>

  updateModel(input: { threadId: string; modelKey: string; contextWindow: number }): Promise<void>

  estimate(input: {
    threadId: string
    modelKey: string
    systemPrompt: string
    pendingUserText?: string
    toolSchemas?: unknown[]
  }): Promise<ContextPressureEstimate>

  shouldCompact(input: { estimate: ContextPressureEstimate }): boolean

  compact(input: {
    threadId: string
    modelKey: string
    reason: 'preflight' | 'after_run' | 'manual' | 'rebuild'
  }): Promise<ContextCompactionResult>

  buildActiveContext(input: { threadId: string; modelKey: string }): Promise<ModelSeedSnapshot>
}
