import type { AgentRun, AgentTurn, ChatMessage } from '../components/chat/types'

const THINKING_PLACEHOLDER_TEXTS = new Set(['', '思考中', '思考中...'])

const getRunTurnById = (
  run: AgentRun | null | undefined,
  agentTurnId: string | null | undefined
): AgentTurn | null => {
  if (!run || !agentTurnId) return null
  return run.turns.find((turn) => turn.id === agentTurnId) ?? null
}

const turnHasVisibleAssistantOutput = (turn: AgentTurn): boolean =>
  turn.toolCalls.length > 0 ||
  turn.timelineItems.some(
    (item) =>
      item.kind === 'tool' ||
      item.kind === 'question_answer' ||
      (item.kind === 'thinking' && item.thinking.trim().length > 0) ||
      (item.kind === 'text' && item.text.trim().length > 0)
  )

const runHasVisibleAssistantOutput = (run: AgentRun | null | undefined): boolean =>
  Boolean(
    run &&
    (run.text.trim().length > 0 || run.turns.some((turn) => turnHasVisibleAssistantOutput(turn)))
  )

const isOptimisticAssistantPlaceholder = (message: ChatMessage): boolean => {
  const trimmed = message.content.trim()
  return (
    message.role === 'assistant' &&
    message.isPending === true &&
    !message.id &&
    !message.agentRunId &&
    !message.agentTurnId &&
    !message.run &&
    !message.widget &&
    !(message.blocks?.length ?? 0) &&
    THINKING_PLACEHOLDER_TEXTS.has(trimmed)
  )
}

const messageHasVisibleAssistantOutput = (message: ChatMessage): boolean => {
  if (message.role !== 'assistant') return false
  if (message.widget) return true
  if ((message.blocks?.length ?? 0) > 0) return true

  const trimmed = message.content.trim()
  if (trimmed && !THINKING_PLACEHOLDER_TEXTS.has(trimmed)) return true

  const turn = getRunTurnById(message.run, message.agentTurnId)
  if (turn && turnHasVisibleAssistantOutput(turn)) return true
  return !turn && runHasVisibleAssistantOutput(message.run)
}

const messageReplacesOptimisticAssistantPlaceholder = (message: ChatMessage): boolean =>
  messageHasVisibleAssistantOutput(message) ||
  Boolean(
    message.role === 'assistant' &&
    message.isPending === true &&
    (message.agentRunId || message.agentTurnId || message.run)
  )

export const removeOptimisticAssistantPlaceholders = (list: ChatMessage[]): boolean => {
  let removed = false
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (!isOptimisticAssistantPlaceholder(list[index])) continue
    list.splice(index, 1)
    removed = true
  }
  return removed
}

export const pruneStalePendingAssistantMessages = (list: ChatMessage[]): boolean => {
  let removed = false
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    if (!isOptimisticAssistantPlaceholder(message)) continue
    if (!list.slice(index + 1).some(messageReplacesOptimisticAssistantPlaceholder)) continue
    list.splice(index, 1)
    removed = true
  }
  return removed
}
