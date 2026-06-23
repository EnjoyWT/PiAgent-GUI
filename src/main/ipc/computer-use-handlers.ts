import electron from 'electron'
import type { ComputerUseRequest } from '../computer-use/computer-use-types.ts'
import {
  getComputerUseService,
  type ComputerUseService
} from '../computer-use/computer-use-service.ts'
import {
  buildComputerUseSetupReport,
  type ComputerUseSetupReport
} from '../../shared/computer-use-settings.ts'

const { ipcMain } = electron as typeof import('electron')

type ComputerUseIpcService = Pick<ComputerUseService, 'doctor' | 'execute'>

export type ComputerUseIpcHandlers = {
  doctor: () => Promise<Awaited<ReturnType<ComputerUseIpcService['doctor']>>>
  requestPermissions: (timeoutMs?: number) => Promise<Record<string, unknown>>
  testSetup: () => Promise<ComputerUseSetupReport>
}

export const createComputerUseIpcHandlers = (
  service: ComputerUseIpcService
): ComputerUseIpcHandlers => ({
  doctor: () => service.doctor(),
  requestPermissions: async (timeoutMs?: number): Promise<Record<string, unknown>> => {
    const result = await service.execute({
      action: 'request_permissions',
      timeoutMs
    } satisfies ComputerUseRequest)
    return result.actionResult ?? {}
  },
  testSetup: async (): Promise<ComputerUseSetupReport> => {
    const doctor = await service.doctor()
    return buildComputerUseSetupReport(doctor)
  }
})

export const setupComputerUseHandlers = (
  service: ComputerUseIpcService = getComputerUseService()
): void => {
  const handlers = createComputerUseIpcHandlers(service)

  ipcMain.handle('computer-use:doctor', () => handlers.doctor())
  ipcMain.handle('computer-use:request-permissions', (_, timeoutMs?: number) =>
    handlers.requestPermissions(timeoutMs)
  )
  ipcMain.handle('computer-use:test-setup', () => handlers.testSetup())
}
