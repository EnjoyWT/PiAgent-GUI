import { generateId } from '@shared/id'
import { LOCAL_HTTP_BASE_URL } from '../http/local-http-config'

export interface RegisteredWidget {
  id: string
  threadId: string
  html: string
  createdAt: number
  lastAccessAt: number
  inactiveSinceAt: number | null
}

const widgets = new Map<string, RegisteredWidget>()
const INACTIVE_TTL_MS = 10 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 1000

const sweepExpiredWidgets = (): void => {
  const now = Date.now()
  for (const [id, widget] of widgets.entries()) {
    if (widget.inactiveSinceAt == null) continue
    if (now - widget.inactiveSinceAt < INACTIVE_TTL_MS) continue
    widgets.delete(id)
  }
}

const sweepTimer = setInterval(sweepExpiredWidgets, SWEEP_INTERVAL_MS)
sweepTimer.unref?.()

export const registerWidgetHtml = (threadId: string, html: string): { id: string; url: string } => {
  const now = Date.now()
  const id = generateId()
  widgets.set(id, {
    id,
    threadId,
    html,
    createdAt: now,
    lastAccessAt: now,
    inactiveSinceAt: null
  })
  return {
    id,
    url: `${LOCAL_HTTP_BASE_URL}/widgets/view/${encodeURIComponent(id)}`
  }
}

export const getRegisteredWidget = (id: string): RegisteredWidget | null => {
  const widget = widgets.get(id) ?? null
  if (!widget) return null
  widget.lastAccessAt = Date.now()
  widget.inactiveSinceAt = null
  return widget
}

export const deleteRegisteredWidget = (id: string): void => {
  widgets.delete(id)
}

export const deleteRegisteredWidgetsByThreadId = (threadId: string): void => {
  if (!threadId) return
  for (const [id, widget] of widgets.entries()) {
    if (widget.threadId === threadId) widgets.delete(id)
  }
}

export const setRegisteredWidgetInactive = (id: string, inactive: boolean): void => {
  const widget = widgets.get(id)
  if (!widget) return
  const now = Date.now()
  widget.lastAccessAt = now
  widget.inactiveSinceAt = inactive ? (widget.inactiveSinceAt ?? now) : null
}
