export type BottomScrollAnimation = {
  startTop: number
  targetTop: number
  startedAt: number
  durationMs: number
}

export const shouldFollowLayoutChangeToBottom = (input: { isPinnedToBottom: boolean }): boolean =>
  input.isPinnedToBottom

export const getBottomScrollDuration = (distancePx: number): number => {
  const distance = Math.abs(distancePx)
  if (distance <= 0) return 0
  return Math.round(Math.min(320, Math.max(140, 110 + distance * 0.35)))
}

export const createBottomScrollAnimation = (input: {
  startTop: number
  targetTop: number
  startedAt: number
}): BottomScrollAnimation => ({
  startTop: input.startTop,
  targetTop: input.targetTop,
  startedAt: input.startedAt,
  durationMs: getBottomScrollDuration(input.targetTop - input.startTop)
})

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

export const getBottomScrollFrame = (
  animation: BottomScrollAnimation,
  nowMs: number
): { top: number; done: boolean } => {
  if (animation.durationMs <= 0) {
    return { top: animation.targetTop, done: true }
  }

  const progress = Math.min(1, Math.max(0, (nowMs - animation.startedAt) / animation.durationMs))
  const eased = easeOutCubic(progress)
  const top = animation.startTop + (animation.targetTop - animation.startTop) * eased

  return {
    top: progress >= 1 ? animation.targetTop : top,
    done: progress >= 1
  }
}
