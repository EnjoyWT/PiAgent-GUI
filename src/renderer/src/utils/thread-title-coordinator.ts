export type ThreadTitleRunStatus = 'finished' | 'failed' | 'aborted'

type PendingTitle = {
  fallbackTitle: string
  text: string
  imageCount: number
}

export type ThreadTitleCoordinatorDeps = {
  buildFallbackTitle: (input: { text: string; imageCount: number }) => string
  generateTitle: (input: { text: string; imageCount: number }) => Promise<string>
  persistTitle: (threadId: string, title: string) => Promise<void>
  getCurrentTitle: (threadId: string) => string | null
  isThreadIdle: (threadId: string) => boolean
}

export const buildFallbackThreadTitle = (input: { text: string; imageCount?: number }): string => {
  const text = String(input.text ?? '').trim()
  if (!text) return Number(input.imageCount ?? 0) > 0 ? '图片消息' : '新对话'
  return text.slice(0, 20) + (text.length > 20 ? '...' : '')
}

export const createThreadTitleCoordinator = (deps: ThreadTitleCoordinatorDeps) => {
  const pendingByThreadId = new Map<string, PendingTitle>()

  const reserve = (input: {
    threadId: string
    currentTitle: string | null | undefined
    text: string
    imageCount?: number
  }): string | null => {
    if (input.currentTitle && input.currentTitle !== 'newchat') return null

    const imageCount = Math.max(0, Math.trunc(Number(input.imageCount ?? 0) || 0))
    const fallbackTitle = deps.buildFallbackTitle({ text: input.text, imageCount })
    pendingByThreadId.set(input.threadId, {
      fallbackTitle,
      text: input.text,
      imageCount
    })
    return fallbackTitle
  }

  const refineAfterRun = async (input: {
    threadId: string
    status: ThreadTitleRunStatus
  }): Promise<void> => {
    const pending = pendingByThreadId.get(input.threadId)
    if (!pending) return
    if (input.status !== 'finished') {
      pendingByThreadId.delete(input.threadId)
      return
    }
    if (!deps.isThreadIdle(input.threadId)) return
    if (deps.getCurrentTitle(input.threadId) !== pending.fallbackTitle) {
      pendingByThreadId.delete(input.threadId)
      return
    }

    try {
      const title = String(
        await deps.generateTitle({ text: pending.text, imageCount: pending.imageCount })
      ).trim()
      if (!title || deps.getCurrentTitle(input.threadId) !== pending.fallbackTitle) return
      await deps.persistTitle(input.threadId, title)
    } catch (error) {
      console.error('Refine thread title failed', error)
    } finally {
      pendingByThreadId.delete(input.threadId)
    }
  }

  return {
    reserve,
    refineAfterRun
  }
}
