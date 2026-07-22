import { createTwoFilesPatch } from 'diff'
import type {
  AgentRun,
  AgentToolCall,
  AgentTurn,
  AgentTurnTimelineItem,
  ChatToolStep,
  ChatWidget
} from './types'
import type { ChatToolImageProjection } from '@shared/agent-runtime'

type JsonRecord = Record<string, unknown>

export type FlowFileChangeEntry = {
  id: string
  path: string
  fileName: string
  action: 'edit' | 'write'
  actionLabel: '已编辑' | '已创建'
  diff?: string
  addedLines?: number
  removedLines?: number
}

export type ThinkingRenderBlock = {
  kind: 'thinking'
  id: string
  turnId?: string
  turnIndex?: number
  thinking: string
  startedAt: number
  endedAt?: number
  isActive: boolean
  autoCollapse: boolean
}

export type TextRenderBlock = {
  kind: 'text'
  id: string
  turnId?: string
  turnIndex?: number
  text: string
  isActive?: boolean
}

export type RunFinalTextRenderBlock = {
  kind: 'run_final_text'
  id: string
  text: string
}

export type ToolRenderBlock = {
  kind: 'tool'
  id: string
  turnId?: string
  turnIndex?: number
  step: ChatToolStep
  isActive?: boolean
}

export type QuestionAnswerRenderBlock = {
  kind: 'question_answer'
  id: string
  turnId?: string
  turnIndex?: number
  toolCallId: string
  text: string
  isActive?: boolean
}

export type QuestionnaireQuestionRenderBlock = {
  kind: 'questionnaire_question'
  id: string
  turnId?: string
  turnIndex?: number
  toolCallId: string
  stepIndex: number
  text: string
  isActive?: boolean
}

export type QuestionnaireAnswerRenderBlock = {
  kind: 'questionnaire_answer'
  id: string
  turnId?: string
  turnIndex?: number
  toolCallId: string
  stepIndex: number
  text: string
  isActive?: boolean
}

export type FileRenderBlock = {
  kind: 'file'
  id: string
  turnId?: string
  turnIndex?: number
  step: ChatToolStep
  entry: FlowFileChangeEntry
  isActive?: boolean
}

export type WidgetRenderBlock = {
  kind: 'widget'
  id: string
  turnId?: string
  turnIndex?: number
  widget: ChatWidget
  isActive?: boolean
}

export type TurnErrorRenderBlock = {
  kind: 'turn_error'
  id: string
  turnId?: string
  turnIndex?: number
  errorMessage?: string
  isActive?: boolean
}

export type QuestionPromptRenderBlock = {
  kind: 'question_prompt'
  id: string
  turnId?: string
  turnIndex?: number
  prompt: string
  step: ChatToolStep
  isActive?: boolean
}

export type TransportSetupQrRenderBlock = {
  kind: 'transport_setup_qr'
  id: string
  turnId?: string
  turnIndex?: number
  qr: NonNullable<ChatToolStep['accountSetupQr']>
  step: ChatToolStep
  isActive?: boolean
}

export type ToolImageRenderBlock = {
  kind: 'tool_image'
  id: string
  turnId?: string
  turnIndex?: number
  image: ChatToolImageProjection
  step: ChatToolStep
  isActive?: boolean
}

export type MessageRenderBlock =
  | ThinkingRenderBlock
  | TextRenderBlock
  | RunFinalTextRenderBlock
  | ToolRenderBlock
  | QuestionAnswerRenderBlock
  | QuestionnaireQuestionRenderBlock
  | QuestionnaireAnswerRenderBlock
  | FileRenderBlock
  | WidgetRenderBlock
  | TurnErrorRenderBlock
  | QuestionPromptRenderBlock
  | TransportSetupQrRenderBlock
  | ToolImageRenderBlock

export type MessageRenderMeta = {
  toolTypeCount: number
  skillNames: string[]
  toolNamesTooltip: string
  skillNamesTooltip: string
  showThinkingPlaceholder: boolean
}

