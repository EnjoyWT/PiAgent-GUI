import test from 'node:test'
import assert from 'node:assert/strict'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createWebFetchTool } from '../../../src/main/tools/webfetch-tool.ts'
import { createWebSearchTool } from '../../../src/main/tools/web-search-tool.ts'

type TextToolResult = {
  content: Array<{ type: string; text?: string }>
}

type WebFetchDetails = {
  documents: Array<{ truncated: boolean }>
}

type WebSearchDetails = {
  results: Array<{ position: number }>
}

const testContext = {} as ExtensionContext

const firstText = (result: TextToolResult): string => {
  const first = result.content[0]
  return first?.type === 'text' ? (first.text ?? '') : ''
}

test('webFetchTool fetches pages through WebFetch runner and truncates model-visible content', async () => {
  const calls: string[] = []
  const tool = createWebFetchTool({
    runWebFetch: async ({ url }) => {
      calls.push(url)
      return {
        title: 'Example Page',
        url,
        content: 'abcdef'
      }
    }
  })

  const result = await tool.execute(
    'webfetch-1',
    { urls: ['https://example.com/page'], maxCharsPerUrl: 4 },
    undefined,
    undefined,
    testContext
  )

  assert.deepEqual(calls, ['https://example.com/page'])
  assert.match(firstText(result), /Example Page/)
  assert.match(firstText(result), /abcd/)
  assert.match(firstText(result), /truncated/)
  assert.equal((result.details as WebFetchDetails).documents[0].truncated, true)
})

test('webFetchTool rejects unsafe URLs before opening the WebFetch runner', async () => {
  let called = false
  const tool = createWebFetchTool({
    runWebFetch: async () => {
      called = true
      throw new Error('should not run')
    }
  })

  await assert.rejects(
    () =>
      tool.execute(
        'webfetch-unsafe',
        { urls: ['http://127.0.0.1:5173'] },
        undefined,
        undefined,
        testContext
      ),
    /not allowed/
  )
  assert.equal(called, false)
})

test('webSearchTool builds a Google search URL and returns normalized results', async () => {
  let openedUrl = ''
  const tool = createWebSearchTool({
    runWebFetch: async ({ url }) => {
      openedUrl = url
      return {
        results: [
          {
            title: 'PiAgent docs',
            url: 'https://example.com/piagent',
            description: 'PiAgent documentation'
          }
        ]
      }
    }
  })

  const result = await tool.execute(
    'websearch-1',
    { query: 'PiAgent WebFetch', limit: 5 },
    undefined,
    undefined,
    testContext
  )

  assert.equal(new URL(openedUrl).origin, 'https://www.google.com')
  assert.equal(new URL(openedUrl).pathname, '/search')
  assert.equal(new URL(openedUrl).searchParams.get('q'), 'PiAgent WebFetch')
  assert.match(firstText(result), /PiAgent docs/)
  assert.equal((result.details as WebSearchDetails).results[0].position, 1)
})

test('webSearchTool clamps the result limit before returning results', async () => {
  const tool = createWebSearchTool({
    runWebFetch: async () => ({
      results: Array.from({ length: 20 }, (_, index) => ({
        title: `Result ${index + 1}`,
        url: `https://example.com/${index + 1}`,
        description: ''
      }))
    })
  })

  const result = await tool.execute(
    'websearch-limit',
    { query: 'many results', limit: 500 },
    undefined,
    undefined,
    testContext
  )

  assert.equal((result.details as WebSearchDetails).results.length, 10)
})
