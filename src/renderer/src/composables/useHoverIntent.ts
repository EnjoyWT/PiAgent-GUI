import { onBeforeUnmount } from 'vue'

type Timer = ReturnType<typeof setTimeout>

type HoverGroup = {
  opened: boolean
  activeId: string | null
  activeClose: (() => void) | null
  closeTimer: Timer | null
}

const groups = new Map<string, HoverGroup>()
let nextId = 0

const getGroup = (groupId: string): HoverGroup => {
  let group = groups.get(groupId)
  if (!group) {
    group = { opened: false, activeId: null, activeClose: null, closeTimer: null }
    groups.set(groupId, group)
  }
  return group
}

export const HOVER_OPEN_DELAY = 600
export const HOVER_CLOSE_DELAY = 200

type HoverIntent = {
  enter: () => void
  close: () => void
  cancel: () => void
  clearCloseTimer: () => void
}

export const useHoverIntent = ({
  groupId,
  onOpen,
  onClose,
  openDelay = HOVER_OPEN_DELAY,
  closeDelay = HOVER_CLOSE_DELAY
}: {
  groupId: string
  onOpen: () => void
  onClose: () => void
  openDelay?: number
  closeDelay?: number
}): HoverIntent => {
  const group = getGroup(groupId)
  const itemId = `${groupId}-${++nextId}`
  let openTimer: Timer | null = null

  const clearOpenTimer = (): void => {
    if (openTimer) {
      clearTimeout(openTimer)
      openTimer = null
    }
  }

  const clearCloseTimer = (): void => {
    if (group.closeTimer) {
      clearTimeout(group.closeTimer)
      group.closeTimer = null
    }
  }

  const open = (): void => {
    clearOpenTimer()
    clearCloseTimer()
    group.opened = true
    if (group.activeId !== itemId) {
      group.activeClose?.()
    }
    group.activeId = itemId
    group.activeClose = onClose
    onOpen()
  }

  const enter = (): void => {
    clearCloseTimer()

    // Once a member of the group is open, sibling members switch instantly.
    if (group.opened || group.activeId !== null) {
      open()
      return
    }

    clearOpenTimer()
    openTimer = setTimeout(open, openDelay)
  }

  const close = (): void => {
    clearOpenTimer()
    clearCloseTimer()
    group.closeTimer = setTimeout(() => {
      group.closeTimer = null
      if (group.activeId === itemId) {
        group.activeId = null
        group.activeClose = null
        group.opened = false
        onClose()
      }
    }, closeDelay)
  }

  const cancel = (): void => {
    clearOpenTimer()
    clearCloseTimer()
  }

  onBeforeUnmount(() => {
    clearOpenTimer()
    if (group.activeId === itemId) {
      group.activeId = null
      group.activeClose = null
    }
    if (!group.activeId && !group.closeTimer) {
      groups.delete(groupId)
    }
  })

  return {
    enter,
    close,
    cancel,
    clearCloseTimer
  }
}
