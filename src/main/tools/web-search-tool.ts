import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type { HiddenWebFetchInput } from '../webfetch/hidden-webfetch-runner.ts'

type WebSearchRunner = (input: HiddenWebFetchInput) => Promise<unknown>

type CreateWebSearchToolOptions = {
  runWebFetch?: WebSearchRunner
}

type RawSearchResult = {
  title?: string
  url?: string
  description?: string
}

const MAX_SEARCH_RESULTS = 10

const defaultRunWebFetch = async (input: HiddenWebFetchInput): Promise<unknown> => {
  const { runHiddenWebFetch } = await import('../webfetch/hidden-webfetch-runner.ts')
  return await runHiddenWebFetch(input)
}

const parametersSchema = Type.Object(
  {
    query: Type.String({
      description: 'Search query to run in Google through the WebFetch browser session.'
    }),
    limit: Type.Optional(
      Type.Number({
        description: 'Maximum number of search results to return. Defaults to 5, max 10.'
      })
    )
  },
  { additionalProperties: false }
)

const clampLimit = (value: unknown): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 5
  return Math.min(MAX_SEARCH_RESULTS, Math.max(1, numeric))
}

const googleSearchUrl = (query: string): string => {
  const url = new URL('https://www.google.com/search')
  url.searchParams.set('q', query)
  url.searchParams.set('hl', 'zh-CN')
  return url.toString()
}

const GOOGLE_SEARCH_EXTRACT_SCRIPT = `
(() => {
  const isGoogleInternal = (href) => {
    try {
      const url = new URL(href);
      return /(^|\\.)google\\./i.test(url.hostname);
    } catch {
      return true;
    }
  };
  const unwrapGoogleUrl = (href) => {
    try {
      const url = new URL(href);
      if (/(^|\\.)google\\./i.test(url.hostname) && url.pathname === '/url') {
        return url.searchParams.get('q') || url.searchParams.get('url') || href;
      }
      return href;
    } catch {
      return href;
    }
  };
  const bodyText = document.body?.innerText || '';
  const needsVerification = /unusual traffic|captcha|not a robot|verify you are human|我们的系统检测到/i.test(bodyText);
  const seen = new Set();
  const results = [];
  for (const anchor of Array.from(document.querySelectorAll('#search a'))) {
    const heading = anchor.querySelector('h3');
    const title = (heading?.innerText || '').trim();
    if (!title) continue;
    const url = unwrapGoogleUrl(anchor.href || '');
    if (!url || !/^https?:\\/\\//i.test(url) || isGoogleInternal(url) || seen.has(url)) continue;
    seen.add(url);
    const container = anchor.closest('div.g, div[data-sokoban-container], div');
    const text = (container?.innerText || '').split('\\n').map((line) => line.trim()).filter(Boolean);
    const description = text.find((line) => line !== title && line.length > 30) || '';
    results.push({ title, url, description });
    if (results.length >= 10) break;
  }
  return { needsVerification, results };
})()
`

export const createWebSearchTool = ({
  runWebFetch: runner = defaultRunWebFetch
}: CreateWebSearchToolOptions = {}): ToolDefinition => ({
  name: 'webSearchTool',
  label: 'Web Search Tool',
  description:
    'Search Google through the WebFetch browser session. Use this to find current web pages. It returns result metadata only; use webFetchTool to read the content of specific URLs.',
  promptSnippet: 'webSearchTool: search Google through the WebFetch browser session.',
  parameters: parametersSchema,
  execute: async (_toolCallId, params, signal) => {
    const input =
      params && typeof params === 'object' && !Array.isArray(params)
        ? (params as Record<string, unknown>)
        : {}
    const query = String(input.query ?? '').trim()
    if (!query) throw new Error('query is required')

    const limit = clampLimit(input.limit)
    const payload = (await runner({
      url: googleSearchUrl(query),
      script: GOOGLE_SEARCH_EXTRACT_SCRIPT,
      timeoutMs: 25_000,
      waitAfterLoadMs: 500,
      signal
    })) as { needsVerification?: boolean; results?: RawSearchResult[] }

    if (payload.needsVerification) {
      throw new Error('Google requires browser verification. Open the WebFetch browser and retry.')
    }

    const results = (payload.results ?? [])
      .filter((item) => item.title && item.url)
      .slice(0, limit)
      .map((item, index) => ({
        title: String(item.title),
        url: String(item.url),
        description: String(item.description ?? ''),
        position: index + 1
      }))

    const text =
      results.length === 0
        ? 'No Google search results were found.'
        : results
            .map(
              (item) =>
                `${item.position}. ${item.title}\nURL: ${item.url}${
                  item.description ? `\n${item.description}` : ''
                }`
            )
            .join('\n\n')

    return {
      content: [{ type: 'text' as const, text }],
      details: {
        query,
        engine: 'google',
        results
      }
    }
  }
})
