import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type {
  ThreadPlanEvent,
  ThreadPlanItem,
  ThreadPlanItemStatus,
  ThreadPlanState,
  UpsertThreadPlanStateInput
} from '../../shared/thread-plan.ts'

type CreatePlanToolOptions = {
  threadId: string
  conversationId?: string | null
  getActiveRunId?: () => string | null
  getPlanState: () => ThreadPlanState | null
  upsertPlanState: (input: UpsertThreadPlanStateInput) => ThreadPlanState
  emitPlanEvent?: (event: ThreadPlanEvent) => void
}

type SetPlanToolAction = {
  items: ThreadPlanItem[]
}

type PlanToolResult = {
  status: 'updated' | 'closed'
  revision: number
  itemCount: number
}

const setPlanToolStatusValues = ['pending', 'inProgress', 'completed'] as const

const planItemSchema = Type.Object({
  id: Type.Optional(
    Type.String({
      description: 'Optional stable identifier for this item. Defaults to its 1-based position.'
    })
  ),
  step: Type.String({
    description: 'The todo item text shown to the user.'
  }),
  status: Type.String({
    enum: setPlanToolStatusValues,
    description:
      'The item status. Use completed for finished work, inProgress for the one current step, and pending for next work.'
  })
})

export const createPlanTools = ({
  threadId,
  conversationId,
  getActiveRunId,
  getPlanState,
  upsertPlanState,
  emitPlanEvent
}: CreatePlanToolOptions): ToolDefinition[] => [
  {
    name: 'setPlanTool',
    label: 'Set Plan Tool',
    description:
      'Set the current thread todo panel to the provided full ordered plan snapshot. At most one item may be inProgress.',
    parameters: Type.Object({
      explanation: Type.Optional(
        Type.String({
          description: 'Optional short reason for the plan update.'
        })
      ),
      plan: Type.Array(planItemSchema, {
        description: 'The complete ordered plan snapshot to display.'
      })
    }),
    execute: async (toolCallId, params) => {
      const action = normalizeSetPlanToolParams(params)
      const state = upsertPlanState({
        threadId,
        conversationId: conversationId ?? null,
        activeRunId: getActiveRunId?.() ?? null,
        sourceToolCallId: toolCallId,
        items: action.items,
        closed: false
      })
      emitPlanEvent?.({ type: 'set', state })

      return {
        content: [
          {
            type: 'text' as const,
            text: `Plan updated (${action.items.length} ${action.items.length === 1 ? 'item' : 'items'}).`
          }
        ],
        details: {
          status: 'updated',
          revision: state.revision,
          itemCount: state.items.length
        } satisfies PlanToolResult
      }
    }
  },
  {
    name: 'closePlanTool',
    label: 'Close Plan Tool',
    description: 'Close the current thread todo panel without clearing the last persisted snapshot.',
    parameters: Type.Object({}),
    execute: async (toolCallId) => {
      const existing = getPlanState()
      const state = upsertPlanState({
        threadId,
        conversationId: existing?.conversationId ?? conversationId ?? null,
        activeRunId: getActiveRunId?.() ?? existing?.activeRunId ?? null,
        sourceToolCallId: toolCallId,
        items: existing?.items ?? [],
        closed: true
      })
      emitPlanEvent?.({ type: 'set', state })

      return {
        content: [
          {
            type: 'text' as const,
            text: 'Plan panel closed.'
          }
        ],
        details: {
          status: 'closed',
          revision: state.revision,
          itemCount: state.items.length
        } satisfies PlanToolResult
      }
    }
  }
]

export const normalizeSetPlanToolParams = (params: unknown): SetPlanToolAction => {
  const rawParams = isRecord(params) ? params : {}
  const rawPlan = Array.isArray(rawParams.plan) ? rawParams.plan : []
  const items = rawPlan
    .map((value, index) => normalizePlanItem(value, index))
    .filter((item): item is ThreadPlanItem => Boolean(item))

  if (items.length === 0) {
    throw new Error('setPlanTool requires at least one plan item.')
  }

  const activeCount = items.filter((item) => item.status === 'in_progress').length
  if (activeCount > 1) {
    throw new Error('setPlanTool accepts at most one inProgress item.')
  }

  return { items }
}

const normalizePlanItem = (value: unknown, index: number): ThreadPlanItem | null => {
  if (!isRecord(value)) return null
  const rawText =
    typeof value.step === 'string'
      ? value.step
      : typeof value.text === 'string'
        ? value.text
        : ''
  const text = rawText.replace(/\r\n/g, '\n').trim()
  if (!text) return null

  const status = normalizePlanStatus(value.status)
  if (!status) {
    throw new Error(`Invalid setPlanTool status for item ${index + 1}.`)
  }

  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : String(index + 1)
  return { id, text, status }
}

const normalizePlanStatus = (value: unknown): ThreadPlanItemStatus | null => {
  if (typeof value !== 'string') return null
  if (value === 'inProgress') return 'in_progress'
  if (value === 'pending' || value === 'completed') return value
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
