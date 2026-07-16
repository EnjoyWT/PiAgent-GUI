import type { ChatMessage } from '../components/chat/types'
import { getMessageIdentityKey } from './message-keys.ts'

const parseMessageCreatedAtMs = (value?: string): number | null => {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw || raw === 'undefined') return null
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    const timestamp = Date.parse(raw.replace(' ', 'T') + 'Z')
    return Number.isFinite(timestamp) ? timestamp : null
  }
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? timestamp : null
}

export const compareChatMessagesByTimeline = (
  a: Pick<ChatMessage, 'createdAt' | 'runtimeSequence' | 'id'>,
  b: Pick<ChatMessage, 'createdAt' | 'runtimeSequence' | 'id'>
): number => {
  const aCreatedAt = parseMessageCreatedAtMs(a.createdAt)
  const bCreatedAt = parseMessageCreatedAtMs(b.createdAt)
  const aHasCreatedAt = aCreatedAt != null
  const bHasCreatedAt = bCreatedAt != null
  if (aCreatedAt != null && bCreatedAt != null && aCreatedAt !== bCreatedAt) {
    return aCreatedAt - bCreatedAt
  }

  const aHasSequence = typeof a.runtimeSequence === 'number'
  const bHasSequence = typeof b.runtimeSequence === 'number'
  if (aHasSequence && bHasSequence) {
    const sequenceDelta = (a.runtimeSequence ?? 0) - (b.runtimeSequence ?? 0)
    if (sequenceDelta !== 0) return sequenceDelta
  }

  // Preserve persisted message chronology ahead of live seq-only placeholders.
  if (aHasCreatedAt && !aHasSequence && bHasSequence && !bHasCreatedAt) return -1
  if (bHasCreatedAt && !bHasSequence && aHasSequence && !aHasCreatedAt) return 1

  if (aHasCreatedAt !== bHasCreatedAt) {
    return aHasCreatedAt ? -1 : 1
  }

  if (aHasSequence !== bHasSequence) {
    return aHasSequence ? -1 : 1
  }

  return (a.id ?? '').localeCompare(b.id ?? '')
}

export const mergeLatestWindowAuthoritatively = (
  existing: ChatMessage[],
  latestPage: ChatMessage[]
): ChatMessage[] => {
  const oldestLatest = latestPage[0]
  if (!oldestLatest) return []

  const latestIds = new Set(latestPage.map((message) => message.id).filter(Boolean))
  const preservedHistory = existing.filter(
    (message) =>
      message.id &&
      !latestIds.has(message.id) &&
      compareChatMessagesByTimeline(message, oldestLatest) < 0
  )

  const unpersisted = existing.filter((message) => {
    if (message.id) return false
    if (compareChatMessagesByTimeline(message, oldestLatest) < 0) return false

    if (message.role === 'assistant' && message.agentTurnId) {
      if (latestPage.some((m) => m.role === 'assistant' && m.agentTurnId === message.agentTurnId)) {
        return false
      }
    }


    return true
  })

  const merged = [...preservedHistory, ...latestPage, ...unpersisted]

  const decorated = merged.map((message, index) => ({ message, index }))
  decorated.sort((a, b) => {
    const delta = compareChatMessagesByTimeline(a.message, b.message)
    if (delta !== 0) return delta
    return a.index - b.index
  })

  return decorated.map((d) => d.message)
}

const isInlineHtmlWidget = (
  widget: ChatMessage['widget'] | null | undefined
): widget is NonNullable<ChatMessage['widget']> =>
  Boolean(widget?.kind === 'html' && widget.placement === 'inline' && widget.html)

export const preserveLatestInlineWidgetRuntimeState = (
  existing: ChatMessage[],
  latestPage: ChatMessage[]
): ChatMessage[] => {
  if (existing.length === 0 || latestPage.length === 0) return latestPage

  const runtimeStateByKey = new Map<
    string,
    {
      html: string
      url: string
      widgetId?: string
    }
  >()

  for (const message of existing) {
    if (!isInlineHtmlWidget(message.widget) || !message.widget.url) continue
    runtimeStateByKey.set(getMessageIdentityKey(message), {
      html: message.widget.html ?? '',
      url: message.widget.url,
      widgetId: message.widget.widgetId
    })
  }

  return latestPage.map((message) => {
    if (!isInlineHtmlWidget(message.widget) || message.widget.url) return message
    const runtimeState = runtimeStateByKey.get(getMessageIdentityKey(message))
    if (!runtimeState) return message
    if ((message.widget.html ?? '') !== runtimeState.html) return message
    return {
      ...message,
      widget: {
        ...message.widget,
        url: runtimeState.url,
        widgetId: runtimeState.widgetId
      }
    }
  })
}
