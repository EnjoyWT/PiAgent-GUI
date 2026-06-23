import type { Page } from '@playwright/test'

export type SeedHistoryThreadOptions = {
  workspacePath: string
  workspaceName?: string
  threadTitle: string
  visibleMessageCount: number
  hiddenEvery?: number
  model?: string
}

export type SeededHistoryThread = {
  workspacePath: string
  threadId: string
  threadTitle: string
  visibleMessageCount: number
  hiddenMessageCount: number
}

export async function seedHistoryThread(
  page: Page,
  options: SeedHistoryThreadOptions
): Promise<SeededHistoryThread> {
  return await page.evaluate(async (input) => {
    const api = (window as Window & { api?: any }).api
    if (!api) throw new Error('window.api is not available in the renderer context')

    const hiddenEvery = Number.isFinite(input.hiddenEvery) ? Math.max(0, input.hiddenEvery ?? 0) : 0
    const model = String(input.model ?? 'google::gemini-2.5-flash')

    await api.db.workspaces.upsert(input.workspacePath, input.workspaceName ?? undefined)
    const thread = await api.db.threads.create(input.workspacePath, model)
    await api.db.threads.update(thread.id, { title: input.threadTitle })

    let hiddenMessageCount = 0

    for (let index = 0; index < input.visibleMessageCount; index += 1) {
      const role = index % 2 === 0 ? 'user' : 'assistant'
      const visibleLabel = `visible-${String(index).padStart(3, '0')}`
      await api.db.messages.add(
        thread.id,
        role,
        visibleLabel,
        null,
        null,
        role === 'user' ? { messageKind: 'chat' } : undefined
      )

      if (hiddenEvery > 0 && index % hiddenEvery === 0) {
        hiddenMessageCount += 1
        await api.db.messages.add(
          thread.id,
          'user',
          `hidden-question-${String(index).padStart(3, '0')}`,
          null,
          null,
          {
            messageKind: 'question_answer',
            includeInAgentContext: false,
            toolCallId: `hidden-tool-${String(index).padStart(3, '0')}`
          }
        )
      }
    }

    return {
      workspacePath: input.workspacePath,
      threadId: thread.id,
      threadTitle: input.threadTitle,
      visibleMessageCount: input.visibleMessageCount,
      hiddenMessageCount
    }
  }, options)
}
