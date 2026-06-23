import type { ChatToolStep } from './types'

const MAX_FORMATTED_ARG_LENGTH = 800

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const normalizeToolName = (name: string): string => (name || '').trim().toLowerCase()

const truncateArg = (value: string): string =>
  value.length > MAX_FORMATTED_ARG_LENGTH ? `${value.slice(0, MAX_FORMATTED_ARG_LENGTH)}...` : value

const formatArgValue = (value: unknown): string | null => {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return null
  if (typeof value === 'string') return truncateArg(value)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    return truncateArg(JSON.stringify(value))
  } catch {
    return truncateArg(String(value))
  }
}

export const formatToolCommand = (step: Pick<ChatToolStep, 'toolName' | 'args'>): string => {
  const args = asRecord(step.args)
  if (!args) {
    const name = normalizeToolName(step.toolName)
    if (name === 'bash') return ''
    return step.toolName || ''
  }

  const command = args.command
  if (typeof command === 'string') return command

  const argText = Object.entries(args)
    .flatMap(([key, value]) => {
      const formatted = formatArgValue(value)
      return formatted == null ? [] : [`--${key} ${formatted}`]
    })
    .join(' ')

  return `${step.toolName}${argText ? ` ${argText}` : ''}`
}
