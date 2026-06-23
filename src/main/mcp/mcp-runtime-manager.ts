import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import type { AgentToolResult } from '@enjoywt/pi-agent-core'
import {
  listEnabledWorkspaceMcpServerIds,
  listMcpServers,
  type McpServerRow
} from '../db/config-db'
import type { PluginMcpServerConfig } from '../agent-plugins/agent-plugin-resource-resolver.ts'

type JsonRecord = Record<string, unknown>

type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number]

type ConnectedServer = {
  row: McpRuntimeServerConfig
  client: Client
  transport: StdioClientTransport | SSEClientTransport
  tools: ListedTool[]
}

export type McpRuntimeServerConfig = McpServerRow | PluginMcpServerConfig

const splitCommandLine = (value: string): string[] => {
  const parts = value.match(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|\S+/g) ?? []
  return parts.map((part) => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1)
    }
    return part
  })
}

const parseArgs = (row: McpServerRow): { command: string; args: string[] } => {
  const commandText = String(row.command ?? '').trim()
  const commandParts = splitCommandLine(commandText)
  let extraArgs: string[] = []

  const rawArgs = String(row.args ?? '').trim()
  if (rawArgs) {
    try {
      const parsed = JSON.parse(rawArgs)
      if (Array.isArray(parsed)) {
        extraArgs = parsed.filter((item): item is string => typeof item === 'string')
      }
    } catch {
      extraArgs = splitCommandLine(rawArgs)
    }
  }

  if (commandParts.length === 0) throw new Error(`MCP server "${row.name}" has empty command`)
  const [command, ...inlineArgs] = commandParts
  return { command, args: [...inlineArgs, ...extraArgs] }
}

const parseEnv = (row: McpServerRow): Record<string, string> | undefined => {
  const raw = String(row.env ?? '').trim()
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as JsonRecord
    const entries = Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[0] === 'string')
      .map(([key, value]) => [key, String(value)] as const)
    return Object.fromEntries(entries)
  } catch {
    return undefined
  }
}

const sanitizeToolSegment = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')

const toTextParts = (result: {
  content?: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; mimeType: string; data: string }
    | { type: 'audio'; mimeType: string; data: string }
    | {
        type: 'resource'
        resource:
          | { uri: string; text: string; mimeType?: string }
          | { uri: string; blob: string; mimeType?: string }
      }
    | { type: 'resource_link'; uri: string; name: string; description?: string }
  >
  structuredContent?: Record<string, unknown>
  isError?: boolean
}): AgentToolResult<Record<string, unknown>> => {
  const textBlocks = (result.content ?? [])
    .map((item) => {
      switch (item.type) {
        case 'text':
          return item.text
        case 'image':
          return `[image ${item.mimeType}, ${item.data.length} b64 chars]`
        case 'audio':
          return `[audio ${item.mimeType}, ${item.data.length} b64 chars]`
        case 'resource':
          return 'text' in item.resource
            ? item.resource.text
            : `[resource ${item.resource.uri}, blob ${item.resource.blob.length} b64 chars]`
        case 'resource_link':
          return `${item.name}: ${item.uri}${item.description ? `\n${item.description}` : ''}`
        default:
          return ''
      }
    })
    .filter(Boolean)

  if (textBlocks.length === 0 && result.structuredContent) {
    textBlocks.push(JSON.stringify(result.structuredContent, null, 2))
  }
  if (textBlocks.length === 0) textBlocks.push('(no content)')

  return {
    content: [{ type: 'text', text: textBlocks.join('\n\n') }],
    details: {
      structuredContent: result.structuredContent ?? null,
      isError: Boolean(result.isError)
    }
  }
}

const normalizeCallToolResult = (
  result: Awaited<ReturnType<Client['callTool']>>
): {
  content?: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; mimeType: string; data: string }
    | { type: 'audio'; mimeType: string; data: string }
    | {
        type: 'resource'
        resource:
          | { uri: string; text: string; mimeType?: string }
          | { uri: string; blob: string; mimeType?: string }
      }
    | { type: 'resource_link'; uri: string; name: string; description?: string }
  >
  structuredContent?: Record<string, unknown>
  isError?: boolean
} => {
  if ('content' in result) {
    return {
      content: result.content as Array<
        | { type: 'text'; text: string }
        | { type: 'image'; mimeType: string; data: string }
        | { type: 'audio'; mimeType: string; data: string }
        | {
            type: 'resource'
            resource:
              | { uri: string; text: string; mimeType?: string }
              | { uri: string; blob: string; mimeType?: string }
          }
        | { type: 'resource_link'; uri: string; name: string; description?: string }
      >,
      structuredContent:
        result.structuredContent && typeof result.structuredContent === 'object'
          ? (result.structuredContent as Record<string, unknown>)
          : undefined,
      isError: typeof result.isError === 'boolean' ? result.isError : undefined
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result.toolResult, null, 2) }],
    isError: false
  }
}

