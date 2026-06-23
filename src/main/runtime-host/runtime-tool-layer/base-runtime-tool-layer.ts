import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import {
  createBashToolDefinition,
  createEditTool,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteTool,
  createWriteToolDefinition
} from '@enjoywt/pi-coding-agent'
import type { Skill, ToolDefinition } from '@enjoywt/pi-coding-agent'
import { createComputerUseTool } from '../../computer-use/computer-use-tool.ts'
import { mcpRuntimeManager, type McpRuntimeServerConfig } from '../../mcp/mcp-runtime-manager.ts'
import { createWebSearchTool } from '../../tools/web-search-tool.ts'
import { createWebFetchTool } from '../../tools/webfetch-tool.ts'
import { createReadSkillTool } from '../../tools/read-skill-tool.ts'
import { createKnowledgeSearchTool, createKnowledgeTraceTool } from '../../tools/knowledge-tools.ts'
import { createConversationQueryTool } from '../../tools/conversation-query-tool.ts'
import { getCoreV2Service } from '../../core-v2/sqlite-db.ts'

const createTrackedEditTool = (workspacePath: string) => {
  const originalEdit = createEditTool(workspacePath)
  const execute: typeof originalEdit.execute = async (toolCallId, params, signal, onUpdate) => {
    const relPath = params.path.trim()
    if (!relPath) return originalEdit.execute(toolCallId, params, signal, onUpdate)
    const absolutePath = path.resolve(workspacePath, relPath)
    const relativeCheck = path.relative(workspacePath, absolutePath)
    if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck) || relativeCheck === '') {
      return originalEdit.execute(toolCallId, params, signal, onUpdate)
    }

    let oldContent = ''
    try {
      oldContent = await readFile(absolutePath, 'utf-8')
    } catch {
      oldContent = ''
    }

    const res = await originalEdit.execute(toolCallId, params, signal, onUpdate)

    let newContent = ''
    try {
      newContent = await readFile(absolutePath, 'utf-8')
    } catch {
      newContent = ''
    }
    if (oldContent === newContent) return res

    const patch = createTwoFilesPatch(
      `a/${relPath}`,
      `b/${relPath}`,
      oldContent,
      newContent,
      '',
      '',
      {
        context: 3
      }
    )
    const baseDetails =
      res.details && typeof res.details === 'object' ? (res.details as Record<string, unknown>) : {}
    return {
      ...res,
      details: {
        ...baseDetails,
        path: relPath,
        piDiff: baseDetails['diff'],
        diff: patch.length > 200_000 ? `${patch.slice(0, 200_000)}\n\n[diff truncated]` : patch
      }
    }
  }
  return { ...originalEdit, execute } as any
}

const createTrackedWriteTool = (workspacePath: string) => {
  const originalWrite = createWriteTool(workspacePath)
  const execute: typeof originalWrite.execute = async (toolCallId, params, signal, onUpdate) => {
    const relPath = params.path.trim()
    if (!relPath) return originalWrite.execute(toolCallId, params, signal, onUpdate)
    const absolutePath = path.resolve(workspacePath, relPath)
    const relativeCheck = path.relative(workspacePath, absolutePath)
    if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck) || relativeCheck === '') {
      return originalWrite.execute(toolCallId, params, signal, onUpdate)
    }

    let oldContent = ''
    try {
      oldContent = await readFile(absolutePath, 'utf-8')
    } catch {
      oldContent = ''
    }
    const diff =
      oldContent === params.content
        ? ''
        : createTwoFilesPatch(`a/${relPath}`, `b/${relPath}`, oldContent, params.content, '', '', {
            context: 3
          })
    const res = await originalWrite.execute(toolCallId, params, signal, onUpdate)
    if (!diff.trim()) return res
    const baseDetails =
      res.details && typeof res.details === 'object' ? (res.details as Record<string, unknown>) : {}
    return {
      ...res,
      details: {
        ...baseDetails,
        path: relPath,
        diff: diff.length > 200_000 ? `${diff.slice(0, 200_000)}\n\n[diff truncated]` : diff
      }
    }
  }
  return { ...originalWrite, execute } as any
}

export class BaseRuntimeToolLayer {
  getBaseBuiltinToolDefinitions(workspacePath: string): ToolDefinition[] {
    return [
      createReadToolDefinition(workspacePath),
      createBashToolDefinition(workspacePath),
      createEditToolDefinition(workspacePath),
      createWriteToolDefinition(workspacePath),
      createFindToolDefinition(workspacePath),
      createGrepToolDefinition(workspacePath),
      createLsToolDefinition(workspacePath)
    ] as unknown as ToolDefinition[]
  }

  getBaseTools(_workspacePath: string): string[] {
    return ['read', 'bash', 'edit', 'write', 'find', 'grep', 'ls']
  }

  async getFrameworkCustomToolGroups(
    workspacePath: string,
    options: { extraMcpServers?: McpRuntimeServerConfig[]; getSkills?: () => Skill[] } = {}
  ): Promise<{ frameworkTools: ToolDefinition[]; mcpTools: ToolDefinition[] }> {
    return {
      frameworkTools: [
        createTrackedEditTool(workspacePath),
        createTrackedWriteTool(workspacePath),
        createComputerUseTool(),
        createWebSearchTool(),
        createWebFetchTool(),
        createReadSkillTool({ getSkills: options.getSkills ?? (() => []) }),
        createKnowledgeSearchTool(),
        createKnowledgeTraceTool(),
        createConversationQueryTool({ coreQueryService: getCoreV2Service() })
      ],
      mcpTools: await mcpRuntimeManager.getWorkspaceToolDefinitions(
        workspacePath,
        options.extraMcpServers ?? []
      )
    }
  }

  async getBaseCustomTools(workspacePath: string) {
    const { frameworkTools, mcpTools } = await this.getFrameworkCustomToolGroups(workspacePath)
    return [...frameworkTools, ...mcpTools]
  }
}