export type MessageRenderFlow = {
  blocks: MessageRenderBlock[]
  meta: MessageRenderMeta
}

const blockHasVisibleContent = (block: MessageRenderBlock): boolean => {
  if (block.kind !== 'thinking') return true
  return Boolean(block.thinking.trim())
}

const asRecord = (value: unknown): JsonRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const normalizeToolName = (name: string): string => (name || '').trim().toLowerCase()

const basenameLike = (filePath: string): string => {
  const normalized = (filePath || '').replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized || 'file'
}

const getStringArg = (args: unknown, key: string): string => {
  const record = asRecord(args)
  const value = record?.[key]
  return typeof value === 'string' ? value : ''
}

const toToolStep = (call: AgentToolCall): ChatToolStep => ({
  id: call.id,
  toolName: call.name,
  toolKind: call.kind,
  invocation: call.invocation,
  skillName: call.skillName,
  status: call.status,
  args: call.args,
  summary: call.summary,
  accountSetupQr: call.accountSetupQr,
  toolImages: call.toolImages,
  startedAt: call.startedAt,
  endedAt: call.endedAt,
  durationMs: call.durationMs,
  fileChanges: call.fileChanges
})

const makeCreatedFileDiff = (filePath: string, content: string): string => {
  const normalized = content.replace(/\r\n/g, '\n')
  const patch = createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, '', normalized, '', '', {
    context: 3
  })
  return patch.trimEnd()
}

const buildFileChangeEntries = (toolSteps: ChatToolStep[]): FlowFileChangeEntry[] => {
  const entries: FlowFileChangeEntry[] = []
  for (const step of toolSteps) {
    const tool = normalizeToolName(step.toolName)
    if (tool !== 'edit' && tool !== 'write') continue

    const pathArg = (getStringArg(step.args, 'path') || getStringArg(step.args, 'filePath')).trim()
    const fallbackPath = String(step.fileChanges?.[0]?.path ?? '').trim()
    const path = pathArg || fallbackPath
    if (!path) continue

    const action: FlowFileChangeEntry['action'] = tool === 'edit' ? 'edit' : 'write'
    const actionLabel: FlowFileChangeEntry['actionLabel'] = action === 'edit' ? '已编辑' : '已创建'

    const change =
      (step.fileChanges ?? []).find((item) => String(item.path ?? '').trim() === path) ??
      step.fileChanges?.[0]
    const contentArg = getStringArg(step.args, 'content')
    const fallbackDiff =
      action === 'write' && contentArg && !change?.diff
        ? makeCreatedFileDiff(path, contentArg)
        : undefined

    entries.push({
      id: step.id,
      path,
      fileName: basenameLike(path),
      action,
      actionLabel,
      diff: change?.diff || fallbackDiff,
      addedLines:
        typeof change?.addedLines === 'number'
          ? change.addedLines
          : action === 'write' && contentArg
            ? contentArg.replace(/\r\n/g, '\n').split('\n').length
            : undefined,
      removedLines: change?.removedLines
    })
  }
  return entries
}

const getTurnTimelineItems = (turn: AgentTurn): AgentTurnTimelineItem[] => {
  if (turn.timelineItems.length > 0) return turn.timelineItems

  const items: AgentTurnTimelineItem[] = []
  if (turn.text.trim()) {
    items.push({
      id: `text:legacy:${turn.id ?? turn.index}`,
      kind: 'text',
      text: turn.text,
      startedAt: turn.startedAt ?? 0,
      endedAt: turn.endedAt
    })
  }
  for (const call of turn.toolCalls) {
    items.push({
      id: `tool:${call.id}`,
      kind: 'tool',
      toolCallId: call.id
    })
  }
  return items
}

const getFirstToolTimelineIndex = (timeline: AgentTurnTimelineItem[]): number =>
  timeline.findIndex((item) => item.kind === 'tool')

const isPrefaceTextTimelineItem = (
  timeline: AgentTurnTimelineItem[],
  itemIndex: number
): boolean => {
  const firstToolIndex = getFirstToolTimelineIndex(timeline)
  return firstToolIndex > 0 && itemIndex < firstToolIndex
}

