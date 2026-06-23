import type { ContextEntry } from './context-types.ts'

export type SummaryPromptMode = 'initial' | 'iterative'

export type SummaryPromptSectionKey =
  | 'goal'
  | 'constraintsAndPreferences'
  | 'completedActions'
  | 'activeState'
  | 'inProgress'
  | 'blocked'
  | 'keyDecisions'
  | 'resolvedQuestions'
  | 'pendingUserAsks'
  | 'relevantFiles'
  | 'remainingWork'
  | 'criticalContext'

export type SummaryPromptSections = Record<SummaryPromptSectionKey, string>

export type SummaryPromptBuildInput = {
  mode: SummaryPromptMode
  previousSummary?: string | null
  entries: ContextEntry[]
}

export type SummaryPromptBuildResult = {
  systemPrompt: string
  userPrompt: string
}

const SECTION_LABELS: Record<SummaryPromptSectionKey, string> = {
  goal: 'Goal',
  constraintsAndPreferences: 'Constraints & Preferences',
  completedActions: 'Completed Actions',
  activeState: 'Active State',
  inProgress: 'In Progress',
  blocked: 'Blocked',
  keyDecisions: 'Key Decisions',
  resolvedQuestions: 'Resolved Questions',
  pendingUserAsks: 'Pending User Asks',
  relevantFiles: 'Relevant Files',
  remainingWork: 'Remaining Work',
  criticalContext: 'Critical Context'
}

const SECTION_ORDER = Object.keys(SECTION_LABELS) as SummaryPromptSectionKey[]

const normalizeWhitespace = (value: string): string =>
  String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const truncateText = (value: string, maxChars: number): string => {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

const formatEntry = (entry: ContextEntry): string => {
  const content = truncateText(String(entry.contentText ?? ''), 1200)
  return [
    `### Entry ${entry.seq}`,
    `- Role: ${entry.role}`,
    `- Semantic Kind: ${entry.semanticKind}`,
    entry.createdAt ? `- Created At: ${entry.createdAt}` : '',
    entry.sourceRef ? `- Source Ref: ${entry.sourceRef}` : '',
    'Content:',
    content || '(empty)'
  ]
    .filter(Boolean)
    .join('\n')
}

export const createEmptySummarySections = (): SummaryPromptSections => ({
  goal: '',
  constraintsAndPreferences: '',
  completedActions: '',
  activeState: '',
  inProgress: '',
  blocked: '',
  keyDecisions: '',
  resolvedQuestions: '',
  pendingUserAsks: '',
  relevantFiles: '',
  remainingWork: '',
  criticalContext: ''
})

export const renderSummarySections = (sections: SummaryPromptSections): string =>
  SECTION_ORDER.map((key) => `## ${SECTION_LABELS[key]}\n${normalizeWhitespace(sections[key])}`)
    .join('\n\n')
    .trim()

const labelToKey = (label: string): SummaryPromptSectionKey | null => {
  const normalized = normalizeWhitespace(label).toLowerCase()
  const entry = Object.entries(SECTION_LABELS).find(
    ([, value]) => value.toLowerCase() === normalized
  )
  return (entry?.[0] as SummaryPromptSectionKey | undefined) ?? null
}

export const parseSummarySections = (value: string): SummaryPromptSections => {
  const sections = createEmptySummarySections()
  const raw = normalizeWhitespace(value)
  const matches = Array.from(raw.matchAll(/^##\s+(.+)$/gm))
  if (matches.length === 0) {
    sections.criticalContext = raw
    return sections
  }

  const prelude = raw.slice(0, matches[0]?.index ?? 0).trim()
  if (prelude) sections.criticalContext = prelude

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const label = match[1]
    const key = labelToKey(label)
    if (!key) continue
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? raw.length) : raw.length
    sections[key] = normalizeWhitespace(raw.slice(start, end))
  }

  return sections
}

export class SummaryPromptBuilder {
  build(input: SummaryPromptBuildInput): SummaryPromptBuildResult {
    const systemPrompt = [
      'You are producing a structured handoff summary for another assistant.',
      'Do not answer the conversation.',
      'Do not continue the task.',
      'Do not execute any user request.',
      'Return only the summary body in markdown.',
      'Use the exact section headings below in this exact order:',
      ...SECTION_ORDER.map((key) => `- ## ${SECTION_LABELS[key]}`),
      'If a section has no content, leave it empty but keep the heading.'
    ].join('\n')

    const userPromptParts = [
      input.mode === 'iterative'
        ? 'Update the existing handoff summary with the new context entries below.'
        : 'Create a new handoff summary from the context entries below.',
      '',
      input.mode === 'iterative'
        ? [
            'Existing summary body:',
            input.previousSummary?.trim() || '(empty)',
            '',
            'New context entries:'
          ].join('\n')
        : 'Context entries:',
      input.entries.map((entry) => formatEntry(entry)).join('\n\n'),
      '',
      'Return only the markdown summary body.'
    ]

    return {
      systemPrompt,
      userPrompt: userPromptParts.filter(Boolean).join('\n')
    }
  }

  parseSections(value: string): SummaryPromptSections {
    return parseSummarySections(value)
  }

  renderSections(sections: SummaryPromptSections): string {
    return renderSummarySections(sections)
  }
}
