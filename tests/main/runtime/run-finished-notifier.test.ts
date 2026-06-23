import test from 'node:test'
import assert from 'node:assert/strict'
import {
  notifyRunFinishedIfNeeded,
  shouldNotifyForFinishedRun
} from '../../../src/main/runtime/run-finished-notifier.ts'

class FakeNotification {
  static instances: FakeNotification[] = []

  title: string
  body: string
  shown = false
  private readonly listeners = new Map<string, () => void>()

  constructor({ title, body }: { title: string; body: string }) {
    this.title = title
    this.body = body
    FakeNotification.instances.push(this)
  }

  show(): void {
    this.shown = true
  }

  on(event: string, listener: () => void): this {
    this.listeners.set(event, listener)
    return this
  }

  emit(event: string): void {
    this.listeners.get(event)?.()
  }

  static reset(): void {
    FakeNotification.instances = []
  }
}

const createMainWindow = (overrides?: Partial<{
  destroyed: boolean
  visible: boolean
  minimized: boolean
  focused: boolean
}>) => ({
  isDestroyed: () => overrides?.destroyed ?? false,
  isVisible: () => overrides?.visible ?? true,
  isMinimized: () => overrides?.minimized ?? false,
  isFocused: () => overrides?.focused ?? false
})

test('shouldNotifyForFinishedRun only fires when main window is not foregrounded', () => {
  assert.equal(shouldNotifyForFinishedRun(null), true)
  assert.equal(shouldNotifyForFinishedRun(createMainWindow({ focused: true })), false)
  assert.equal(shouldNotifyForFinishedRun(createMainWindow({ visible: false })), true)
  assert.equal(shouldNotifyForFinishedRun(createMainWindow({ minimized: true })), true)
})

test('notifyRunFinishedIfNeeded shows a notification and reopens the thread on click', () => {
  FakeNotification.reset()
  const openedThreads: string[] = []
  let mainWindowShown = 0

  const didNotify = notifyRunFinishedIfNeeded({
    mainWindow: createMainWindow({ focused: false }),
    threadId: 'thread-123',
    preview: '任务已经执行完成',
    NotificationCtor: FakeNotification as never,
    showMainWindow: () => {
      mainWindowShown += 1
    },
    openThread: (threadId) => openedThreads.push(threadId)
  })

  assert.equal(didNotify, true)
  assert.equal(FakeNotification.instances.length, 1)
  assert.equal(FakeNotification.instances[0]?.title, 'PiAgent 运行已结束')
  assert.equal(FakeNotification.instances[0]?.body, '任务已经执行完成')
  assert.equal(FakeNotification.instances[0]?.shown, true)

  FakeNotification.instances[0]?.emit('click')

  assert.equal(mainWindowShown, 1)
  assert.deepEqual(openedThreads, ['thread-123'])
})

test('notifyRunFinishedIfNeeded skips notification when preview is empty or main window is focused', () => {
  FakeNotification.reset()

  const didNotifyFocused = notifyRunFinishedIfNeeded({
    mainWindow: createMainWindow({ focused: true }),
    threadId: 'thread-123',
    preview: 'done',
    NotificationCtor: FakeNotification as never,
    showMainWindow: () => undefined,
    openThread: () => undefined
  })
  const didNotifyEmpty = notifyRunFinishedIfNeeded({
    mainWindow: createMainWindow({ focused: false }),
    threadId: 'thread-123',
    preview: '   ',
    NotificationCtor: FakeNotification as never,
    showMainWindow: () => undefined,
    openThread: () => undefined
  })

  assert.equal(didNotifyFocused, false)
  assert.equal(didNotifyEmpty, false)
  assert.equal(FakeNotification.instances.length, 0)
})