const isDuplicateFileToolStep = (step: ChatToolStep, filePaths: Set<string>): boolean => {
  const tool = normalizeToolName(step.toolName)
  if (tool !== 'write' && tool !== 'edit') return false

  const args = asRecord(step.args)
  const argPath = (getStringArg(args, 'path') || getStringArg(args, 'filePath')).trim()
  const changePath = String(step.fileChanges?.[0]?.path ?? '').trim()
  if (argPath || changePath) return false

  const output = String(step.summary ?? '').trim()
  const match = /\bto\s+([^\s]+)\s*$/i.exec(output.replace(/\n/g, ' ').trim())
  const pathFromOutput = (match?.[1] ?? '').trim()
  if (!pathFromOutput) return false
  return filePaths.has(pathFromOutput)
}

const resolveWidgetFromToolStep = (step: ChatToolStep): ChatWidget | null => {
  const summary = String(step.summary ?? '').trim()
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
            { showHeader?: boolean; fullWidth?: boolean } | undefined
        }
      }
    } catch {
      // Fall through to args-based recovery.
    }
  }

  const args = asRecord(step.args)
  if (!args) return null
  const placement = 'inline'
  const title = asString(args.title) || undefined
  const config = asRecord(args.config) as { showHeader?: boolean; fullWidth?: boolean } | undefined
  const type = asString(args.type)
  const html = asString(args.html).trim()

  if (type === 'html' && html) return { kind: 'html', placement, html, title, config }

  return null
}

const shouldRenderTransportSetupQr = (step: ChatToolStep): boolean =>
  normalizeToolName(step.toolName) === 'imtool' && Boolean(step.accountSetupQr?.imageUrl)

const collapseTextBlankLines = (text: string): string =>
  text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const sanitizeTransportSetupQrText = (text: string, steps: ChatToolStep[]): string => {
  const qrSteps = steps.filter((step) => shouldRenderTransportSetupQr(step))
  if (qrSteps.length === 0) return text

  const knownQrUrls = qrSteps
    .map((step) => step.accountSetupQr?.imageUrl)
    .filter((value): value is string => Boolean(value && value.trim()))

  const sanitized = text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (knownQrUrls.some((url) => trimmed.includes(url))) return false
      if (/!\[[^\]]*(qr|二维码|wechat|微信)[^\]]*\]\([^)]+\)/i.test(trimmed)) return false
      if (/\bQR code link\s*:/i.test(trimmed) || /\bQR text\s*:/i.test(trimmed)) return false
      if (/(有效期|过期时间|expires?\s+at|expiry)/i.test(trimmed)) return false
      if (/登录链接/.test(trimmed) && /https?:\/\//i.test(trimmed)) return false
      return true
    })
    .join('\n')

  return collapseTextBlankLines(sanitized)
}

const buildToolMeta = (toolSteps: ChatToolStep[]) => {
  const toolNames = new Set<string>()
  const skillNames = new Set<string>()

  for (const call of toolSteps) {
    const name = (call.toolName || '').trim()
    if (call.toolKind === 'tool' && call.invocation === 'direct' && name) toolNames.add(name)
    if (call.invocation === 'skill') {
      const skillName = (call.skillName || '').trim()
      if (skillName) skillNames.add(skillName)
    }
  }

  const terminalTools = new Set(['bash', 'ls', 'grep', 'find'])
  const grouped = new Map<string, string[]>()
  for (const rawName of toolNames) {
    const name = rawName.trim()
    if (!name) continue
    const category = terminalTools.has(name.toLowerCase()) ? 'bash' : name
    const list = grouped.get(category) ?? []
    if (!list.includes(name)) list.push(name)
    grouped.set(category, list)
  }

  const toolNamesTooltip =
    grouped.size === 0
      ? '暂无工具明细'
      : '使用工具：\n' +
        Array.from(grouped.entries())
          .map(([category, list]) => {
            const sorted = [...list].sort((a, b) => a.localeCompare(b))
            if (sorted.length === 1 && sorted[0].toLowerCase() === category.toLowerCase()) {
              return category
            }
            return `${category}: ${sorted.join(', ')}`
          })
          .sort((a, b) => a.localeCompare(b))
          .map((line) => `• ${line}`)
          .join('\n')

  const sortedSkillNames = Array.from(skillNames).sort((a, b) => a.localeCompare(b))
  const skillNamesTooltip =
    sortedSkillNames.length === 0
      ? '暂无技能明细'
      : '使用技能：\n' + sortedSkillNames.map((name) => `• ${name}`).join('\n')

  return {
    toolTypeCount: new Set(
      Array.from(toolNames)
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean)
    ).size,
    skillNames: sortedSkillNames,
    toolNamesTooltip,
    skillNamesTooltip
  }
}

