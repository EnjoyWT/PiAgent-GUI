export type ComputerUseAction =
  | 'doctor'
  | 'request_permissions'
  | 'list_apps'
  | 'list_windows'
  | 'get_app_state'
  | 'screenshot'
  | 'snapshot_window'
  | 'capture_window'
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'drag'
  | 'scroll'
  | 'set_value'
  | 'type_text'
  | 'press_key'
  | 'intent'
  | 'open_url'
  | 'raise_window'
  | 'wait'

export type ComputerUsePermissionState =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'

export type ComputerUseDoctorResult = {
  platform: NodeJS.Platform
  available: boolean
  stage: 'typescript-shell' | 'native-helper'
  helper: {
    available: boolean
    path: string | null
  }
  permissions: {
    accessibility: ComputerUsePermissionState
    screenRecording: ComputerUsePermissionState
  }
  capabilities: {
    observe: boolean
    foregroundInput: boolean
    backgroundClick: boolean
    backgroundKeyboard?: boolean
    backgroundDrag?: boolean
    backgroundScroll?: boolean
    windowLocalBackgroundClick?: boolean
    privateSymbols?: {
      cgEventPostToPid: boolean
      cgEventSetWindowLocation: boolean
    }
  }
  warnings: string[]
}

export type ComputerUseResult = {
  ok: boolean
  action: ComputerUseAction
  observation?: Record<string, unknown>
  actionResult?: Record<string, unknown>
  warnings?: string[]
}

export type ComputerUseRequest = {
  action: ComputerUseAction
  app?: string
  bundle?: string
  pid?: number
  windowId?: number
  elementId?: string
  ref?: string
  url?: string
  x?: number
  y?: number
  toX?: number
  toY?: number
  endX?: number
  endY?: number
  deltaX?: number
  deltaY?: number
  displayId?: number
  maxDepth?: number
  maxChildren?: number
  button?: 'left' | 'right' | 'middle'
  text?: string
  value?: unknown
  key?: string
  modifiers?: Array<'cmd' | 'shift' | 'option' | 'ctrl'>
  intent?: string
  args?: Record<string, unknown>
  background?: boolean
  timeoutMs?: number
}
