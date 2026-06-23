import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import type { ConversationSourceKind } from '../../core-v2/domain.ts'
import type { WorkerRuntimeModelConfig } from '../../subagents/subagent-types.ts'
import type {
  BuiltinPluginModule,
  PluginRegisterContext
} from '../../plugin-system/plugin-types.ts'
import type { RuntimeUserInteractionController } from '../user-interaction-controller.ts'

export type RuntimeSurfaceRegisterContext = PluginRegisterContext

export type RuntimeSurfacePromptContext = {
  workspacePath: string
  threadId: string
  appConfigDir: string
}

export type RuntimeSurfaceToolContext = {
  conversationId: string
  interactionThreadId: string
  workspacePath?: string
  parentRuntimeModel?: WorkerRuntimeModelConfig
  getActiveRunId?: () => string | null
  interactionController: RuntimeUserInteractionController
}

export type RuntimeSurfacePlugin = {
  sourceKind: ConversationSourceKind
  buildSystemPrompt(context: RuntimeSurfacePromptContext): string
  getCustomTools(context: RuntimeSurfaceToolContext): Promise<ToolDefinition[]> | ToolDefinition[]
}

export type BuiltinRuntimeSurfaceModule = BuiltinPluginModule<
  RuntimeSurfacePlugin,
  RuntimeSurfaceRegisterContext
> & {
  sourceKind: ConversationSourceKind
}
