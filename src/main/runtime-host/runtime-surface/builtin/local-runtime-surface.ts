import {
  getProviderConfigService,
  type ProviderConfigService
} from '../../../provider-config/provider-config-service.ts'
import { getDoctorService } from '../../../doctor/doctor-service-singleton.ts'
import { createProviderConfigTool } from '../../../tools/provider-config-tool.ts'
import { createImTool } from '../../../tools/im-tool.ts'
import {
  getEmbeddedGatewayService,
  type EmbeddedGatewayService
} from '../../../transport/embedded-gateway.ts'
import {
  getScheduledTaskService,
  type ScheduledTaskService
} from '../../../scheduled-tasks/scheduled-task-service.ts'
import { createScheduledTaskTool } from '../../../tools/scheduled-task-tool.ts'
import { createComputerSystemInfoTool } from '../../../tools/computer-system-info-tool.ts'
import { createSystemDoctorTool } from '../../../tools/system-doctor-tool.ts'
import { widgetRendererTool } from '../../../tools/widget-renderer.ts'
import { createSubagentTools, type TaskManagerClient } from '../../../subagents/subagent-tools.ts'
import { getSubagentTaskManagerService } from '../../../subagents/subagent-task-manager-service.ts'
import { buildRuntimeSystemPrompt } from '../../runtime-system-prompt.ts'
import type { BuiltinRuntimeSurfaceModule } from '../runtime-surface-types.ts'

const createLazyProviderConfigService = (): ProviderConfigService =>
  new Proxy(
    {},
    {
      get:
        (_target, property) =>
        async (...args: unknown[]) => {
          const service = getProviderConfigService() as any
          return await service[property](...args)
        }
    }
  ) as ProviderConfigService

const createLazyScheduledTaskService = (): ScheduledTaskService =>
  new Proxy(
    {},
    {
      get:
        (_target, property) =>
        async (...args: unknown[]) => {
          const service = getScheduledTaskService() as any
          return await service[property](...args)
        }
    }
  ) as ScheduledTaskService

const createLazyEmbeddedGatewayService = (): EmbeddedGatewayService =>
  new Proxy(
    {},
    {
      get:
        (_target, property) =>
        async (...args: unknown[]) => {
          const service = await getEmbeddedGatewayService()
          return await (service as any)[property](...args)
        }
    }
  ) as EmbeddedGatewayService

export type CreateLocalRuntimeSurfaceModuleOptions = {
  getTaskManager?: () => TaskManagerClient
}

export const createLocalRuntimeSurfaceModule = ({
  getTaskManager = getSubagentTaskManagerService
}: CreateLocalRuntimeSurfaceModuleOptions = {}): BuiltinRuntimeSurfaceModule => ({
  sourceKind: 'local',
  manifest: {
    id: 'runtime-surface-local',
    kind: 'runtime-surface',
    apiVersion: '1',
    version: '1.0.0',
    displayName: 'Local Runtime Surface',
    description: 'Desktop/local runtime surface with inline widgets and blocking UI tools.'
  },
  register: () => ({
    sourceKind: 'local',
    buildSystemPrompt: ({ workspacePath, threadId, appConfigDir }) =>
      buildRuntimeSystemPrompt(workspacePath, threadId, appConfigDir, 'local'),
    getCustomTools: async ({
      conversationId,
      interactionThreadId,
      workspacePath,
      parentRuntimeModel,
      getActiveRunId,
      interactionController
    }) => {
      const providerConfigService = createLazyProviderConfigService()
      const context = {
        conversationId,
        interactionThreadId,
        getActiveRunId,
        interactionController
      }
      return [
        createProviderConfigTool({
          interactionController,
          context,
          providerConfigService
        }),
        createScheduledTaskTool({
          context,
          scheduledTaskService: createLazyScheduledTaskService()
        }),
        createImTool({
          gatewayService: createLazyEmbeddedGatewayService(),
          interactionController,
          context
        }),
        createComputerSystemInfoTool(),
        createSystemDoctorTool({
          doctorService: getDoctorService()
        }),
        widgetRendererTool,
        ...(parentRuntimeModel
          ? createSubagentTools({
              taskManager: getTaskManager(),
              context: {
                parentConversationId: conversationId,
                parentRunId: () => getActiveRunId?.() ?? null,
                parentMessageId: null,
                cwd: workspacePath ?? process.cwd(),
                parentRuntimeModel
              }
            })
          : [])
      ]
    }
  })
})

export const localRuntimeSurfaceModule: BuiltinRuntimeSurfaceModule =
  createLocalRuntimeSurfaceModule()
