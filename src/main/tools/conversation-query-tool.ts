import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type { ConversationMessage, CoreQueryService } from '../core-v2/domain.ts'

type ConversationQueryToolOptions = {
  coreQueryService: CoreQueryService
}

type ConversationQueryAction =
  | 'list_conversations'
  | 'get_messages'
  | 'list_all_messages'
  | 'search_messages'

type ConversationQueryActionInput = {
  action?: string
  conversationId?: string
  query?: string
  sourceKind?: string
  role?: string
  dateAfter?: string
  dateBefore?: string
  limit?: number
  offset?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sanitizeRole = (value: string): ConversationMessage['role'] | null => {
  if (value === 'user' || value === 'assistant' || value === 'tool' || value === 'system') return value
  return null
}

const sanitizeSearchRole = (value: string): 'user' | 'assistant' | 'tool' | null => {
  if (value === 'user' || value === 'assistant' || value === 'tool') return value
  return null
}

const sanitizeSourceKind = (value: string): 'local' | 'im' | 'all' | null => {
  if (value === 'local' || value === 'im' || value === 'all') return value
  return null
}

const resolveAction = (value: string | undefined): ConversationQueryAction | null => {
  const normalized = String(value ?? '').trim().replace(/\s+/g, '_').toLowerCase()
  const valid: ConversationQueryAction[] = ['list_conversations', 'get_messages', 'list_all_messages', 'search_messages']
  return valid.includes(normalized as ConversationQueryAction) ? (normalized as ConversationQueryAction) : null
}

const clampLimit = (value: unknown, max: number, fallback: number): number => {
  const n = Math.trunc(Number(value ?? 0)) || 0
  return Math.max(1, Math.min(n, max)) || fallback
}

export const createConversationQueryTool = ({ coreQueryService }: ConversationQueryToolOptions): ToolDefinition => ({
  name: 'conversationQueryTool',
  label: 'Conversation Query Tool',
  description:
    'Query conversations and messages from the PiAgent database. Supports paginated listing of conversations, reading message history for a specific conversation, searching all messages across conversations with FTS, and listing messages with date/role filters.',
  parameters: Type.Object(
    {
      action: Type.Optional(
        Type.String({
          description: 'Action to perform: list_conversations, get_messages, list_all_messages, search_messages.'
        })
      ),
      conversationId: Type.Optional(
        Type.String({
          description: 'Conversation ID. Required for get_messages.'
        })
      ),
      query: Type.Optional(
        Type.String({
          description: 'Search text for list_conversations (title/ID match) or search_messages (FTS full-text search).'
        })
      ),
      sourceKind: Type.Optional(
        Type.String({
          description: 'Filter conversations by source: "local", "im", or "all". Used by list_conversations.'
        })
      ),
      role: Type.Optional(
        Type.String({
          description: 'Filter messages by role: "user", "assistant", "tool", "system".'
        })
      ),
      dateAfter: Type.Optional(
        Type.String({
          description: 'ISO date or "YYYY-MM-DD" string. Only return records created at or after this time.'
        })
      ),
      dateBefore: Type.Optional(
        Type.String({
          description: 'ISO date or "YYYY-MM-DD" string. Only return records created before or at this time.'
        })
      ),
      limit: Type.Optional(
        Type.Integer({
          description: 'Maximum number of items to return. Default varies by action, max 200.'
        })
      ),
      offset: Type.Optional(
        Type.Integer({
          description: 'Number of items to skip for pagination. Default 0.'
        })
      )
    },
    { additionalProperties: false }
  ),
  execute: async (_toolCallId, params) => {
    const input = isRecord(params) ? (params as ConversationQueryActionInput) : {}
    const actionStr = String(input.action ?? '').trim()
    const action = resolveAction(actionStr)

    if (!action) {
      return {
        content: [{ type: 'text', text: `Missing or invalid action. Valid actions: list_conversations, get_messages, list_all_messages, search_messages.` }],
        details: { action: null }
      }
    }

    const limit = clampLimit(input.limit, 200, 50)
    const offset = Math.max(0, Math.trunc(Number(input.offset ?? 0)) || 0)
    const query = String(input.query ?? '').trim()
    const sourceKind = sanitizeSourceKind(String(input.sourceKind ?? '').trim()) || 'all'
    const role = sanitizeRole(String(input.role ?? '').trim()) || undefined
    const searchRole = sanitizeSearchRole(String(input.role ?? '').trim()) || undefined
    const conversationId = String(input.conversationId ?? '').trim() || undefined
    const dateAfter = String(input.dateAfter ?? '').trim() || undefined
    const dateBefore = String(input.dateBefore ?? '').trim() || undefined

    try {
      // --- list_conversations ---
      if (action === 'list_conversations') {
        const result = coreQueryService.listConversations({
          sourceKind: sourceKind as 'local' | 'im' | 'all',
          dateAfter: dateAfter || undefined,
          dateBefore: dateBefore || undefined,
          query: query || undefined,
          limit: limit || 20,
          offset
        })

        const text = result.items.length === 0
          ? '没有找到对话。'
          : [
              `已返回 ${result.items.length} / ${result.total} 条对话（offset=${offset}）：`,
              ...result.items.map((item) => {
                const title = item.title ? `"${item.title}"` : '(无标题)'
                return `- [${item.sourceKind}] ${title} | id=${item.conversationId} | 消息=${item.messageCount} | 更新=${item.updatedAt}`
              })
            ].join('\n')

        return {
          content: [{ type: 'text', text }],
          details: {
            action: 'list_conversations',
            total: result.total,
            limit: result.limit,
            offset: result.offset,
            hasMore: result.hasMore,
            items: result.items.map((item) => ({
              conversationId: item.conversationId,
              title: item.title,
              sourceKind: item.sourceKind,
              lastMessageAt: item.lastMessageAt,
              updatedAt: item.updatedAt,
              status: item.status
            }))
          }
        }
      }

      // --- get_messages ---
      if (action === 'get_messages') {
        if (!conversationId) {
          return {
            content: [{ type: 'text', text: 'get_messages requires conversationId.' }],
            details: { action: 'get_messages', error: 'missing_conversation_id' }
          }
        }

        const result = coreQueryService.listConversationMessages({
          conversationId,
          dateAfter: dateAfter || undefined,
          dateBefore: dateBefore || undefined,
          role: role || undefined,
          limit: limit || 50,
          offset
        })

        const text = result.items.length === 0
          ? `对话 ${conversationId} 没有找到消息。`
          : [
              `已返回对话 ${conversationId} 的 ${result.items.length} / ${result.total} 条消息（offset=${offset}）：`,
              ...result.items.map((item) => {
                const truncated = item.text ? item.text.slice(0, 200).replace(/\n/g, ' ') : '(空)'
                return `- [${item.role}] ${item.createdAt} | ${truncated}`
              })
            ].join('\n')

        return {
          content: [{ type: 'text', text }],
          details: {
            action: 'get_messages',
            conversationId,
            total: result.total,
            limit: result.limit,
            offset: result.offset,
            hasMore: result.hasMore,
            items: result.items.map((item) => ({
              messageId: item.messageId,
              role: item.role,
              text: item.text,
              createdAt: item.createdAt
            }))
          }
        }
      }

      // --- list_all_messages ---
      if (action === 'list_all_messages') {
        const result = coreQueryService.listAllConversationMessages({
          conversationId: conversationId || undefined,
          dateAfter: dateAfter || undefined,
          dateBefore: dateBefore || undefined,
          role: role || undefined,
          limit: limit || 50,
          offset
        })

        const text = result.items.length === 0
          ? '没有找到消息。'
          : [
              `已返回 ${result.items.length} / ${result.total} 条消息（offset=${offset}）：`,
              ...result.items.map((item) => {
                const conv = item.conversationTitle ? `"${item.conversationTitle}"` : '(未知对话)'
                const truncated = item.text ? item.text.slice(0, 180).replace(/\n/g, ' ') : '(空)'
                return `- [${item.role}] ${item.createdAt} | ${conv} | ${truncated}`
              })
            ].join('\n')

        return {
          content: [{ type: 'text', text }],
          details: {
            action: 'list_all_messages',
            total: result.total,
            limit: result.limit,
            offset: result.offset,
            hasMore: result.hasMore,
            items: result.items.map((item) => ({
              messageId: item.messageId,
              conversationId: item.conversationId,
              conversationTitle: item.conversationTitle,
              role: item.role,
              text: item.text,
              createdAt: item.createdAt
            }))
          }
        }
      }

      // --- search_messages ---
      if (action === 'search_messages') {
        if (!query) {
          return {
            content: [{ type: 'text', text: 'search_messages requires query.' }],
            details: { action: 'search_messages', error: 'missing_query' }
          }
        }

        const result = coreQueryService.searchConversationMessages({
          query,
          conversationId: conversationId || undefined,
          limit: limit || 50,
          offset,
          roles: searchRole ? [searchRole] : undefined
        })

        const text = result.items.length === 0
          ? `没有找到匹配 "${query}" 的消息。`
          : [
              `已返回 ${result.items.length} / ${result.total} 条匹配 "${query}" 的消息（offset=${offset}）：`,
              ...result.items.map((item) => {
                const conv = item.title ? `"${item.title}"` : '(未知对话)'
                return `- [${item.role}] ${item.createdAt} | ${conv} | ${item.snippet}`
              })
            ].join('\n')

        return {
          content: [{ type: 'text', text }],
          details: {
            action: 'search_messages',
            query,
            total: result.total,
            limit: result.limit,
            offset: result.offset,
            hasMore: result.hasMore,
            items: result.items.map((item) => ({
              messageId: item.messageId,
              conversationId: item.conversationId,
              role: item.role,
              text: item.text,
              snippet: item.snippet,
              createdAt: item.createdAt,
              rank: item.rank
            }))
          }
        }
      }

      // Fallback
      return {
        content: [{ type: 'text', text: 'Unexpected state.' }],
        details: { action }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'conversation query failed unexpectedly.'
      return {
        content: [{ type: 'text', text: message }],
        details: { action, error: true }
      }
    }
  }
})
