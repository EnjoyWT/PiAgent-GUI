import { ipcMain } from 'electron'
import type { ReasoningLevel } from '../core-v2/domain.ts'
import { getLocalRuntimeHostService } from '../runtime-host/local-runtime-host.ts'

type RuntimeHandlersDependencies = {
  ipcMainLike?: Pick<typeof ipcMain, 'handle'>
  runtimeHostProvider?: typeof getLocalRuntimeHostService
  notifyRunFinished?: (payload: {
    threadId: string
    runId: string
    preview: string
  }) => Promise<boolean> | boolean
  setRunFinishedBadgeCount?: (count: number) => Promise<void> | void
}

export function setupRuntimeHandlers(deps: RuntimeHandlersDependencies = {}): void {
  const ipcMainLike = deps.ipcMainLike ?? ipcMain
  const runtimeHostProvider = deps.runtimeHostProvider ?? getLocalRuntimeHostService

  ipcMainLike.handle('runtime:prepare-thread', async (_, chatThreadId: string) =>
    (await runtimeHostProvider()).prepareThread(chatThreadId)
  )

  ipcMainLike.handle('runtime:abort-thread', async (_, chatThreadId: string) =>
    (await runtimeHostProvider()).abortThread(chatThreadId)
  )

  ipcMainLike.handle('runtime:dispose-thread', async (_, chatThreadId: string) =>
    (await runtimeHostProvider()).disposeThread(chatThreadId)
  )

  ipcMainLike.handle('runtime:set-active-thread', async (_, chatThreadId?: string | null) =>
    (await runtimeHostProvider()).setActiveThread(chatThreadId)
  )

  ipcMainLike.handle('runtime:reload', async (_, chatThreadId?: string | null) =>
    (await runtimeHostProvider()).reload(chatThreadId)
  )

  ipcMainLike.handle('runtime:compact-context', async (_, chatThreadId: string) =>
    (await runtimeHostProvider()).compactContext(chatThreadId)
  )

  ipcMainLike.handle('runtime:get-user-messages-for-forking', async (_, chatThreadId: string) =>
    (await runtimeHostProvider()).getUserMessagesForForking(chatThreadId)
  )

  ipcMainLike.handle('runtime:get-queued-messages', async (_, chatThreadId: string) =>
    (await runtimeHostProvider()).getQueuedMessages(chatThreadId)
  )

  ipcMainLike.handle('runtime:get-thread-projection', async (_, chatThreadId: string) =>
    (await runtimeHostProvider()).getThreadProjection(chatThreadId)
  )

  ipcMainLike.handle(
    'runtime:get-thread-window',
    async (
      _,
      chatThreadId: string,
      options?: {
        limit?: number
        beforeCursor?: import('../../shared/agent-runtime.ts').AgentThreadWindowCursor | null
        around?: import('../../shared/agent-runtime.ts').AgentThreadWindowAroundTarget | null
      }
    ) => (await runtimeHostProvider()).getThreadWindow(chatThreadId, options)
  )

  ipcMainLike.handle('runtime:get-thinking-config', async (_, chatThreadId: string) =>
    (await runtimeHostProvider()).getThinkingConfig(chatThreadId)
  )

  ipcMainLike.handle(
    'runtime:set-thinking-level',
    async (_, chatThreadId: string, level: ReasoningLevel) =>
      (await runtimeHostProvider()).setThinkingLevel(chatThreadId, level)
  )

  ipcMainLike.handle('runtime:list-events', async (_, chatThreadId: string, agentRunId?: string) =>
    (await runtimeHostProvider()).listRuntimeEvents(chatThreadId, agentRunId ?? null)
  )

  ipcMainLike.handle(
    'runtime:record-renderer-debug-event',
    async (
      _,
      chatThreadId: string,
      event: import('../../preload/db-types.ts').ConversationEventRow
    ) => (await runtimeHostProvider()).recordRendererDebugEvent(chatThreadId, event)
  )

  ipcMainLike.handle(
    'runtime:navigate-tree',
    async (
      _,
      chatThreadId: string,
      targetId: string,
      options?: {
        summarize?: boolean
        customInstructions?: string
        replaceInstructions?: boolean
        label?: string
      }
    ) => (await runtimeHostProvider()).navigateTree(chatThreadId, targetId, options)
  )

  ipcMainLike.handle(
    'runtime:notify-run-finished',
    async (
      _,
      payload: {
        threadId: string
        runId: string
        preview: string
      }
    ) => {
      const notificationShown = (await deps.notifyRunFinished?.(payload)) ?? false
      return { success: true, notificationShown }
    }
  )

  ipcMainLike.handle('runtime:set-run-finished-badge-count', async (_, count: number) => {
    const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
    await deps.setRunFinishedBadgeCount?.(normalizedCount)
    return { success: true }
  })
}
