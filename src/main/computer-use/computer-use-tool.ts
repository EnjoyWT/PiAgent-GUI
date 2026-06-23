import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import { getComputerUseService, type ComputerUseService } from './computer-use-service.ts'
import type { ComputerUseAction, ComputerUseRequest } from './computer-use-types.ts'

type CreateComputerUseToolOptions = {
  service?: Pick<ComputerUseService, 'execute' | 'doctor'>
}

const actionValues: ComputerUseAction[] = [
  'doctor',
  'request_permissions',
  'list_apps',
  'list_windows',
  'get_app_state',
  'screenshot',
  'snapshot_window',
  'capture_window',
  'click',
  'double_click',
  'right_click',
  'drag',
  'scroll',
  'set_value',
  'type_text',
  'press_key',
  'intent',
  'open_url',
  'raise_window',
  'wait'
]

const parametersSchema = Type.Object(
  {
    action: Type.String({
      enum: actionValues,
      description:
        'Computer Use action. Use snapshot_window before GUI automation to get a window screenshot and accessibility refs.'
    }),
    app: Type.Optional(Type.String({ description: 'Target application name or bundle id.' })),
    bundle: Type.Optional(Type.String({ description: 'Target application bundle id.' })),
    pid: Type.Optional(Type.Number({ description: 'Target process id.' })),
    windowId: Type.Optional(Type.Number({ description: 'Target native window id.' })),
    elementId: Type.Optional(
      Type.String({
        description: 'Stable accessibility element id from get_app_state or snapshot_window.'
      })
    ),
    ref: Type.Optional(
      Type.String({ description: 'Alias for elementId, e.g. e7 from snapshot_window.' })
    ),
    url: Type.Optional(Type.String({ description: 'URL for open_url.' })),
    x: Type.Optional(
      Type.Number({ description: 'Screen or window x coordinate, depending on target.' })
    ),
    y: Type.Optional(
      Type.Number({ description: 'Screen or window y coordinate, depending on target.' })
    ),
    toX: Type.Optional(Type.Number({ description: 'Drag target x coordinate.' })),
    toY: Type.Optional(Type.Number({ description: 'Drag target y coordinate.' })),
    endX: Type.Optional(Type.Number({ description: 'Alias for drag target x coordinate.' })),
    endY: Type.Optional(Type.Number({ description: 'Alias for drag target y coordinate.' })),
    deltaX: Type.Optional(Type.Number({ description: 'Horizontal scroll delta.' })),
    deltaY: Type.Optional(Type.Number({ description: 'Vertical scroll delta.' })),
    displayId: Type.Optional(Type.Number({ description: 'Target display id for screenshot.' })),
    maxDepth: Type.Optional(
      Type.Number({ description: 'Maximum accessibility tree depth for get_app_state.' })
    ),
    maxChildren: Type.Optional(
      Type.Number({ description: 'Maximum children per accessibility node.' })
    ),
    button: Type.Optional(Type.String({ enum: ['left', 'right', 'middle'] })),
    text: Type.Optional(Type.String({ description: 'Text to type.' })),
    value: Type.Optional(
      Type.Unknown({ description: 'Value for deterministic AX set_value operations.' })
    ),
    key: Type.Optional(Type.String({ description: 'Key name for press_key.' })),
    modifiers: Type.Optional(
      Type.Array(Type.String({ enum: ['cmd', 'shift', 'option', 'ctrl'] }), {
        description: 'Modifier keys for press_key.'
      })
    ),
    intent: Type.Optional(
      Type.String({
        description:
          'Deterministic high-level operation for the helper to execute, e.g. launch or open_url.'
      })
    ),
    args: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description: 'Intent-specific structured arguments.'
      })
    ),
    background: Type.Optional(
      Type.Boolean({
        description:
          'Request background operation on macOS. Use for click, drag, scroll, type_text, and press_key when the target app must not become frontmost.'
      })
    ),
    timeoutMs: Type.Optional(
      Type.Number({ description: 'Optional action timeout in milliseconds.' })
    )
  },
  { additionalProperties: false }
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeAction = (value: unknown): ComputerUseAction => {
  const action = String(value ?? '').trim() as ComputerUseAction
  if (!actionValues.includes(action))
    throw new Error(`Unsupported Computer Use action: ${String(value ?? '')}`)
  return action
}

