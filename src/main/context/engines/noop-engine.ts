import type { ContextEngine } from './context-engine.ts'
import type {
  ContextCompactionResult,
  ContextPressureEstimate,
  ModelSeedSnapshot
} from '../context-types.ts'

const zeroEstimate: ContextPressureEstimate = {
  contextWindow: 0,
  estimatedPromptTokens: 0,
  thresholdTokens: 0,
  estimateMode: 'heuristic_only',
  warningLevel: 'normal'
}

export class NoopContextEngine implements ContextEngine {
  readonly name = 'noop'

  async onThreadStart(): Promise<void> {}

  async updateModel(): Promise<void> {}

  async estimate(): Promise<ContextPressureEstimate> {
    return { ...zeroEstimate }
  }

  shouldCompact(): boolean {
    return false
  }

  async compact(): Promise<ContextCompactionResult> {
    return {
      changed: false,
      reason: 'manual',
      revision: 0
    }
  }

  async buildActiveContext(): Promise<ModelSeedSnapshot> {
    return {
      messages: [],
      revision: 0
    }
  }
}
