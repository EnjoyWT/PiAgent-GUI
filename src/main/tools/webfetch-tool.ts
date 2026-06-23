import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type { HiddenWebFetchInput } from '../webfetch/hidden-webfetch-runner.ts'
import { assertSafeWebFetchUrl } from '../webfetch/url-safety.ts'

type WebFetchRunner = (input: HiddenWebFetchInput) => Promise<unknown>

type CreateWebFetchToolOptions = {
  runWebFetch?: WebFetchRunner
}

type RawWebFetchDocument = {
  title?: string
  url?: string
  content?: string
}

const MAX_URLS_PER_CALL = 5
const DEFAULT_MAX_CHARS_PER_URL = 12_000
const MAX_CHARS_PER_URL = 50_000

const defaultRunWebFetch = async (input: HiddenWebFetchInput): Promise<unknown> => {
  const { runHiddenWebFetch } = await import('../webfetch/hidden-webfetch-runner.ts')
  return await runHiddenWebFetch(input)
}

const parametersSchema = Type.Object(
  {
    urls: Type.Array(Type.String(), {
      description: 'HTTP/HTTPS URLs to fetch with the WebFetch browser session. Max 5 URLs.',
      maxItems: MAX_URLS_PER_CALL
    }),
    maxCharsPerUrl: Type.Optional(
      Type.Number({
        description: 'Maximum content characters to return per URL. Defaults to 12000.'
      })
    )
  },
  { additionalProperties: false }
)

const clampMaxChars = (value: unknown): number => {
  const numeric =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.round(value)
      : DEFAULT_MAX_CHARS_PER_URL
  return Math.min(MAX_CHARS_PER_URL, Math.max(1, numeric))
}

const WEB_FETCH_EXTRACT_SCRIPT = `
(() => {
  const clean = (value) => String(value || '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
  return {
    title: clean(document.title || ''),
    url: location.href,
    content: clean(document.body?.innerText || '')
  };
})()
`

export const createWebFetchTool = ({
  runWebFetch: runner = defaultRunWebFetch
}: CreateWebFetchToolOptions = {}): ToolDefinition => ({
  name: 'webFetchTool',
  label: 'WebFetch Tool',
  description:
    'Fetch and read web page content through the WebFetch browser session. Use this after webSearchTool when you need the content of specific URLs, including pages that require the WebFetch browser login session.',
  promptSnippet: 'webFetchTool: read page text through the WebFetch browser session.',
  parameters: parametersSchema,
  execute: async (_toolCallId, params, signal) => {
    const input =
      params && typeof params === 'object' && !Array.isArray(params)
        ? (params as Record<string, unknown>)
        : {}
    const inputUrls = Array.isArray(input.urls) ? input.urls : []
    const urls = inputUrls.slice(0, MAX_URLS_PER_CALL).map((url) => assertSafeWebFetchUrl(url))
    if (urls.length === 0) throw new Error('urls is required')

    const maxCharsPerUrl = clampMaxChars(input.maxCharsPerUrl)
    const documents: Array<{
      title: string
      url: string
      content: string
      truncated: boolean
    }> = []

    for (const url of urls) {
      const raw = (await runner({
        url,
        script: WEB_FETCH_EXTRACT_SCRIPT,
        timeoutMs: 25_000,
        waitAfterLoadMs: 500,
        signal
      })) as RawWebFetchDocument
      const content = String(raw.content ?? '')
      const truncated = content.length > maxCharsPerUrl
      documents.push({
        title: String(raw.title ?? ''),
        url: String(raw.url ?? url),
        content: truncated ? content.slice(0, maxCharsPerUrl) : content,
        truncated
      })
    }

    const text = documents
      .map(
        (doc, index) =>
          `# ${index + 1}. ${doc.title || doc.url}\nURL: ${doc.url}\n\n${doc.content}${
            doc.truncated ? '\n\n[truncated]' : ''
          }`
      )
      .join('\n\n')

    return {
      content: [{ type: 'text' as const, text }],
      details: {
        documents,
        maxCharsPerUrl
      }
    }
  }
})
