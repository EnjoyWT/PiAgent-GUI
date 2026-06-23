import { ipcMain } from 'electron'
import type { QuestionAnswerPayload } from '../../shared/question-tool.ts'
import type { QuestionnaireAnswerPayload } from '../../shared/questionnaire-tool.ts'
import type { SecretAnswerPayload } from '../../shared/secret-input.ts'
import type { InboundEnvelope } from '../core-v2/domain.ts'
import {
  getEmbeddedGatewayService,
  type SubmitDesktopLocalMessageInput
} from '../transport/embedded-gateway.ts'

export function setupGatewayHandlers(): void {
  ipcMain.handle('gateway:start', async () => {
    await (await getEmbeddedGatewayService()).start()
    return { success: true }
  })

  ipcMain.handle('gateway:stop', async () => {
    await (await getEmbeddedGatewayService()).stop()
    return { success: true }
  })

  ipcMain.handle('gateway:restart', async () => {
    await (await getEmbeddedGatewayService()).restart()
    return { success: true }
  })

  ipcMain.handle('gateway:transports:list-statuses', async () =>
    (await getEmbeddedGatewayService()).listTransportStatuses()
  )

  ipcMain.handle('gateway:ingest-inbound', (_, envelope: InboundEnvelope) =>
    getEmbeddedGatewayService().then((gateway) => gateway.ingestInbound(envelope))
  )

  ipcMain.handle(
    'gateway:desktop:submit-local-message',
    async (_, input: SubmitDesktopLocalMessageInput) => {
      const gateway = await getEmbeddedGatewayService()
      await gateway.start()
      return gateway.submitDesktopLocalMessage(input)
    }
  )

  ipcMain.handle('gateway:desktop:reset-local-conversation', async (_, threadId: string) => {
    const gateway = await getEmbeddedGatewayService()
    await gateway.resetDesktopLocalConversation(threadId)
    return { success: true }
  })

  ipcMain.handle(
    'gateway:desktop:answer-question',
    async (_, threadId: string, payload: QuestionAnswerPayload) => {
      const gateway = await getEmbeddedGatewayService()
      return gateway.answerDesktopQuestion(threadId, payload)
    }
  )

  ipcMain.handle(
    'gateway:desktop:answer-questionnaire',
    async (_, threadId: string, payload: QuestionnaireAnswerPayload) => {
      const gateway = await getEmbeddedGatewayService()
      return gateway.answerDesktopQuestionnaire(threadId, payload)
    }
  )

  ipcMain.handle(
    'gateway:desktop:answer-secret',
    async (_, threadId: string, payload: SecretAnswerPayload) => {
      const gateway = await getEmbeddedGatewayService()
      return gateway.answerDesktopSecret(threadId, payload)
    }
  )

  ipcMain.handle('gateway:deliveries:dispatch-pending', () =>
    getEmbeddedGatewayService().then((gateway) => gateway.dispatchPendingDeliveries())
  )
}
