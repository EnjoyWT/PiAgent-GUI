import { runOneShotText } from '../llm/one-shot.ts'

export type ContextSummaryModelInput = {
  modelKeys: string[]
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  timeoutMs: number
}

export type ContextSummaryModelResult = {
  modelKey: string
  text: string
}

export interface ContextSummaryModelClient {
  summarize(input: ContextSummaryModelInput): Promise<ContextSummaryModelResult | null>
}

export class ContextModelClient implements ContextSummaryModelClient {
  async summarize(input: ContextSummaryModelInput): Promise<ContextSummaryModelResult | null> {
    return await runOneShotText({
      modelKeys: input.modelKeys,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      maxTokens: input.maxTokens,
      timeoutMs: input.timeoutMs,
      temperature: 0
    })
  }
}
