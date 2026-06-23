import type {
  ScheduledTaskSchedule,
  ScheduledTaskValidationResult
} from '../../shared/scheduled-tasks.ts'
import { formatCoreTimestamp } from '../core-v2/time.ts'

const DURATION_RE =
  /^(\d+)\s*(ms|millisecond|milliseconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i

type CronFieldSpec = {
  min: number
  max: number
  aliasZero?: number[]
}

const CRON_SPECS: CronFieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6, aliasZero: [7] }
]

const fieldError = (path: string, message: string): ScheduledTaskValidationResult => ({
  ok: false,
  errorCode: 'VALIDATION_ERROR',
  message,
  fieldErrors: [{ path, message }]
})

export const parseDurationToMs = (input: string): number => {
  const normalized = String(input ?? '')
    .trim()
    .toLowerCase()
  const match = normalized.match(DURATION_RE)
  if (!match) {
    throw new Error(`Invalid duration "${input}". Use formats like 30m, 2h, or 1d.`)
  }

  const value = Number.parseInt(match[1] ?? '0', 10)
  const unit = match[2]?.toLowerCase()
  if (!Number.isFinite(value) || value <= 0 || !unit) {
    throw new Error(`Invalid duration "${input}".`)
  }

  const factor =
    unit === 'ms' || unit.startsWith('millisecond')
      ? 1
      : unit === 'm' || unit.startsWith('min')
        ? 60_000
        : unit === 'h' || unit.startsWith('hr') || unit.startsWith('hour')
          ? 3_600_000
          : 86_400_000
  return value * factor
}

