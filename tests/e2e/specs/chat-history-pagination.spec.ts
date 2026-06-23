import { test, expect } from '../fixtures/electron'

test.describe('Chat History Pagination', () => {
  test('loads only the latest 50 visible messages on initial thread open', async ({
    appShell,
    sidebarPage,
    chatPage
  }) => {
    const seeded = await appShell.seedHistoryThread({
      threadTitle: 'History Window Smoke',
      visibleMessageCount: 120,
      hiddenEvery: 10
    })

    await appShell.reload()
    await sidebarPage.openThreadByTitle(seeded.threadTitle)
    await chatPage.waitForMessageCount(50)

    await expect(chatPage.messageItemByText('hidden-question-000')).toHaveCount(0)
  })

  test('returns the next history window through the production preload API', async ({
    appShell,
    page
  }) => {
    const seeded = await appShell.seedHistoryThread({
      threadTitle: 'History Window IPC',
      visibleMessageCount: 120,
      hiddenEvery: 10
    })

    const windows = await page.evaluate(async (threadId) => {
      const api = (window as Window & { api?: any }).api
      if (!api) throw new Error('window.api is not available in the renderer context')

      const first = await api.agent.getThreadWindow(threadId, { limit: 50 })
      const second = await api.agent.getThreadWindow(threadId, {
        limit: 50,
        beforeCursor: first.pageInfo.nextBeforeCursor
      })
      const third = await api.agent.getThreadWindow(threadId, {
        limit: 50,
        beforeCursor: second.pageInfo.nextBeforeCursor
      })

      return {
        firstIds: first.messages.map((message: { id?: string }) => message.id).filter(Boolean),
        secondIds: second.messages.map((message: { id?: string }) => message.id).filter(Boolean),
        thirdIds: third.messages.map((message: { id?: string }) => message.id).filter(Boolean),
        firstHasMore: first.pageInfo.hasMoreBefore,
        secondHasMore: second.pageInfo.hasMoreBefore,
        thirdHasMore: third.pageInfo.hasMoreBefore
      }
    }, seeded.threadId)

    expect(windows.firstIds).toHaveLength(50)
    expect(windows.secondIds).toHaveLength(50)
    expect(windows.thirdIds).toHaveLength(20)
    expect(new Set([...windows.firstIds, ...windows.secondIds, ...windows.thirdIds]).size).toBe(120)
    expect(windows.firstHasMore).toBe(true)
    expect(windows.secondHasMore).toBe(true)
    expect(windows.thirdHasMore).toBe(false)
  })
})