const defaultBackgroundActions = new Set<ComputerUseAction>([
  'click',
  'double_click',
  'right_click',
  'drag',
  'scroll',
  'set_value',
  'type_text',
  'press_key',
  'intent',
  'open_url'
])

const normalizeRequest = (params: unknown): ComputerUseRequest => {
  const input = isRecord(params) ? params : {}
  const action = normalizeAction(input.action)
  const explicitBackground = typeof input.background === 'boolean' ? input.background : undefined
  return {
    action,
    app: typeof input.app === 'string' ? input.app : undefined,
    bundle: typeof input.bundle === 'string' ? input.bundle : undefined,
    pid: typeof input.pid === 'number' ? input.pid : undefined,
    windowId: typeof input.windowId === 'number' ? input.windowId : undefined,
    elementId: typeof input.elementId === 'string' ? input.elementId : undefined,
    ref: typeof input.ref === 'string' ? input.ref : undefined,
    url: typeof input.url === 'string' ? input.url : undefined,
    x: typeof input.x === 'number' ? input.x : undefined,
    y: typeof input.y === 'number' ? input.y : undefined,
    toX: typeof input.toX === 'number' ? input.toX : undefined,
    toY: typeof input.toY === 'number' ? input.toY : undefined,
    endX: typeof input.endX === 'number' ? input.endX : undefined,
    endY: typeof input.endY === 'number' ? input.endY : undefined,
    deltaX: typeof input.deltaX === 'number' ? input.deltaX : undefined,
    deltaY: typeof input.deltaY === 'number' ? input.deltaY : undefined,
    displayId: typeof input.displayId === 'number' ? input.displayId : undefined,
    maxDepth: typeof input.maxDepth === 'number' ? input.maxDepth : undefined,
    maxChildren: typeof input.maxChildren === 'number' ? input.maxChildren : undefined,
    button:
      input.button === 'left' || input.button === 'right' || input.button === 'middle'
        ? input.button
        : undefined,
    text: typeof input.text === 'string' ? input.text : undefined,
    value: input.value,
    key: typeof input.key === 'string' ? input.key : undefined,
    modifiers: Array.isArray(input.modifiers)
      ? input.modifiers.filter(
          (value): value is 'cmd' | 'shift' | 'option' | 'ctrl' =>
            value === 'cmd' || value === 'shift' || value === 'option' || value === 'ctrl'
        )
      : undefined,
    intent: typeof input.intent === 'string' ? input.intent : undefined,
    args: isRecord(input.args) ? input.args : undefined,
    background:
      explicitBackground ?? (defaultBackgroundActions.has(action) ? true : undefined),
    timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined
  }
}

export const createComputerUseTool = (
  options: CreateComputerUseToolOptions = {}
): ToolDefinition => {
  const service = options.service ?? getComputerUseService()
  return {
    name: 'computerUseTool',
    label: 'Computer Use Tool',
    description:
      'Observe and operate the local desktop GUI from inside PiAgent. Use doctor first to inspect permissions and native helper readiness. This is a local built-in capability, not MCP.',
    parameters: parametersSchema,
    promptSnippet:
      'Use computerUseTool only on the local desktop surface. Run action "doctor" before GUI automation when capability status is unknown. Screenshot results are path-based and render in the chat flow; call screenshot, capture_window, or snapshot_window after important GUI steps to verify state. For background operation, set background=true on every click, drag, scroll, type_text, press_key, set_value, and intent call, always include an explicit pid/bundle/app/window target, use intent=launch or open_url with background=true only for app bundle launch, and do not call raise_window or foreground open_url unless the user permits focus changes. Prefer deterministic operations when available: use set_value on focused text fields or refs, use intent for launch/open_url, and verify with snapshot_window after important state changes. For save or rename workflows, prefer deterministic keyboard/menu sequences: press_key cmd+s, snapshot_window the save dialog, select the filename field by ref when possible, use press_key cmd+a before set_value or type_text for replacement, press_key return to confirm, then screenshot or snapshot_window to verify.',
    execute: async (_toolCallId, params) => {
      const request = normalizeRequest(params)
      const result = await service.execute(request)
      return {
        content: [
          {
            type: 'text' as const,
            text: result.ok
              ? `Computer Use ${request.action} completed.`
              : `Computer Use ${request.action} failed.`
          }
        ],
        details: result
      }
    }
  }
}
