import type { ImDoctorStatus, ImDoctorStep, ImDoctorStepName } from './im-doctor-types.ts'

export type ImDoctorTrace = {
  imTraceId: string
  componentId: string
  status: ImDoctorStatus
  lastMessage: string
  startedAt: string
  updatedAt: string
  steps: ImDoctorStep[]
}

export type RecordImDoctorStepInput = {
  imTraceId: string
  componentId?: string | null
  step: ImDoctorStepName
  status: ImDoctorStatus
  message: string
  detail?: unknown
  createdAt?: string | number | Date | null
}

export type ImDoctorPlaneOptions = {
  maxEvents?: number
}

const DEFAULT_MAX_EVENTS = 500

const normalizeTimestamp = (value?: string | number | Date | null): string => {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return new Date(value).toISOString()
  if (typeof value === 'string' && value.trim()) return new Date(value).toISOString()
  return new Date().toISOString()
}

const generateStepId = (): string =>
  `im-doctor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const resolveTraceStatus = (steps: ImDoctorStep[]): ImDoctorStatus => {
  if (steps.some((step) => step.status === 'fail')) return 'fail'
  if (steps.some((step) => step.status === 'warn')) return 'warn'
  return 'pass'
}

export class ImDoctorPlane {
  private readonly maxEvents: number
  private events: ImDoctorStep[] = []

  constructor(options: ImDoctorPlaneOptions = {}) {
    this.maxEvents = Math.max(1, options.maxEvents ?? DEFAULT_MAX_EVENTS)
  }

  recordStep(input: RecordImDoctorStepInput): ImDoctorStep {
    const imTraceId = String(input.imTraceId ?? '').trim()
    if (!imTraceId) throw new Error('imTraceId is required')
    const step: ImDoctorStep = {
      id: generateStepId(),
      imTraceId,
      componentId: String(input.componentId ?? '').trim() || `trace:${imTraceId}`,
      step: input.step,
      status: input.status,
      message: input.message,
      detail: input.detail,
      createdAt: normalizeTimestamp(input.createdAt)
    }
    this.events.push(step)
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(this.events.length - this.maxEvents)
    }
    return step
  }

  getTrace(imTraceId: string): ImDoctorTrace | null {
    const normalized = String(imTraceId ?? '').trim()
    if (!normalized) return null
    const steps = this.events
      .filter((event) => event.imTraceId === normalized)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return this.buildTrace(steps)
  }

  listRecentTraces(limit = 20): ImDoctorTrace[] {
    const byTrace = new Map<string, ImDoctorStep[]>()
    const lastIndexByTrace = new Map<string, number>()
    for (const [index, event] of this.events.entries()) {
      const steps = byTrace.get(event.imTraceId) ?? []
      steps.push(event)
      byTrace.set(event.imTraceId, steps)
      lastIndexByTrace.set(event.imTraceId, index)
    }

    return Array.from(byTrace.values())
      .map((steps) => ({
        trace: this.buildTrace(steps),
        lastIndex: lastIndexByTrace.get(steps[0]?.imTraceId ?? '') ?? -1
      }))
      .filter((item): item is { trace: ImDoctorTrace; lastIndex: number } => Boolean(item.trace))
      .sort((a, b) => {
        const byUpdatedAt = b.trace.updatedAt.localeCompare(a.trace.updatedAt)
        return byUpdatedAt || b.lastIndex - a.lastIndex
      })
      .map((item) => item.trace)
      .slice(0, Math.max(0, limit))
  }

  clear(): void {
    this.events = []
  }

  private buildTrace(steps: ImDoctorStep[]): ImDoctorTrace | null {
    if (steps.length === 0) return null
    const ordered = [...steps].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const first = ordered[0]
    const last = ordered[ordered.length - 1]
    if (!first || !last) return null
    return {
      imTraceId: first.imTraceId,
      componentId: first.componentId,
      status: resolveTraceStatus(ordered),
      lastMessage: last.message,
      startedAt: first.createdAt,
      updatedAt: last.createdAt,
      steps: ordered
    }
  }
}
