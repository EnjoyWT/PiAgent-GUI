export const KNOWLEDGE_PROFILE_PREVIEW_LIMIT = 180

export const buildKnowledgeProfilePreview = (
  body: string | null | undefined,
  limit = KNOWLEDGE_PROFILE_PREVIEW_LIMIT
): string => {
  const normalized = String(body ?? '')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized.length <= limit) return normalized
  const hardCut = normalized.slice(0, limit).trimEnd()
  const wordBoundary = hardCut.lastIndexOf(' ')
  const preview = wordBoundary > Math.floor(limit * 0.6) ? hardCut.slice(0, wordBoundary) : hardCut
  return `${preview}...`
}
