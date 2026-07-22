const normalizeLineEndings = (value: string): string => value.replace(/\r\n/g, '\n')

const sanitizeDiffPath = (filePath?: string): string => {
  const normalized = String(filePath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  return normalized || 'file'
}

const hasUnifiedFileHeader = (header: string): boolean =>
  /^---\s+/m.test(header) && /^\+\+\+\s+/m.test(header)

const firstHunkIndexOf = (diff: string): number => diff.search(/^@@\s/m)

const ensureRenderablePatchHeader = (patch: string, filePath?: string): string => {
  const trimmed = patch.trimEnd()
  const firstHunkIndex = firstHunkIndexOf(trimmed)
  if (firstHunkIndex < 0) return ''

  const header = trimmed.slice(0, firstHunkIndex)
  if (hasUnifiedFileHeader(header)) return trimmed

  const path = sanitizeDiffPath(filePath)
  return `--- a/${path}\n+++ b/${path}\n${trimmed.slice(firstHunkIndex).trimStart()}`
}

const splitFilePatches = (diff: string): string[] => {
  const lines = diff.split('\n')
  const starts: number[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.startsWith('diff --git ') || line.startsWith('Index: ')) {
      starts.push(index)
    }
  }

  if (starts.length <= 1) return [diff]

  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : lines.length
    return lines.slice(start, end).join('\n')
  })
}

export const buildDiffViewHunks = (input: { diff: string; filePath?: string }): string[] => {
  const normalized = normalizeLineEndings(input.diff ?? '').trimEnd()
  if (!normalized.trim()) return []

  return splitFilePatches(normalized)
    .map((patch) => ensureRenderablePatchHeader(patch, input.filePath))
    .filter((patch) => patch.trim().length > 0)
}
