import { buildRuntimeSystemPrompt } from '../../runtime-system-prompt.ts'
import { getDoctorService } from '../../../doctor/doctor-service-singleton.ts'
import {
  getScheduledTaskService,
  type ScheduledTaskService
} from '../../../scheduled-tasks/scheduled-task-service.ts'
import { createImTool } from '../../../tools/im-tool.ts'
import { createScheduledTaskTool } from '../../../tools/scheduled-task-tool.ts'
import { createSystemDoctorTool } from '../../../tools/system-doctor-tool.ts'
import {
  getEmbeddedGatewayService,
  type EmbeddedGatewayService
} from '../../../transport/embedded-gateway.ts'
import type { BuiltinRuntimeSurfaceModule } from '../runtime-surface-types.ts'

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

export const imRuntimeSurfaceModule: BuiltinRuntimeSurfaceModule = {
  sourceKind: 'im',
  manifest: {
    id: 'runtime-surface-im',
    kind: 'runtime-surface',
    apiVersion: '1',
    version: '1.0.0',
    displayName: 'IM Runtime Surface',
    description: 'Remote/IM runtime surface without desktop-only UI tool injection.'
  },
  register: () => ({
    sourceKind: 'im',
    buildSystemPrompt: ({ workspacePath, threadId, appConfigDir }) =>
      buildRuntimeSystemPrompt(workspacePath, threadId, appConfigDir, 'im'),
    getCustomTools: async ({
      conversationId,
      interactionThreadId,
      getActiveRunId,
      interactionController
    }) => [
      createScheduledTaskTool({
        context: {
          conversationId,
          interactionThreadId,
          getActiveRunId,
          interactionController
        },
        scheduledTaskService: createLazyScheduledTaskService()
      }),
      createImTool({
        gatewayService: createLazyEmbeddedGatewayService(),
        interactionController,
        context: {
          conversationId,
          interactionThreadId,
          getActiveRunId,
          interactionController
        }
      }),
      createSystemDoctorTool({
        doctorService: getDoctorService()
      })
    ]
  })
}
