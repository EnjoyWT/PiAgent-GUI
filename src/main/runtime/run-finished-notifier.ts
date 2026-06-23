type MainWindowLike = {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  isFocused(): boolean
} | null

type NotificationInstanceLike = {
  show(): void
  on(event: 'click', listener: () => void): NotificationInstanceLike
}

type NotificationCtorLike = new (options: {
  title: string
  body: string
  silent?: boolean
}) => NotificationInstanceLike

export const RUN_FINISHED_NOTIFICATION_TITLE = 'PiAgent 运行已结束'

export const shouldNotifyForFinishedRun = (mainWindow: MainWindowLike): boolean => {
  if (!mainWindow || mainWindow.isDestroyed()) return true
  if (mainWindow.isMinimized()) return true
  if (!mainWindow.isVisible()) return true
  return !mainWindow.isFocused()
}

export const notifyRunFinishedIfNeeded = (input: {
  mainWindow: MainWindowLike
  threadId: string
  preview: string
  NotificationCtor: NotificationCtorLike
  notificationsSupported?: boolean
  showMainWindow: () => void
  openThread: (threadId: string) => void
}): boolean => {
  const preview = String(input.preview ?? '').trim()
  const threadId = String(input.threadId ?? '').trim()

  if (!preview || !threadId) return false
  if (input.notificationsSupported === false) return false
  if (!shouldNotifyForFinishedRun(input.mainWindow)) return false

  const notification = new input.NotificationCtor({
    title: RUN_FINISHED_NOTIFICATION_TITLE,
    body: preview,
    silent: false
  })
  notification.on('click', () => {
    input.showMainWindow()
    input.openThread(threadId)
  })
  notification.show()
  return true
}
