import { getSetting } from '../db/config-db.ts'
import { runOneShotText, type OneShotTextInput, type OneShotTextResult } from '../llm/one-shot.ts'

export type GenerateConversationTitleInput = {
  text: string
  imageCount?: number
}

export type GenerateConversationTitleResult = {
  title: string
  source: 'model' | 'fallback'
  modelKey: string | null
}

type GenerateConversationTitleDeps = {
  getToolModelKey?: () => string | Promise<string>
  runOneShotText?: (input: OneShotTextInput) => Promise<OneShotTextResult | null>
}

const TITLE_MAX_CHARS = 40
const FALLBACK_TEXT_CHARS = 20
const TITLE_MAX_TOKENS = 64
const TITLE_TIMEOUT_MS = 12000

const GENERIC_TITLES = new Set([
  '新对话',
  '对话标题',
  '生成标题',
  '标题',
  'chat title',
  'new chat',
  'untitled'
])

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

const normalizeImageCount = (value: number | undefined): number => {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor(parsed))
}

export const buildFallbackConversationTitle = (input: GenerateConversationTitleInput): string => {
  const normalized = String(input.text ?? '').trim()
  if (!normalized) return normalizeImageCount(input.imageCount) > 0 ? '图片消息' : '新对话'
  return (
    normalized.slice(0, FALLBACK_TEXT_CHARS) +
    (normalized.length > FALLBACK_TEXT_CHARS ? '...' : '')
  )
}

export const sanitizeConversationTitle = (value: string): string => {
  const firstLine = String(value ?? '')
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .find(Boolean)

  if (!firstLine) return ''

  const cleaned = firstLine
    .replace(/^#+\s*/, '')
    .replace(/^标题[:：]\s*/i, '')
    .replace(/^["'`“”‘’「」『』]+|["'`“”‘’「」『』]+$/g, '')
    .trim()

  return normalizeWhitespace(cleaned).slice(0, TITLE_MAX_CHARS)
}

const isUsableModelTitle = (title: string): boolean => {
  const normalized = title.trim().toLowerCase()
  return Boolean(normalized) && !GENERIC_TITLES.has(normalized)
}

const resolveToolModelKey = async (deps: GenerateConversationTitleDeps): Promise<string> => {
  if (deps.getToolModelKey) return String(await deps.getToolModelKey()).trim()
  return String(getSetting('tool_model') ?? '').trim()
}

const resolveOneShotRunner = async (
  deps: GenerateConversationTitleDeps
): Promise<NonNullable<GenerateConversationTitleDeps['runOneShotText']>> =>
  deps.runOneShotText ?? runOneShotText

export const generateConversationTitle = async (
  input: GenerateConversationTitleInput,
  deps: GenerateConversationTitleDeps = {}
): Promise<GenerateConversationTitleResult> => {
  const fallback = buildFallbackConversationTitle(input)
  const userText = String(input.text ?? '').trim()
  if (!userText) return { title: fallback, source: 'fallback', modelKey: null }

  const toolModelKey = await resolveToolModelKey(deps)
  if (!toolModelKey) return { title: fallback, source: 'fallback', modelKey: null }

  const imageCount = normalizeImageCount(input.imageCount)

  try {
    const runTitleModel = await resolveOneShotRunner(deps)
    const result = await runTitleModel({
      modelKeys: [toolModelKey],
      systemPrompt: [
        'You are a chat title generator.',
        "Generate one short title based on the user's first message.",
        "Detect the user's language and respond in that exact language.",
        'If the message is in Chinese, the title MUST be in Chinese.',
        'Preserve the specific subject of the message, not the abstract category.',
        'Titles should feel like search keywords, not section headers or guide names.',
        "Bad: '起名指南' | Good: '小孩起名建议'",
        "Bad: 'Coding Guide' | Good: 'Python 爬虫入门'",
        'Chinese: 4–10 characters. English: 2–6 words.',
        'Output only the title. No quotes, no punctuation at the end, no markdown.'
      ].join('\n'),
      userPrompt: [
        `First user message:\n${userText}`,
        imageCount > 0 ? `Attached images: ${imageCount}` : '',
        'Generate the thread title.'
      ]
        .filter(Boolean)
        .join('\n\n'),
      maxTokens: TITLE_MAX_TOKENS,
      timeoutMs: TITLE_TIMEOUT_MS,
      temperature: 0
    })

    const title = sanitizeConversationTitle(result?.text ?? '')
    if (!isUsableModelTitle(title)) return { title: fallback, source: 'fallback', modelKey: null }
    return { title, source: 'model', modelKey: result?.modelKey ?? toolModelKey }
  } catch {
    return { title: fallback, source: 'fallback', modelKey: null }
  }
}