export const buildMessageRenderFlow = (params: {
  run: AgentRun
  turns?: AgentTurn[]
  messageWidget?: ChatWidget
  includeMessageWidget?: boolean
  includeRunFinalText?: boolean
}): MessageRenderFlow => {
  const {
    run,
    turns = run.turns,
    messageWidget,
    includeMessageWidget = true,
    includeRunFinalText = false
  } = params
  const toolSteps = turns.flatMap((turn) => turn.toolCalls).map((call) => toToolStep(call))
  const fileChangeEntries = buildFileChangeEntries(toolSteps)
  const fileById = new Map(fileChangeEntries.map((entry) => [entry.id, entry]))
  const filePaths = new Set(fileChangeEntries.map((entry) => entry.path))
  const toolMeta = buildToolMeta(toolSteps)
  const widgetToolIds = turns
    .flatMap((turn) => turn.toolCalls)
    .filter((tool) => normalizeToolName(tool.name) === 'widgetrenderer')
    .map((tool) => tool.id)
  const overrideWidget =
    includeMessageWidget && messageWidget && messageWidget.placement === 'inline'
      ? messageWidget
      : null
  const overrideWidgetToolId = overrideWidget ? (widgetToolIds.at(-1) ?? null) : null

  const blocks: MessageRenderBlock[] = []

  for (const turn of turns) {
    const timeline = getTurnTimelineItems(turn)
    const stepsByToolCallId = new Map(turn.toolCalls.map((call) => [call.id, toToolStep(call)]))
    const turnToolSteps = Array.from(stepsByToolCallId.values())
    let pendingTransportSetupQr: Extract<
      MessageRenderBlock,
      { kind: 'transport_setup_qr' }
    > | null = null
    let pendingTransportSetupQrToolCallId: string | null = null
    let pendingTransportSetupQrEndedAt: number | null = null

    const flushPendingTransportSetupQr = (): void => {
      if (!pendingTransportSetupQr) return
      blocks.push(pendingTransportSetupQr)
      pendingTransportSetupQr = null
      pendingTransportSetupQrToolCallId = null
      pendingTransportSetupQrEndedAt = null
    }

    const isPendingQrAnswerItem = (item: AgentTurnTimelineItem): boolean =>
      Boolean(
        pendingTransportSetupQrToolCallId &&
        (item.kind === 'question_answer' ||
          item.kind === 'questionnaire_question' ||
          item.kind === 'questionnaire_answer') &&
        (item.toolCallId === pendingTransportSetupQrToolCallId ||
          (pendingTransportSetupQrEndedAt != null &&
            item.startedAt <= pendingTransportSetupQrEndedAt))
      )

    for (let itemIndex = 0; itemIndex < timeline.length; itemIndex += 1) {
      const timelineItem = timeline[itemIndex]
      if (!isPendingQrAnswerItem(timelineItem)) flushPendingTransportSetupQr()

      if (timelineItem.kind === 'thinking') {
        blocks.push({
          kind: 'thinking',
          id: timelineItem.id,
          turnId: turn.id,
          turnIndex: turn.index,
          thinking: timelineItem.thinking,
          startedAt: timelineItem.startedAt,
          endedAt: timelineItem.endedAt,
          isActive: false,
          autoCollapse: false
        })
        continue
      }

      if (timelineItem.kind === 'text') {
        const rawText = sanitizeTransportSetupQrText(timelineItem.text, turnToolSteps)
        const isInterruptedPartial =
          turn.terminationReason === 'error' && !isPrefaceTextTimelineItem(timeline, itemIndex)
        if (!rawText.trim() || isInterruptedPartial) continue
        blocks.push({
          kind: 'text',
          id: timelineItem.id,
          turnId: turn.id,
          turnIndex: turn.index,
          text: rawText
        })
        continue
      }

      if (timelineItem.kind === 'question_answer') {
        if (!timelineItem.text.trim()) continue
        blocks.push({
          kind: 'question_answer',
          id: timelineItem.id,
          turnId: turn.id,
          turnIndex: turn.index,
          toolCallId: timelineItem.toolCallId,
          text: timelineItem.text
        })
        continue
      }

      if (timelineItem.kind === 'questionnaire_question') {
        if (!timelineItem.text.trim()) continue
        blocks.push({
          kind: 'questionnaire_question',
          id: timelineItem.id,
          turnId: turn.id,
          turnIndex: turn.index,
          toolCallId: timelineItem.toolCallId,
          stepIndex: timelineItem.stepIndex,
          text: timelineItem.text
        })
        continue
      }

      if (timelineItem.kind === 'questionnaire_answer') {
        if (!timelineItem.text.trim()) continue
        blocks.push({
          kind: 'questionnaire_answer',
          id: timelineItem.id,
          turnId: turn.id,
          turnIndex: turn.index,
          toolCallId: timelineItem.toolCallId,
          stepIndex: timelineItem.stepIndex,
          text: timelineItem.text
        })
        continue
      }

      const step = stepsByToolCallId.get(timelineItem.toolCallId)
      if (!step || isDuplicateFileToolStep(step, filePaths)) continue

      if (normalizeToolName(step.toolName) === 'questiontool') {
        const rawArgs = asRecord(step.args) ?? {}
        const promptText = asString(rawArgs.prompt)
        if (promptText) {
          blocks.push({
            kind: 'question_prompt',
            id: `question-prompt:${step.id}`,
            turnId: turn.id,
            turnIndex: turn.index,
            prompt: promptText,
            step
          })
          continue
        }
      }

      if (shouldRenderTransportSetupQr(step) && step.accountSetupQr) {
        blocks.push({
          kind: 'tool',
          id: `tool:${step.id}`,
          turnId: turn.id,
          turnIndex: turn.index,
          step
        })
        pendingTransportSetupQr = {
          kind: 'transport_setup_qr',
          id: `transport-setup-qr:${step.id}`,
          turnId: turn.id,
          turnIndex: turn.index,
          step,
          qr: step.accountSetupQr
        }
        pendingTransportSetupQrToolCallId = timelineItem.toolCallId
        pendingTransportSetupQrEndedAt = step.endedAt ?? null
        continue
      }

      const entry = fileById.get(step.id)
      blocks.push(
        entry
          ? {
              kind: 'file',
              id: `file:${step.id}`,
              turnId: turn.id,
              turnIndex: turn.index,
              step,
              entry
            }
          : {
              kind: 'tool',
              id: `tool:${step.id}`,
              turnId: turn.id,
              turnIndex: turn.index,
              step
            }
      )

      for (const image of step.toolImages ?? []) {
        blocks.push({
          kind: 'tool_image',
          id: `tool-image:${step.id}:${image.url}`,
          turnId: turn.id,
          turnIndex: turn.index,
          step,
          image
        })
      }

      if (normalizeToolName(step.toolName) !== 'widgetrenderer') continue
      const widget =
        step.id === overrideWidgetToolId && overrideWidget
          ? overrideWidget
          : resolveWidgetFromToolStep(step)
      if (!widget || widget.placement !== 'inline') continue
      blocks.push({
        kind: 'widget',
        id: `widget:${step.id}`,
        turnId: turn.id,
        turnIndex: turn.index,
        widget
      })
    }

    flushPendingTransportSetupQr()

    if (turn.terminationReason === 'error') {
      blocks.push({
        kind: 'turn_error',
        id: `turn-error:${turn.id ?? turn.index}`,
        turnId: turn.id,
        turnIndex: turn.index,
        errorMessage: turn.errorMessage
      })
    }
  }

  // `run.text` is updated by every text delta while a run is streaming, so it is not a
  // final-answer signal until the run reaches a terminal state. On completion it usually
  // equals the final turn's text item: promote that existing item instead of appending a
  // duplicate final block. If it differs, it is a genuinely separate run-level answer.
  if (includeRunFinalText && run.status !== 'running' && run.text.trim()) {
    const finalText = run.text.trim()
    const matchingTextBlockIndex = blocks.findLastIndex(
      (block) => block.kind === 'text' && block.text.trim() === finalText
    )

    if (matchingTextBlockIndex >= 0) {
      const matchingTextBlock = blocks[matchingTextBlockIndex] as TextRenderBlock
      blocks[matchingTextBlockIndex] = {
        kind: 'run_final_text',
        id: matchingTextBlock.id,
        text: run.text
      }
    } else {
      blocks.push({
        kind: 'run_final_text',
        id: `run-final-text:${run.id}`,
        text: run.text
      })
    }
  }

  // 当 run 已终止（非 running）且没有任何 block 时，生成一个回退 block，
  // 防止 UI 中出现空白的 assistant 消息气泡。
  if (blocks.length === 0 && run.status !== 'running') {
    const terminationKind = run.termination?.kind
    if (terminationKind === 'error') {
      blocks.push({
        kind: 'turn_error',
        id: `run-error:${run.id}`,
        errorMessage: run.termination?.message || '请求失败'
      })
    } else if (terminationKind === 'aborted') {
      blocks.push({
        kind: 'turn_error',
        id: `run-aborted:${run.id}`,
        errorMessage: '请求已中止'
      })
    }
  }

  const normalizedBlocks = blocks.filter((block, index, list) => {
    if (block.kind !== 'thinking' || block.thinking.trim()) return true
    return !list.slice(index + 1).some(blockHasVisibleContent)
  })

  const currentTurn = [...turns].reverse().find((t) => t.status === 'running') ?? null

  const belongsToTurn = (block: MessageRenderBlock, turn: AgentTurn | null): boolean =>
    block.kind !== 'run_final_text' &&
    Boolean(
      turn && (block.turnId === turn.id || (block.turnId == null && block.turnIndex === turn.index))
    )

  const currentTurnBlocks = currentTurn
    ? normalizedBlocks.filter((block) => belongsToTurn(block, currentTurn))
    : []

  const lastCurrentTurnBlock = currentTurnBlocks.at(-1) ?? null

  normalizedBlocks.forEach((block, index) => {
    const isRunActive = run.status === 'running'
    const isCurrentTurnBlock = belongsToTurn(block, currentTurn)
    const isLastCurrentTurnBlock = block === lastCurrentTurnBlock

    if (block.kind === 'run_final_text') return

    if (block.kind === 'thinking') {
      block.autoCollapse = Boolean(
        block.endedAt != null && normalizedBlocks.slice(index + 1).some(blockHasVisibleContent)
      )
      block.isActive = Boolean(
        isRunActive && isCurrentTurnBlock && isLastCurrentTurnBlock && block.endedAt == null
      )
    } else {
      block.isActive = Boolean(isRunActive && isCurrentTurnBlock && isLastCurrentTurnBlock)
    }
  })

  const shouldShowThinking = Boolean(
    run.status === 'running' && currentTurn && currentTurnBlocks.length === 0
  )

  return {
    blocks: normalizedBlocks,
    meta: {
      toolTypeCount: toolMeta.toolTypeCount,
      skillNames: toolMeta.skillNames,
      toolNamesTooltip: toolMeta.toolNamesTooltip,
      skillNamesTooltip: toolMeta.skillNamesTooltip,
      showThinkingPlaceholder: shouldShowThinking
    }
  }
}
