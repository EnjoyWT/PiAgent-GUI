import type { Locator, Page } from '@playwright/test'

export class SidebarPage {
  constructor(private readonly page: Page) {}

  readonly sidebar = this.page.getByTestId('app-sidebar')

  threadItemByTitle(title: string): Locator {
    return this.sidebar.getByTestId('thread-item').filter({ hasText: title }).first()
  }

  async openThreadByTitle(title: string): Promise<void> {
    const item = this.threadItemByTitle(title)
    await item.scrollIntoViewIfNeeded()
    await item.click()
  }
}
