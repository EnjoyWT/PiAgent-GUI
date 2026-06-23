const TELEGRAM_BOT_TOKEN_PATTERN = /\d{5,}:[A-Za-z0-9_-]{16,}/g

export const redactSensitiveText = (value: string): string =>
  value.replace(TELEGRAM_BOT_TOKEN_PATTERN, '[REDACTED_TELEGRAM_BOT_TOKEN]')

export const sanitizeForLog = (value: unknown): unknown => sanitizeValue(value, new WeakSet())

const sanitizeValue = (value: unknown, seen: WeakSet<object>): unknown => {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value

  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) return sanitizeError(value, seen)

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen))
  }

  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    output[key] = sanitizeValue((value as Record<string, unknown>)[key], seen)
  }
  return output
}

const sanitizeError = (error: Error, seen: WeakSet<object>): Record<string, unknown> => {
  const output: Record<string, unknown> = {
    name: error.name,
    message: redactSensitiveText(error.message)
  }

  if (error.stack) output.stack = redactSensitiveText(error.stack)

  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === 'name' || key === 'message' || key === 'stack') continue
    output[key] = sanitizeValue((error as unknown as Record<string, unknown>)[key], seen)
  }

  const errorWithCause = error as Error & { cause?: unknown }
  if (errorWithCause.cause !== undefined && !Object.hasOwn(output, 'cause')) {
    output.cause = sanitizeValue(errorWithCause.cause, seen)
  }

  return output
}
