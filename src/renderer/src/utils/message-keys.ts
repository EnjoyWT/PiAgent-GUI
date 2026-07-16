import type { ChatMessage } from '../components/chat/types'

type MessageKeyFields = Pick<
  ChatMessage,
  | 'id'
  | 'agentRunId'
  | 'agentTurnId'
  | 'runtimeSequence'
  | 'createdAt'
  | 'role'
  | 'messageKind'
  | 'content'
>

const getMessageKind = (message: Pick<ChatMessage, 'messageKind'>): string =>
  message.messageKind ?? 'chat'

export const getMessageIdentityKey = (message: MessageKeyFields): string => {
  const kind = getMessageKind(message)

  if (message.agentRunId && message.agentTurnId) {
    return `turn:${message.role}:${kind}:${message.agentRunId}:${message.agentTurnId}`
  }
  if (message.agentRunId) {
    return `run:${message.role}:${kind}:${message.agentRunId}:${message.runtimeSequence ?? message.createdAt ?? ''}`
  }
  if (typeof message.runtimeSequence === 'number') {
    return `sequence:${message.role}:${kind}:${message.runtimeSequence}`
  }
  if (message.id) return `id:${message.id}`
  if (message.createdAt) return `time:${message.role}:${kind}:${message.createdAt}`
  return `fallback:${message.role}:${kind}:${message.content}`
}

export const getMessageRenderKey = (message: MessageKeyFields, index: number): string => {
  const base = getMessageIdentityKey(message)
  if (!base.startsWith('fallback:')) return base
  return `${base}:${index}`
}
