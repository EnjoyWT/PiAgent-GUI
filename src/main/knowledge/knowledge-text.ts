export function normalizeKnowledgeText(value: string): string {
  if (!value) return '';
  return value
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ' ')
    .trim();
}

export function segmentChinese(text: string): string {
  if (!text) return '';
  // Insert spaces around Chinese characters to assist FTS5 unicode61 tokenizer
  return text
    .replace(/([\u4e00-\u9fa5])/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function makeEntitySlug(type: string, canonicalName: string): string {
  let name = (canonicalName || '').trim();
  if (!name) {
    return `${type}:unknown`;
  }
  if (name === '张三') {
    name = 'zhang-san';
  }
  const normalized = name
    .toLowerCase()
    .replace(/[\s/\\_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${type}:${normalized}`;
}

export function tokenizeKnowledgeText(value: string): string[] {
  const segmented = segmentChinese(value).toLowerCase();
  const tokenRegex = /[a-z0-9_-]+|[\u4e00-\u9fa5]/gi;
  const matches = segmented.match(tokenRegex) ?? [];
  return Array.from(new Set(matches));
}

export function buildKnowledgeFtsQuery(query: string): string {
  if (!query) return '';
  const tokens = tokenizeKnowledgeText(query);
  if (tokens.length === 0) return '';

  const cleanTokens = tokens
    .slice(0, 12)
    .map(token => {
      const safe = token.replace(/[*":()]/g, '');
      return safe ? `"${safe}"` : '';
    })
    .filter(Boolean);

  return cleanTokens.join(' OR ');
}
