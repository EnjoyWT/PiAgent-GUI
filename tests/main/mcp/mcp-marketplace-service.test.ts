import test from 'node:test'
import assert from 'node:assert/strict'
import { listMcpMarketplace } from '../../../src/main/mcp/mcp-marketplace-service.ts'

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test('listMcpMarketplace maps Glama server search results with cursor pagination', async () => {
  let requestedUrl = ''
  globalThis.fetch = async (input: string | URL | Request) => {
    requestedUrl = String(input)
    return new Response(
      JSON.stringify({
        pageInfo: {
          endCursor: 'cursor-page-2',
          hasNextPage: true
        },
        servers: [
          {
            id: 'server-1',
            name: 'Filesystem MCP',
            namespace: 'modelcontextprotocol',
            description: 'Read and write local files.',
            attributes: ['hosting:local-only', 'category:files'],
            repository: {
              url: 'https://github.com/modelcontextprotocol/servers'
            },
            url: 'https://glama.ai/mcp/servers/server-1'
          }
        ]
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8'
        }
      }
    )
  }

  const result = await listMcpMarketplace({
    query: 'filesystem',
    page: 2,
    limit: 2,
    cursor: 'cursor-page-1'
  } as any)

  const url = new URL(requestedUrl)
  assert.equal(url.origin + url.pathname, 'https://glama.ai/api/mcp/v1/servers')
  assert.equal(url.searchParams.get('query'), 'filesystem')
  assert.equal(url.searchParams.get('first'), '2')
  assert.equal(url.searchParams.get('after'), 'cursor-page-1')
  assert.deepEqual(result, {
    items: [
      {
        id: 'server-1',
        name: 'Filesystem MCP',
        author: 'modelcontextprotocol',
        description: 'Read and write local files.',
        tags: ['hosting:local-only', 'category:files'],
        detailUrl: 'https://glama.ai/mcp/servers/server-1',
        github: 'modelcontextprotocol/servers'
      }
    ],
    page: 2,
    limit: 2,
    hasMore: true,
    nextCursor: 'cursor-page-2',
    source: 'glama'
  })
})

test('listMcpMarketplace reports a concise error when the remote returns a security checkpoint page', async () => {
  globalThis.fetch = async () =>
    new Response('<!DOCTYPE html><title>Vercel Security Checkpoint</title>', {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-vercel-mitigated': 'challenge'
      }
    })

  await assert.rejects(
    () => listMcpMarketplace({ limit: 1 }),
    /MCP 市场请求被远端安全验证拦截（HTTP 429）/
  )
})
