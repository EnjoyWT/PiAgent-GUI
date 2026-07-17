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
} from '@earendil-works/pi-coding-agent'
import type { Skill, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { createComputerUseTool } from '../../computer-use/computer-use-tool.ts'
import { mcpRuntimeManager, type McpRuntimeServerConfig } from '../../mcp/mcp-runtime-manager.ts'
import { createWebSearchTool } from '../../tools/web-search-tool.ts'
import { createWebFetchTool } from '../../tools/webfetch-tool.ts'
import { createReadSkillTool } from '../../tools/read-skill-tool.ts'
import { createKnowledgeSearchTool, createKnowledgeTraceTool } from '../../tools/knowledge-tools.ts'
import { createConversationQueryTool } from '../../tools/conversation-query-tool.ts'
import { getCoreV2Service } from '../../core-v2/sqlite-db.ts'
import { listWorkspaceSandboxGrants } from '../../db/config-db.ts'
import { createSandboxedBashOperations } from '../../sandbox/os-sandbox.ts'
import { createNativeWorkspacePermissionBroker } from '../../sandbox/workspace-permission-broker.ts'
import {
  WorkspaceSandbox,
  normalizeWorkspaceSandboxPath,
  type SandboxMode,
  type FileAccessMode
} from '../../sandbox/workspace-sandbox.ts'

const sandboxModeForPolicy = (sandboxPolicyId?: string | null): SandboxMode =>
  sandboxPolicyId === 'sandbox' ? 'sandbox' : 'full'

const createWorkspaceSandbox = (workspacePath: string, sandboxPolicyId?: string | null) => {
  const mode = sandboxModeForPolicy(sandboxPolicyId)
  const normalizedWorkspacePath = normalizeWorkspaceSandboxPath(workspacePath)
  const grants =
    mode === 'sandbox'
      ? listWorkspaceSandboxGrants(normalizedWorkspacePath).map((grant) => ({
          path: grant.granted_path,
          access: grant.access_mode
        }))
      : []
  return new WorkspaceSandbox({ workspacePath: normalizedWorkspacePath, mode, grants })
}

const guardPathTool = <T extends { execute: (...args: any[]) => Promise<any> }>(
  tool: T,
  workspacePath: string,
  sandbox: WorkspaceSandbox,
  access: FileAccessMode,
  parameter: 'path'
): T => {
  const execute = tool.execute
  return {
    ...tool,
    execute: async (
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: unknown
    ) => {
      const value = params[parameter]
      if (typeof value === 'string' && value.trim()) {
        const decision = sandbox.decideFileAccess(path.resolve(workspacePath, value), access)
        if (!decision.allowed) {
          const approved = await createNativeWorkspacePermissionBroker().requestAccess({
            workspacePath,
            targetPath: decision.resolvedPath,
            access,
            source: 'file-tool'
          })
          if (!approved) {
            throw new Error(`Sandbox access was denied for: ${decision.resolvedPath}`)
          }
        }
      }
      return await execute(toolCallId, params, signal, onUpdate as any)
    }
  } as T
}

const createTrackedEditTool = (workspacePath: string, sandbox: WorkspaceSandbox) => {
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
  return guardPathTool({ ...originalEdit, execute } as any, workspacePath, sandbox, 'write', 'path')
}

const createTrackedWriteTool = (workspacePath: string, sandbox: WorkspaceSandbox) => {
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
  return guardPathTool(
    { ...originalWrite, execute } as any,
    workspacePath,
    sandbox,
    'write',
    'path'
  )
}

export class BaseRuntimeToolLayer {
  getBaseBuiltinToolDefinitions(
    workspacePath: string,
    sandboxPolicyId?: string | null
  ): ToolDefinition[] {
    const sandbox = createWorkspaceSandbox(workspacePath, sandboxPolicyId)
    return [
      guardPathTool(
        createReadToolDefinition(workspacePath),
        workspacePath,
        sandbox,
        'read',
        'path'
      ),
      createBashToolDefinition(
        workspacePath,
        sandbox.mode === 'sandbox'
          ? {
              operations: createSandboxedBashOperations(
                normalizeWorkspaceSandboxPath(workspacePath)
              )
            }
          : undefined
      ),
      guardPathTool(
        createEditToolDefinition(workspacePath),
        workspacePath,
        sandbox,
        'write',
        'path'
      ),
      guardPathTool(
        createWriteToolDefinition(workspacePath),
        workspacePath,
        sandbox,
        'write',
        'path'
      ),
      guardPathTool(
        createFindToolDefinition(workspacePath),
        workspacePath,
        sandbox,
        'read',
        'path'
      ),
      guardPathTool(
        createGrepToolDefinition(workspacePath),
        workspacePath,
        sandbox,
        'read',
        'path'
      ),
      guardPathTool(createLsToolDefinition(workspacePath), workspacePath, sandbox, 'read', 'path')
    ] as unknown as ToolDefinition[]
  }

  getBaseTools(_workspacePath: string): string[] {
    return ['read', 'bash', 'edit', 'write', 'find', 'grep', 'ls']
  }

  async getFrameworkCustomToolGroups(
    workspacePath: string,
    options: {
      extraMcpServers?: McpRuntimeServerConfig[]
      getSkills?: () => Skill[]
      sandboxPolicyId?: string | null
    } = {}
  ): Promise<{ frameworkTools: ToolDefinition[]; mcpTools: ToolDefinition[] }> {
    const sandbox = createWorkspaceSandbox(workspacePath, options.sandboxPolicyId)
    return {
      frameworkTools: [
        createTrackedEditTool(workspacePath, sandbox),
        createTrackedWriteTool(workspacePath, sandbox),
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

  async getBaseCustomTools(workspacePath: string, sandboxPolicyId?: string | null) {
    const { frameworkTools, mcpTools } = await this.getFrameworkCustomToolGroups(workspacePath, {
      sandboxPolicyId
    })
    return [...frameworkTools, ...mcpTools]
  }
}
