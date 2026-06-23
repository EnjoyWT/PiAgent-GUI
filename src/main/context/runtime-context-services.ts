import { ContextCaptureService } from './context-capture-service.ts'
import { ContextConfigService } from './context-config-service.ts'
import { ContextHostService } from './context-host-service.ts'
import { ContextMaterializer } from './context-materializer.ts'
import { PromptBudgetService } from './prompt-budget-service.ts'
import { ContextStore } from './context-store.ts'
import { getContextDb } from './context-storage-db.ts'

export type RuntimeContextServices = {
  store: ContextStore
  configService: ContextConfigService
  captureService: ContextCaptureService
  materializer: ContextMaterializer
  promptBudgetService: PromptBudgetService
  hostService: ContextHostService
}

let runtimeContextServicesSingleton: RuntimeContextServices | null = null

export const getRuntimeContextServices = (): RuntimeContextServices => {
  if (runtimeContextServicesSingleton) return runtimeContextServicesSingleton

  const store = new ContextStore(getContextDb())
  const configService = new ContextConfigService()
  const captureService = new ContextCaptureService(store)
  const materializer = new ContextMaterializer(store)
  const promptBudgetService = new PromptBudgetService()
  const hostService = new ContextHostService(store, configService, materializer, captureService)

  runtimeContextServicesSingleton = {
    store,
    configService,
    captureService,
    materializer,
    promptBudgetService,
    hostService
  }
  return runtimeContextServicesSingleton
}
