import type { WorkerRuntimeModelConfig } from '../../../src/main/subagents/subagent-types.ts'

export const testWorkerRuntimeModel: WorkerRuntimeModelConfig = {
  providerId: 'openai',
  modelId: 'gpt-5.4',
  reasoningLevel: 'medium',
  providerConfig: {
    baseUrl: 'https://runtime.example.test/v1',
    apiKey: 'runtime-secret-key',
    api: 'openai-responses',
    models: [
      {
        id: 'gpt-5.4',
        name: 'GPT 5.4',
        api: 'openai-responses',
        baseUrl: 'https://runtime.example.test/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16000
      }
    ]
  }
}
