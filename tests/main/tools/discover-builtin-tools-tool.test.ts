import test from 'node:test'
import assert from 'node:assert/strict'
import { createDiscoverBuiltinToolsTool } from '../../../src/main/tools/discover-builtin-tools-tool.ts'

const createTool = () =>
  createDiscoverBuiltinToolsTool({
    getCatalog: () => [
      {
        name: 'read',
        label: 'Read',
        description: 'Read files',
        source: 'builtin',
        builtin: true,
        parameterKeys: ['path'],
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
        overriddenSources: [],
        toolsets: ['coding'],
        scopes: ['local', 'im'],
        status: 'active'
      },
      {
        name: 'imTool',
        label: 'IM Tool',
        description: 'IM operations',
        source: 'surface',
        builtin: true,
        parameterKeys: ['action', 'transportId'],
        parameters: {
          type: 'object',
          properties: { action: { type: 'string' }, transportId: { type: 'string' } }
        },
        overriddenSources: [],
        toolsets: ['im_ops'],
        scopes: ['local', 'im'],
        status: 'active'
      },
      {
        name: 'workspaceSearch',
        label: 'Workspace Search',
        description: 'Workspace MCP search',
        source: 'mcp',
        builtin: false,
        parameterKeys: ['query'],
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
        overriddenSources: [],
        toolsets: ['mcp'],
        scopes: ['local', 'im'],
        status: 'active'
      },
      {
        name: 'memos_search',
        label: 'Memory Search',
        description: 'Search MemOS memory',
        source: 'plugin',
        builtin: false,
        parameterKeys: ['query'],
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
        overriddenSources: [],
        toolsets: ['plugin'],
        scopes: ['local', 'im'],
        status: 'active'
      }
    ]
  })

test('discoverBuiltinToolsTool lists builtin and plugin runtime tools and excludes MCP by default', async () => {
  const tool = createTool()
  const result = await tool.execute(
    'tool-discover',
    { action: 'discover_builtin_tools' } as any,
    undefined,
    undefined,
    {} as any
  )

  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /active\/builtin: read/)
  assert.match(text, /active\/plugin: memos_search/)
  assert.match(text, /active\/surface: imTool/)
  assert.doesNotMatch(text, /workspaceSearch/)
})

test('discoverBuiltinToolsTool returns detailed schema when requested', async () => {
  const tool = createTool()
  const result = await tool.execute(
    'tool-detail',
    {
      action: 'get_tool_detail',
      toolName: 'imTool',
      includeParameters: true
    } as any,
    undefined,
    undefined,
    {} as any
  )

  assert.equal((result.details as any).tool.name, 'imTool')
  assert.deepEqual((result.details as any).tool.parameterKeys, ['action', 'transportId'])
  assert.equal((result.details as any).tool.status, 'active')
  assert.ok((result.details as any).tool.parameters)
})
