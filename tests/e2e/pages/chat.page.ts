import { expect, type Locator, type Page } from '@playwright/test'

export type ScrollMetrics = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export class ChatPage {
  constructor(private readonly page: Page) {}

  readonly messageList = this.page.getByTestId('message-list')
  readonly messageItems = this.page.getByTestId('message-item')
  readonly loadOlderButton = this.page.getByTestId('load-older-history')
  readonly historyLoading = this.page.getByTestId('history-loading')
  readonly chatInput = this.page.getByTestId('chat-input')

  messageItemByText(text: string): Locator {
    return this.messageItems.filter({ hasText: text }).first()
  }

  async waitForMessageCount(count: number): Promise<void> {
    await expect(this.messageItems).toHaveCount(count)
  }

  async messageCount(): Promise<number> {
    return await this.messageItems.count()
  }

  async scrollHistoryToTop(): Promise<void> {
    await this.messageList.evaluate((node) => {
      const element = node as HTMLElement
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
  }

  async clickLoadOlder(): Promise<void> {
    await this.loadOlderButton.evaluate((node) => {
      ;(node as HTMLButtonElement).click()
    })
  }

  async scrollUp(offsetPx: number): Promise<void> {
    await this.messageList.evaluate(
      (node, offset) => {
        const element = node as HTMLElement
        element.scrollTop = Math.max(0, element.scrollTop - offset)
        element.dispatchEvent(new Event('scroll', { bubbles: true }))
      },
      Math.max(0, Math.trunc(offsetPx))
    )
  }

  async scrollToBottom(): Promise<void> {
    await this.messageList.evaluate((node) => {
      const element = node as HTMLElement
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
  }

  async getScrollMetrics(): Promise<ScrollMetrics> {
    return await this.messageList.evaluate((node) => {
      const element = node as HTMLElement
      return {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
      }
    })
  }
}
