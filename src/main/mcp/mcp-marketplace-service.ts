const GLAMA_MCP_API_URL = 'https://glama.ai/api/mcp/v1/servers'
const SOURCE_LABEL = 'glama'

export interface McpMarketplaceItem {
  id: string
  name: string
  author: string
  description: string
  tags: string[]
  detailUrl: string
  github?: string
}

export interface ListMcpMarketplaceInput {
  query?: string
  page?: number
  limit?: number
  cursor?: string
}

export interface ListMcpMarketplaceResult {
  items: McpMarketplaceItem[]
  page: number
  limit: number
  hasMore: boolean
  nextCursor?: string
  source: string
}

const extractGithubSlug = (url?: string): string | undefined => {
  if (!url) return undefined
  const match = url.match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s#?]+)/i)
  return match?.[1]
}

const isHtmlResponse = (response: Response, text?: string): boolean => {
  const contentType = response.headers.get('content-type') ?? ''
  return (
    contentType.toLowerCase().includes('text/html') ||
    text?.trimStart().toLowerCase().startsWith('<!doctype html') === true ||
    text?.trimStart().toLowerCase().startsWith('<html') === true
  )
}

const createMarketplaceRequestError = (response: Response, text?: string): Error => {
  if (
    response.headers.get('x-vercel-mitigated') === 'challenge' ||
    text?.includes('Vercel Security Checkpoint') ||
    isHtmlResponse(response, text)
  ) {
    return new Error(`MCP 市场请求被远端安全验证拦截（HTTP ${response.status}），请稍后重试`)
  }

  return new Error(`Marketplace request failed: ${response.status} ${response.statusText}`.trim())
}

export const listMcpMarketplace = async (
  input: ListMcpMarketplaceInput = {}
): Promise<ListMcpMarketplaceResult> => {
  const page = Math.max(1, Math.floor(input.page ?? 1))
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 20)))
  const query = String(input.query ?? '').trim()
  const cursor = String(input.cursor ?? '').trim()

  const url = new URL(GLAMA_MCP_API_URL)
  url.searchParams.set('first', String(limit))
  if (query) {
    url.searchParams.set('query', query)
  }
  if (cursor) {
    url.searchParams.set('after', cursor)
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json'
    }
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw createMarketplaceRequestError(response, text)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    const text = await response.text().catch(() => '')
    throw createMarketplaceRequestError(response, text)
  }

  const data = await response.json()
  const servers = Array.isArray(data.servers) ? data.servers : []

  const items: McpMarketplaceItem[] = servers.map((server: any) => ({
    id: String(server.id || server.slug || server.name),
    name: server.name || server.slug || 'Untitled MCP Server',
    author: server.namespace || 'Unknown',
    description: server.description || '',
    tags: Array.isArray(server.attributes) ? server.attributes : [],
    detailUrl: server.url || `https://glama.ai/mcp/servers/${server.id}`,
    github: extractGithubSlug(server.repository?.url)
  }))

  return {
    items,
    page,
    limit,
    hasMore: data.pageInfo?.hasNextPage ?? false,
    nextCursor: data.pageInfo?.endCursor,
    source: SOURCE_LABEL
  }
}
