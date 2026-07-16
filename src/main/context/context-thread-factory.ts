import type { Message } from '@earendil-works/pi-ai/compat'

type ThreadWithSessionManager = {
  agent: {
    state: {
      messages: Message[]
    }
  }
  sessionManager: {
    resetLeaf?: () => void
    appendMessage: (message: Message) => string
  }
}

export class ContextThreadFactory {
  applySeedMessages(thread: ThreadWithSessionManager, seedMessages: Message[]): void {
    thread.sessionManager.resetLeaf?.()
    thread.agent.state.messages = seedMessages
    for (const message of seedMessages) thread.sessionManager.appendMessage(message)
  }

  async recreate<T>(input: {
    current: T
    createNext: () => Promise<T>
    activateNext: (next: T) => Promise<void> | void
    disposeThread: (thread: T) => Promise<void> | void
  }): Promise<T> {
    const next = await input.createNext()
    try {
      await input.activateNext(next)
    } catch (error) {
      await input.disposeThread(next)
      throw error
    }

    try {
      await input.disposeThread(input.current)
    } catch {
      // Best-effort cleanup of the old thread instance.
    }

    return next
  }
}
