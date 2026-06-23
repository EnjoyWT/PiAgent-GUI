import type { ChatMessage, ChatWidget } from '../components/chat/types'

type JsonRecord = Record<string, unknown>
type WidgetToolSource = {
  name?: string | null
  args?: unknown
  summary?: string | null
}

const asRecord = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
const normalizeToolName = (value: string): string => value.trim().toLowerCase()

export const buildWidgetStateFromTool = (tool: WidgetToolSource): ChatWidget | null => {
  const summary = asString(tool.summary).trim()
  if (summary.startsWith('{')) {
    try {
      const parsed = JSON.parse(summary) as JsonRecord
      const html = asString(parsed.html).trim()
      if (html) {
        return {
          kind: 'html',
          placement: 'inline',
          title: asString(parsed.title) || undefined,
          html,
          config: asRecord(parsed.config) as
            | { showHeader?: boolean; fullWidth?: boolean }
            | undefined
        }
      }
    } catch {
      // Fall through to args-based recovery.
    }
  }

  const args = asRecord(tool.args)
  if (!args) return null
  const title = asString(args.title) || undefined
  const config = asRecord(args.config) as { showHeader?: boolean; fullWidth?: boolean } | undefined
  const type = asString(args.type)
  const html = asString(args.html).trim()

  if (type === 'html' && html) {
    return {
      kind: 'html',
      placement: 'inline',
      html,
      title,
      config
    }
  }

  return null
}

export const resolveInlineWidgetFromMessage = (message: ChatMessage): ChatWidget | null => {
  if (message.widget) return message.widget
  if (message.role !== 'assistant' || !message.run) return null

  const turns = message.agentTurnId
    ? message.run.turns.filter((turn) => turn.id === message.agentTurnId)
    : message.run.turns.length <= 1
      ? message.run.turns
      : []
  if (turns.length === 0) return null

  const widgetTool = [...turns.flatMap((turn) => turn.toolCalls)]
    .reverse()
    .find((tool) => normalizeToolName(tool.name) === 'widgetrenderer' && tool.status === 'done')
  if (!widgetTool) return null

  return buildWidgetStateFromTool(widgetTool)
}