const parseIsoDate = (input: string): Date => {
  const normalized = String(input ?? '').trim()
  const timestamp = Date.parse(normalized)
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid timestamp "${input}".`)
  return new Date(timestamp)
}

const normalizeEverySchedule = (
  durationInput: string,
  now = new Date()
): ScheduledTaskSchedule => ({
  kind: 'every',
  intervalMs: parseDurationToMs(durationInput),
  anchorAt: now.toISOString()
})

const normalizeAtSchedule = (scheduleInput: string, now = new Date()): ScheduledTaskSchedule => {
  const normalized = String(scheduleInput ?? '').trim()
  if (normalized.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(normalized)) {
    return {
      kind: 'at',
      runAt: parseIsoDate(normalized).toISOString()
    }
  }

  return {
    kind: 'at',
    runAt: new Date(now.getTime() + parseDurationToMs(normalized)).toISOString()
  }
}

const normalizeCronFieldValue = (value: number, spec: CronFieldSpec): number => {
  if (spec.aliasZero?.includes(value)) return 0
  return value
}

const parseCronToken = (token: string, spec: CronFieldSpec): Set<number> => {
  const trimmed = token.trim()
  if (!trimmed) throw new Error('Empty cron token.')
  if (trimmed === '*') {
    const values = new Set<number>()
    for (let value = spec.min; value <= spec.max; value += 1) values.add(value)
    return values
  }

  const stepParts = trimmed.split('/')
  if (stepParts.length > 2) throw new Error(`Invalid cron token "${trimmed}".`)
  const base = stepParts[0] ?? ''
  const step = stepParts.length === 2 ? Number.parseInt(stepParts[1] ?? '0', 10) : 1
  if (!Number.isFinite(step) || step <= 0)
    throw new Error(`Invalid step in cron token "${trimmed}".`)

  const rangeValues = new Set<number>()
  if (base === '*') {
    for (let value = spec.min; value <= spec.max; value += step) {
      rangeValues.add(value)
    }
    return rangeValues
  }

  const segments = base.split(',')
  for (const segment of segments) {
    const part = segment.trim()
    if (!part) throw new Error(`Invalid cron token "${trimmed}".`)
    const range = part.split('-')
    if (range.length > 2) throw new Error(`Invalid cron range "${part}".`)
    if (range.length === 1) {
      const value = normalizeCronFieldValue(Number.parseInt(range[0] ?? '', 10), spec)
      if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
        throw new Error(`Cron value "${part}" is out of range.`)
      }
      rangeValues.add(value)
      continue
    }

    let start = normalizeCronFieldValue(Number.parseInt(range[0] ?? '', 10), spec)
    let end = normalizeCronFieldValue(Number.parseInt(range[1] ?? '', 10), spec)
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`Invalid cron range "${part}".`)
    }
    if (start > end) {
      const temp = start
      start = end
      end = temp
    }
    if (start < spec.min || end > spec.max) {
      throw new Error(`Cron range "${part}" is out of range.`)
    }
    for (let value = start; value <= end; value += step) {
      rangeValues.add(value)
    }
  }

  return rangeValues
}

const validateCronExpression = (expression: string): void => {
  const parts = String(expression ?? '')
    .trim()
    .split(/\s+/)
  if (parts.length !== 5) {
    throw new Error('Cron expression must have 5 fields: minute hour day month weekday.')
  }
  parts.forEach((token, index) => {
    parseCronToken(token, CRON_SPECS[index] as CronFieldSpec)
  })
}

export const parseScheduledTaskSchedule = (
  schedule: string | ScheduledTaskSchedule,
  now = new Date()
): ScheduledTaskSchedule => {
  if (typeof schedule === 'object' && schedule) {
    if (schedule.kind === 'at') {
      return {
        kind: 'at',
        runAt: parseIsoDate(schedule.runAt).toISOString()
      }
    }
    if (schedule.kind === 'every') {
      if (!Number.isFinite(schedule.intervalMs) || schedule.intervalMs <= 0) {
        throw new Error('Every schedule intervalMs must be a positive number.')
      }
      return {
        kind: 'every',
        intervalMs: Math.trunc(schedule.intervalMs),
        anchorAt: schedule.anchorAt
          ? parseIsoDate(schedule.anchorAt).toISOString()
          : now.toISOString()
      }
    }
    if (schedule.kind === 'cron') {
      validateCronExpression(schedule.expression)
      return {
        kind: 'cron',
        expression: schedule.expression.trim()
      }
    }
    throw new Error(`Unsupported schedule kind "${(schedule as any).kind ?? ''}".`)
  }

  const normalized = String(schedule ?? '').trim()
  if (!normalized) throw new Error('schedule is required.')
  if (/^at\s+/i.test(normalized)) {
    return normalizeAtSchedule(normalized.replace(/^at\s+/i, ''), now)
  }
  if (/^every\s+/i.test(normalized)) {
    return normalizeEverySchedule(normalized.replace(/^every\s+/i, ''), now)
  }
  if (normalized.split(/\s+/).length === 5) {
    validateCronExpression(normalized)
    return {
      kind: 'cron',
      expression: normalized
    }
  }
  return normalizeAtSchedule(normalized, now)
}

export const getScheduleDisplay = (schedule: ScheduledTaskSchedule): string => {
  if (schedule.kind === 'at') return `at ${schedule.runAt}`
  if (schedule.kind === 'every') {
    const intervalMs = schedule.intervalMs
    if (intervalMs % 86_400_000 === 0) return `every ${intervalMs / 86_400_000}d`
    if (intervalMs % 3_600_000 === 0) return `every ${intervalMs / 3_600_000}h`
    if (intervalMs % 60_000 === 0) return `every ${intervalMs / 60_000}m`
    return `every ${intervalMs}ms`
  }
  return schedule.expression
}

const matchesCronField = (token: string, value: number, spec: CronFieldSpec): boolean =>
  parseCronToken(token, spec).has(normalizeCronFieldValue(value, spec))

const roundUpToNextMinute = (date: Date): Date => {
  const rounded = new Date(date)
  rounded.setSeconds(0, 0)
  rounded.setMinutes(rounded.getMinutes() + 1)
  return rounded
}

const computeNextCronRun = (expression: string, after: Date): string | null => {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const candidate = roundUpToNextMinute(after)
  const limit = new Date(candidate.getTime() + 366 * 24 * 60 * 60 * 1000)

  while (candidate <= limit) {
    const minute = candidate.getMinutes()
    const hour = candidate.getHours()
    const day = candidate.getDate()
    const month = candidate.getMonth() + 1
    const weekday = candidate.getDay()

    if (
      matchesCronField(parts[0] ?? '*', minute, CRON_SPECS[0] as CronFieldSpec) &&
      matchesCronField(parts[1] ?? '*', hour, CRON_SPECS[1] as CronFieldSpec) &&
      matchesCronField(parts[2] ?? '*', day, CRON_SPECS[2] as CronFieldSpec) &&
      matchesCronField(parts[3] ?? '*', month, CRON_SPECS[3] as CronFieldSpec) &&
      matchesCronField(parts[4] ?? '*', weekday, CRON_SPECS[4] as CronFieldSpec)
    ) {
      return formatCoreTimestamp(candidate)
    }
    candidate.setMinutes(candidate.getMinutes() + 1)
  }

  return null
}

export const computeScheduledTaskNextRunAt = (
  schedule: ScheduledTaskSchedule,
  after = new Date()
): string | null => {
  if (schedule.kind === 'at') {
    const runAt = parseIsoDate(schedule.runAt)
    return runAt.getTime() >= after.getTime() ? runAt.toISOString() : null
  }
  if (schedule.kind === 'every') {
    const anchor = schedule.anchorAt ? parseIsoDate(schedule.anchorAt) : after
    const start = anchor.getTime()
    const now = after.getTime()
    if (start > now) return anchor.toISOString()
    const elapsed = now - start
    const intervals = Math.floor(elapsed / schedule.intervalMs) + 1
    return new Date(start + intervals * schedule.intervalMs).toISOString()
  }
  return computeNextCronRun(schedule.expression, after)
}

export const validateScheduledTaskSchedule = (
  schedule: string | ScheduledTaskSchedule
): ScheduledTaskValidationResult | null => {
  try {
    parseScheduledTaskSchedule(schedule)
    return null
  } catch (error) {
    return fieldError(
      'payload.schedule',
      error instanceof Error ? error.message : 'Invalid schedule.'
    )
  }
}
