import electron from 'electron'
import type {
  ComputerUseAction,
  ComputerUseDoctorResult,
  ComputerUsePermissionState,
  ComputerUseRequest,
  ComputerUseResult
} from './computer-use-types.ts'
import {
  getNativeHelperClient,
  resolveComputerUseHelperPath,
  type NativeHelperClient
} from './native-helper-client.ts'

const { shell, systemPreferences } = electron as typeof import('electron')

const normalizeMediaStatus = (value: unknown): ComputerUsePermissionState => {
  if (
    value === 'granted' ||
    value === 'denied' ||
    value === 'restricted' ||
    value === 'not-determined' ||
    value === 'unknown'
  ) {
    return value
  }
  return 'unknown'
}

const stripInlineImageData = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripInlineImageData)
  if (!value || typeof value !== 'object') return value

  const sanitized: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'dataBase64') continue
    sanitized[key] = stripInlineImageData(entry)
  }
  return sanitized
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const createSnapshotId = (): string =>
  `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const flattenAccessibilityTree = (root: unknown): Array<Record<string, unknown>> => {
  const elements: Array<Record<string, unknown>> = []

  const visit = (node: unknown): void => {
    if (!isRecord(node)) return
    const element: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'children') element[key] = value
    }
    elements.push(element)

    const children = node.children
    if (Array.isArray(children)) {
      for (const child of children) visit(child)
    }
  }

  visit(root)
  return elements
}

const normalizeAccessibilityObservation = (
  value: unknown,
  options: { forceSnapshotId?: boolean } = {}
): Record<string, unknown> => {
  const record: Record<string, unknown> = isRecord(value) ? { ...value } : { result: value }
  const hasTree = isRecord(record.accessibilityTree)
  if (options.forceSnapshotId || hasTree || Array.isArray(record.elements)) {
    if (typeof record.snapshotId !== 'string') record.snapshotId = createSnapshotId()
  }
  if (!Array.isArray(record.elements) && hasTree) {
    record.elements = flattenAccessibilityTree(record.accessibilityTree)
  }
  return record
}

const postActionScreenshotActions = new Set<ComputerUseAction>([
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
  'raise_window'
])

const toNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const toStringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

export class ComputerUseService {
  private readonly helperClient: NativeHelperClient

  constructor(helperClient: NativeHelperClient = getNativeHelperClient()) {
    this.helperClient = helperClient
  }

  async execute(request: ComputerUseRequest): Promise<ComputerUseResult> {
    if (request.action === 'doctor') {
      const doctor = await this.doctor()
      return {
        ok: true,
        action: request.action,
        observation: { doctor },
        warnings: doctor.warnings
      }
    }

    if (process.platform !== 'darwin') {
      throw new Error('Computer Use desktop control is currently implemented for macOS only.')
    }

    if (request.action === 'request_permissions') {
      const result = await this.requestPermissions(request.timeoutMs)
      return {
        ok: true,
        action: request.action,
        actionResult: result
      }
    }

    const rawResult = await this.helperClient.request(request.action, request)
    const result = await this.withPostActionScreenshot(request, rawResult)
    return this.mapHelperResult(request, result)
  }

  async doctor(): Promise<ComputerUseDoctorResult> {
    const helperPath = resolveComputerUseHelperPath()
    let accessibility = this.getAccessibilityStatus()
    let screenRecording = this.getScreenRecordingStatus()
    const isMac = process.platform === 'darwin'
    const helperAvailable = Boolean(helperPath)
    const warnings: string[] = []
    let helperDoctor: Record<string, unknown> | null = null

    if (!isMac) warnings.push('Computer Use native helper is planned for macOS first.')
    if (!helperAvailable) warnings.push('Native Computer Use helper is not installed yet.')
    if (accessibility !== 'granted') warnings.push('Accessibility permission is not granted.')
    if (screenRecording !== 'granted') warnings.push('Screen Recording permission is not granted.')
    if (isMac && helperAvailable) {
      try {
        const value = await this.helperClient.request('doctor', {
          action: 'doctor',
          timeoutMs: 5_000
        })
        helperDoctor =
          value && typeof value === 'object' ? (value as Record<string, unknown>) : null
        accessibility = this.getNestedPermission(
          helperDoctor,
          'permissions',
          'accessibility',
          accessibility
        )
        screenRecording = this.getNestedPermission(
          helperDoctor,
          'permissions',
          'screenRecording',
          screenRecording
        )
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error))
      }
    }

    return {
      platform: process.platform,
      available:
        isMac && helperAvailable && accessibility === 'granted' && screenRecording === 'granted',
      stage: helperAvailable ? 'native-helper' : 'typescript-shell',
      helper: {
        available: helperAvailable,
        path: helperPath
      },
      permissions: {
        accessibility,
        screenRecording
      },
      capabilities: {
        observe:
          isMac &&
          helperAvailable &&
          screenRecording === 'granted' &&
          this.getNestedBoolean(helperDoctor, 'capabilities', 'screenshot', true),
        foregroundInput:
          isMac &&
          helperAvailable &&
          accessibility === 'granted' &&
          this.getNestedBoolean(helperDoctor, 'capabilities', 'foregroundInput', true),
        backgroundClick:
          isMac &&
          helperAvailable &&
          accessibility === 'granted' &&
          this.getNestedBoolean(helperDoctor, 'capabilities', 'backgroundClick', true),
        backgroundKeyboard:
          isMac &&
          helperAvailable &&
          accessibility === 'granted' &&
          this.getNestedBoolean(helperDoctor, 'capabilities', 'backgroundKeyboard', false),
        backgroundDrag:
          isMac &&
          helperAvailable &&
          accessibility === 'granted' &&
          this.getNestedBoolean(helperDoctor, 'capabilities', 'backgroundDrag', false),
        backgroundScroll:
          isMac &&
          helperAvailable &&
          accessibility === 'granted' &&
          this.getNestedBoolean(helperDoctor, 'capabilities', 'backgroundScroll', false),
        windowLocalBackgroundClick:
          isMac &&
          helperAvailable &&
          accessibility === 'granted' &&
          this.getNestedBoolean(helperDoctor, 'capabilities', 'windowLocalBackgroundClick', false),
        privateSymbols: {
          cgEventPostToPid: this.getNestedBoolean(
            helperDoctor,
            'capabilities',
            'privateSymbols.cgEventPostToPid',
            false
          ),
          cgEventSetWindowLocation: this.getNestedBoolean(
            helperDoctor,
            'capabilities',
            'privateSymbols.cgEventSetWindowLocation',
            false
          )
        }
      },
      warnings
    }
  }

  private getAccessibilityStatus(): ComputerUsePermissionState {
    if (process.platform !== 'darwin') return 'unknown'
    try {
      return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
    } catch {
      return 'unknown'
    }
  }

  private getScreenRecordingStatus(): ComputerUsePermissionState {
    if (process.platform !== 'darwin') return 'unknown'
    try {
      return normalizeMediaStatus(systemPreferences.getMediaAccessStatus('screen'))
    } catch {
      return 'unknown'
    }
  }

  private async requestPermissions(timeoutMs?: number): Promise<Record<string, unknown>> {
    let helperResult: Record<string, unknown> | null = null
    try {
      const value = await this.helperClient.request('request_permissions', {
        action: 'request_permissions',
        timeoutMs: timeoutMs ?? 30_000
      })
      helperResult =
        value && typeof value === 'object' ? (value as Record<string, unknown>) : { result: value }
    } catch (error) {
      helperResult = { error: error instanceof Error ? error.message : String(error) }
    }

    const doctor = await this.doctor()
    if (doctor.permissions.screenRecording !== 'granted') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      )
    }
    if (doctor.permissions.accessibility !== 'granted') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      )
    }

    return {
      helper: helperResult,
      doctor,
      note: 'macOS only shows the Screen Recording prompt once per TCC identity. If it was already denied, enable it in System Settings and restart PiAgent.'
    }
  }

  private mapHelperResult(request: ComputerUseRequest, result: unknown): ComputerUseResult {
    const sanitizedResult = stripInlineImageData(result)
    if (request.action === 'screenshot' || request.action === 'capture_window') {
      return {
        ok: true,
        action: request.action,
        observation: { screenshot: sanitizedResult as Record<string, unknown> }
      }
    }
    if (request.action === 'snapshot_window') {
      return {
        ok: true,
        action: request.action,
        observation: normalizeAccessibilityObservation(sanitizedResult, { forceSnapshotId: true })
      }
    }
    if (request.action === 'list_apps') {
      return {
        ok: true,
        action: request.action,
        observation: { apps: Array.isArray(result) ? result : [] }
      }
    }
    if (request.action === 'list_windows') {
      return {
        ok: true,
        action: request.action,
        observation: { windows: Array.isArray(result) ? result : [] }
      }
    }
    if (request.action === 'get_app_state') {
      return {
        ok: true,
        action: request.action,
        observation: normalizeAccessibilityObservation(sanitizedResult)
      }
    }
    return {
      ok: true,
      action: request.action,
      actionResult:
        sanitizedResult && typeof sanitizedResult === 'object'
          ? (sanitizedResult as Record<string, unknown>)
          : { result: sanitizedResult }
    }
  }

  private async withPostActionScreenshot(
    request: ComputerUseRequest,
    result: unknown
  ): Promise<unknown> {
    if (!postActionScreenshotActions.has(request.action) || !isRecord(result)) return result

    const captureRequest = this.createPostActionCaptureRequest(request, result)
    if (!captureRequest) return result

    try {
      const screenshot = await this.helperClient.request('capture_window', captureRequest)
      return {
        ...result,
        postActionScreenshot: stripInlineImageData(screenshot)
      }
    } catch (error) {
      return {
        ...result,
        postActionScreenshotError: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private createPostActionCaptureRequest(
    request: ComputerUseRequest,
    result: Record<string, unknown>
  ): ComputerUseRequest | null {
    const target = isRecord(result.target) ? result.target : {}
    const pid = request.pid ?? toNumber(target.pid)
    const bundle =
      request.bundle ?? toStringValue(target.bundle) ?? toStringValue(target.bundleId)
    const app = request.app ?? toStringValue(target.app) ?? toStringValue(target.name)
    const windowId = request.windowId ?? toNumber(target.windowId)

    if (pid === undefined && bundle === undefined && app === undefined) return null

    return {
      action: 'capture_window',
      pid,
      bundle,
      app,
      windowId,
      timeoutMs: Math.min(request.timeoutMs ?? 10_000, 10_000)
    }
  }

  private getNestedBoolean(
    source: Record<string, unknown> | null,
    first: string,
    second: string,
    fallback: boolean
  ): boolean {
    const firstValue = source?.[first]
    if (!firstValue || typeof firstValue !== 'object') return fallback
    const path = second.split('.')
    let value: unknown = firstValue
    for (const key of path) {
      if (!value || typeof value !== 'object') return fallback
      value = (value as Record<string, unknown>)[key]
    }
    return typeof value === 'boolean' ? value : fallback
  }

  private getNestedPermission(
    source: Record<string, unknown> | null,
    first: string,
    second: string,
    fallback: ComputerUsePermissionState
  ): ComputerUsePermissionState {
    const firstValue = source?.[first]
    if (!firstValue || typeof firstValue !== 'object') return fallback
    const raw = (firstValue as Record<string, unknown>)[second]
    return raw === undefined ? fallback : normalizeMediaStatus(raw)
  }
}

let computerUseServiceSingleton: ComputerUseService | null = null

export const getComputerUseService = (): ComputerUseService => {
  if (computerUseServiceSingleton) return computerUseServiceSingleton
  computerUseServiceSingleton = new ComputerUseService()
  return computerUseServiceSingleton
}
