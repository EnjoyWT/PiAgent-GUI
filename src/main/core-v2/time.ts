type TimestampInput = string | number | Date | null | undefined

const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

const isValidDate = (value: Date): boolean => Number.isFinite(value.getTime())
let lastGeneratedTimestampMs = 0

export const formatCoreTimestamp = (date = new Date()): string => {
  const source = isValidDate(date) ? date : new Date()
  const offsetMinutes = -source.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const offsetAbs = Math.abs(offsetMinutes)

  return [
    `${source.getFullYear()}-${pad(source.getMonth() + 1)}-${pad(source.getDate())}`,
    'T',
    `${pad(source.getHours())}:${pad(source.getMinutes())}:${pad(source.getSeconds())}`,
    `.${pad(source.getMilliseconds(), 3)}`,
    `${sign}${pad(Math.floor(offsetAbs / 60))}:${pad(offsetAbs % 60)}`
  ].join('')
}

export const normalizeCoreTimestamp = (value?: TimestampInput): string => {
  if (value instanceof Date) return formatCoreTimestamp(value)
  if (typeof value === 'number' && Number.isFinite(value))
    return formatCoreTimestamp(new Date(value))

  if (typeof value === 'string') {
    const raw = value.trim()
    if (raw) {
      const timestamp = Date.parse(raw)
      if (Number.isFinite(timestamp)) return formatCoreTimestamp(new Date(timestamp))
    }
  }

  const now = Date.now()
  const nextMs = now <= lastGeneratedTimestampMs ? lastGeneratedTimestampMs + 1 : now
  lastGeneratedTimestampMs = nextMs
  return formatCoreTimestamp(new Date(nextMs))
}

export const parseCoreTimestampMs = (value?: TimestampInput): number => {
  if (value instanceof Date) return isValidDate(value) ? value.getTime() : Date.now()
  if (typeof value === 'number' && Number.isFinite(value)) return value

  if (typeof value === 'string') {
    const raw = value.trim()
    if (raw) {
      const timestamp = Date.parse(raw)
      if (Number.isFinite(timestamp)) return timestamp
    }
  }

  return Date.now()
}
