import { ipcMain } from 'electron'
import type { ContextEngineConfig } from '../../shared/context-engine.ts'
import { getLocalRuntimeHostService } from '../runtime-host/local-runtime-host.ts'

export function setupContextHandlers(): void {
  ipcMain.handle('context:get-config', async () =>
    (await getLocalRuntimeHostService()).getContextConfig()
  )

  ipcMain.handle('context:set-config', async (_, config: ContextEngineConfig) =>
    (await getLocalRuntimeHostService()).setContextConfig(config)
  )

  ipcMain.handle('context:get-thread-debug', async (_, chatThreadId: string) =>
    (await getLocalRuntimeHostService()).getContextThreadDebug(chatThreadId)
  )
}
