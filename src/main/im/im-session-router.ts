import type { ImChatKind, ImSessionScope } from './im-inbound-types.ts'

export type BuildImRoutingKeyInput = {
  transportId: string
  accountId: string
  chatId: string
  senderId: string
  threadId?: string | null
  scope: ImSessionScope
}

export type ResolveDefaultImSessionScopeInput = {
  chatKind: ImChatKind
  threadId?: string | null
}

const requiredPart = (value: string | null | undefined, name: string): string => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${name} is required`)
  return encodeURIComponent(normalized)
}

export const isSharedMultiUserScope = (scope: ImSessionScope): boolean =>
  scope === 'group_shared' || scope === 'thread_shared'

export const resolveDefaultImSessionScope = (
  input: ResolveDefaultImSessionScopeInput
): ImSessionScope => {
  if (input.threadId && String(input.threadId).trim()) return 'thread_shared'
  if (input.chatKind === 'dm') return 'dm'
  return 'group_per_member'
}

export const buildImRoutingKey = (input: BuildImRoutingKeyInput): string => {
  const transport = requiredPart(input.transportId, 'transportId')
  const account = requiredPart(input.accountId, 'accountId')
  const chat = requiredPart(input.chatId, 'chatId')
  const sender = requiredPart(input.senderId, 'senderId')

  if (input.scope === 'dm') {
    return ['im', transport, account, 'dm', chat].join(':')
  }

  if (input.scope === 'group_shared') {
    return ['im', transport, account, 'group', chat].join(':')
  }

  if (input.scope === 'group_per_member') {
    return ['im', transport, account, 'group', chat, 'user', sender].join(':')
  }

  const thread = requiredPart(input.threadId, 'threadId')
  if (input.scope === 'thread_shared') {
    return ['im', transport, account, 'thread', chat, 'thread', thread].join(':')
  }

  return ['im', transport, account, 'thread', chat, 'thread', thread, 'user', sender].join(':')
}
