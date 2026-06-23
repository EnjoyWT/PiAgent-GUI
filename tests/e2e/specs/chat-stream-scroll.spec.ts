import { test, expect } from '../fixtures/electron'
import { simulateAgentStream } from '../support/agent-runtime'

const distanceToBottom = (metrics: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): number => metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight

test.describe('Chat Stream Scroll Behavior', () => {
  test('keeps the viewport pinned to the bottom while streaming if the user is already at the bottom', async ({
    appShell,
    sidebarPage,
    chatPage,
    page
  }) => {
    const seeded = await appShell.seedHistoryThread({
      threadTitle: 'Pinned Stream Follow',
      visibleMessageCount: 120,
      hiddenEvery: 10
    })

    await appShell.reload()
    await sidebarPage.openThreadByTitle(seeded.threadTitle)
    await chatPage.waitForMessageCount(50)

    const before = await chatPage.getScrollMetrics()
    expect(distanceToBottom(before)).toBeLessThanOrEqual(72)

    await simulateAgentStream(page, {
      chatThreadId: seeded.threadId,
      text: 'pinned stream follow final chunk',
      chunkSize: 6,
      delayMs: 5
    })

    await expect.poll(async () => await chatPage.messageCount()).toBe(51)
    await expect(chatPage.messageItemByText('pinned stream follow final chunk')).toHaveCount(1)

    const after = await chatPage.getScrollMetrics()
    expect(after.scrollHeight).toBeGreaterThan(before.scrollHeight)
    expect(distanceToBottom(after)).toBeLessThanOrEqual(72)
  })

  test('does not force-scroll to the bottom while streaming if the user has scrolled up', async ({
    appShell,
    sidebarPage,
    chatPage,
    page
  }) => {
    const seeded = await appShell.seedHistoryThread({
      threadTitle: 'Unpinned Stream Hold',
      visibleMessageCount: 120,
      hiddenEvery: 10
    })

    await appShell.reload()
    await sidebarPage.openThreadByTitle(seeded.threadTitle)
    await chatPage.waitForMessageCount(50)

    await chatPage.scrollUp(360)
    const before = await chatPage.getScrollMetrics()
    expect(distanceToBottom(before)).toBeGreaterThan(72)

    await simulateAgentStream(page, {
      chatThreadId: seeded.threadId,
      text: 'unpinned stream hold final chunk',
      chunkSize: 6,
      delayMs: 5
    })

    await expect.poll(async () => await chatPage.messageCount()).toBe(51)
    await expect(chatPage.messageItemByText('unpinned stream hold final chunk')).toHaveCount(1)

    const after = await chatPage.getScrollMetrics()
    expect(after.scrollHeight).toBeGreaterThan(before.scrollHeight)
    expect(distanceToBottom(after)).toBeGreaterThan(72)
    expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(12)
  })
})
