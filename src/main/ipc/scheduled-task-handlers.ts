import { ipcMain } from 'electron'
import type {
  CreateScheduledTaskInput,
  UpdateScheduledTaskInput
} from '../../shared/scheduled-tasks.ts'
import { getScheduledTaskService } from '../scheduled-tasks/scheduled-task-service.ts'

export function setupScheduledTaskHandlers(): void {
  const service = getScheduledTaskService()

  ipcMain.handle('scheduled-tasks:list', (_, options?: { includeDisabled?: boolean }) =>
    service.listTasks(options)
  )
  ipcMain.handle('scheduled-tasks:get', (_, taskId: string) => service.getTask(taskId))
  ipcMain.handle('scheduled-tasks:create', (_, input: CreateScheduledTaskInput) =>
    service.createTask(input)
  )
  ipcMain.handle('scheduled-tasks:update', (_, input: UpdateScheduledTaskInput) =>
    service.updateTask(input)
  )
  ipcMain.handle(
    'scheduled-tasks:validate',
    (_, input: CreateScheduledTaskInput | UpdateScheduledTaskInput) => service.validate(input)
  )
  ipcMain.handle('scheduled-tasks:pause', (_, taskId: string) => service.pauseTask(taskId))
  ipcMain.handle('scheduled-tasks:resume', (_, taskId: string) => service.resumeTask(taskId))
  ipcMain.handle('scheduled-tasks:delete', (_, taskId: string) => service.deleteTask(taskId))
  ipcMain.handle('scheduled-tasks:run-now', (_, taskId: string) => service.triggerTaskNow(taskId))
  ipcMain.handle('scheduled-tasks:runs:list', (_, taskId: string, limit?: number) =>
    service.listRuns(taskId, limit)
  )
}
