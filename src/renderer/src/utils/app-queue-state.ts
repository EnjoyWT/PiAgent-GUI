import type { QueueRuntimeState } from '../components/chat/types'

export const canAbortFromRuntimeState = (
  state: QueueRuntimeState,
  isStreaming: boolean
): boolean => {
  if (state === 'aborting') return false
  return state === 'running' || isStreaming
}

export const shouldQueueComposerSend = (
  runtimeState: QueueRuntimeState,
  _isStreaming: boolean
): boolean => {
  if (runtimeState === 'aborting') return false
  return runtimeState === 'running' || runtimeState === 'dispatching'
}

export const resetQueueControllerAfterAbort = (controller: {
  activeRunId: string | null
  runtimeState: QueueRuntimeState
  dispatchPolicy: 'auto' | 'paused'
  postRunAction: { type: string }
}): void => {
  controller.activeRunId = null
  controller.runtimeState = 'idle'
  controller.dispatchPolicy = 'auto'
  controller.postRunAction = { type: 'none' }
}
