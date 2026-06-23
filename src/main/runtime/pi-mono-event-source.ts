type RuntimeThreadLike = {
  subscribe: (callback: (event: unknown) => void) => () => void
}

export class PiMonoEventSource {
  private unsubscribe: (() => void) | null = null

  constructor(private readonly runtimeThread: RuntimeThreadLike) {}

  subscribe(callback: (event: unknown) => void): () => void {
    this.unsubscribe?.()
    const unsubscribe = this.runtimeThread.subscribe(callback)
    this.unsubscribe = () => {
      try {
        unsubscribe()
      } catch {
        // ignore unsubscribe failures from runtime shutdown races
      }
      this.unsubscribe = null
    }
    return this.unsubscribe
  }

  dispose(): void {
    this.unsubscribe?.()
  }
}