const parseHeaders = (row: McpServerRow): Record<string, string> | undefined => {
  const raw = String(row.headers ?? '').trim()
  if (!raw) return undefined
  const headers: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue
    const key = line.slice(0, colonIndex).trim()
    const value = line.slice(colonIndex + 1).trim()
    if (key) headers[key] = value
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

export class McpRuntimeManager {
  private connections = new Map<string, Promise<ConnectedServer>>()

  private async connectRow(row: McpRuntimeServerConfig): Promise<ConnectedServer> {
    const cached = this.connections.get(row.id)
    if (cached) return await cached

    const promise = (async () => {
      let transport: StdioClientTransport | SSEClientTransport
      if (row.transport_type === 'sse' || row.transport_type === 'http') {
        if (!row.url) throw new Error(`Remote MCP server "${row.name}" has empty URL`)
        transport = new SSEClientTransport(new URL(row.url), {
          requestInit: {
            headers: parseHeaders(row)
          }
        })
      } else {
        const { command, args } = parseArgs(row)
        transport = new StdioClientTransport({
          command,
          args,
          env: parseEnv(row),
          stderr: 'pipe'
        })
      }
      const client = new Client({ name: 'piagent-mcp', version: '1.0.0' })
      await client.connect(transport)
      const listed = await client.listTools()
      return {
        row,
        client,
        transport,
        tools: listed.tools
      }
    })()

    this.connections.set(row.id, promise)

    try {
      return await promise
    } catch (error) {
      this.connections.delete(row.id)
      throw error
    }
  }

  async getWorkspaceToolDefinitions(
    workspacePath: string,
    extraServers: McpRuntimeServerConfig[] = []
  ): Promise<ToolDefinition[]> {
    const enabledIds = new Set(listEnabledWorkspaceMcpServerIds(workspacePath))
    const configuredRows = listMcpServers().filter(
      (row) => row.enabled === 1 && enabledIds.has(row.id)
    )
    const rows = [...configuredRows, ...extraServers.filter((row) => row.enabled === 1)]
    if (rows.length === 0) return []
    const definitions: ToolDefinition[] = []

    for (const row of rows) {
      try {
        const connected = await this.connectRow(row)
        for (const tool of connected.tools) {
          const serverId = row.id
          const serverName = row.name
          const mcpToolName = tool.name
          const runtimeName = `mcp__${sanitizeToolSegment(serverId)}__${sanitizeToolSegment(mcpToolName)}`

          definitions.push({
            name: runtimeName,
            label: `${serverName} / ${tool.name}`,
            description:
              tool.description?.trim() ||
              `Call MCP tool "${tool.name}" from server "${serverName}"`,
            parameters: (tool.inputSchema ?? {
              type: 'object',
              properties: {}
            }) as ToolDefinition['parameters'],
            execute: async (_toolCallId, params) => {
              const result = await connected.client.callTool({
                name: mcpToolName,
                arguments: (params ?? {}) as JsonRecord
              })
              const mapped = toTextParts(normalizeCallToolResult(result))
              return {
                content: mapped.content,
                details: {
                  serverId,
                  serverName,
                  toolName: mcpToolName,
                  ...(mapped.details ?? {})
                }
              }
            }
          } satisfies ToolDefinition)
        }
      } catch (error) {
        console.error(`Connect MCP server failed: ${row.name}`, error)
      }
    }

    return definitions
  }

  async getWorkspaceSignature(
    workspacePath: string,
    extraServers: McpRuntimeServerConfig[] = []
  ): Promise<string> {
    return JSON.stringify(
      Array.from(
        new Set([
          ...listEnabledWorkspaceMcpServerIds(workspacePath),
          ...extraServers.filter((row) => row.enabled === 1).map((row) => row.id)
        ])
      )
    )
  }

  async disposeAll(): Promise<void> {
    const pending = Array.from(this.connections.values())
    this.connections.clear()
    for (const connectionPromise of pending) {
      try {
        const connection = await connectionPromise
        await connection.transport.close()
      } catch {
        // ignore best-effort cleanup
      }
    }
  }
}

export const mcpRuntimeManager = new McpRuntimeManager()
