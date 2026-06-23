import type { Page } from '@playwright/test'

export async function simulateAgentStream(
  page: Page,
  input: {
    chatThreadId: string
    text: string
    chunkSize?: number
    delayMs?: number
  }
): Promise<{ success: true; runId: string; agentMessageId: string }> {
  return await page.evaluate(async (value) => {
    const api = (window as Window & { api?: any }).api
    if (!api?.e2e?.enabled) throw new Error('window.api.e2e is not enabled for this test run')
    return await api.e2e.agent.simulateStream(value.chatThreadId, {
      text: value.text,
      chunkSize: value.chunkSize,
      delayMs: value.delayMs
    })
  }, input)
}
