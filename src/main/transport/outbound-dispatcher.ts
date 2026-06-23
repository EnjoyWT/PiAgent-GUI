import type { CoreCommandService, CoreQueryService, DeliveryRecord } from '../core-v2/domain.ts'
import { planImDeliveryCommand } from '../im/im-delivery-policy.ts'
import { createDeliveryCommand, type DeliveryResult } from './transport-contract.ts'
import { TransportHost } from './transport-host.ts'

export type DispatchDeliveryResult = {
  deliveryId: string
  status: DeliveryRecord['status']
  result: DeliveryResult | null
  error?: string | null
}

export type OutboundDispatcherDeps = {
  core: Pick<
    CoreCommandService & CoreQueryService,
    'getConversationBinding' | 'listDeliveryRecords' | 'updateDeliveryStatus'
  >
  transportHost: TransportHost
}

export class OutboundDispatcher {
  private readonly core: OutboundDispatcherDeps['core']
  private readonly transportHost: TransportHost

  constructor(deps: OutboundDispatcherDeps) {
    this.core = deps.core
    this.transportHost = deps.transportHost
  }

  async dispatchPending(): Promise<DispatchDeliveryResult[]> {
    const records = this.core.listDeliveryRecords('requested')
    const results: DispatchDeliveryResult[] = []

    for (const record of records) {
      results.push(await this.dispatch(record))
    }

    return results
  }

  async dispatch(record: DeliveryRecord): Promise<DispatchDeliveryResult> {
    const binding = this.core.getConversationBinding(record.bindingId)
    if (!binding) {
      this.core.updateDeliveryStatus({
        deliveryId: record.id,
        status: 'failed',
        result: { error: `Missing binding: ${record.bindingId}` }
      })
      return {
        deliveryId: record.id,
        status: 'failed',
        result: null,
        error: `Missing binding: ${record.bindingId}`
      }
    }

    try {
      const command = createDeliveryCommand(record, binding)
      const capabilities = await this.transportHost.getCapabilities(
        command.transportId,
        command.transportAccountId
      )
      const plan = planImDeliveryCommand(command, capabilities)
      const sentResults: DeliveryResult[] = []
      for (const plannedCommand of plan.commands) {
        sentResults.push(await this.transportHost.send(plannedCommand))
      }
      const failedResult = sentResults.find((item) => item.status === 'failed') ?? null
      const result =
        failedResult ??
        ({
          status: 'sent',
          externalMessageId: sentResults.at(-1)?.externalMessageId ?? null,
          degradeMode: plan.degradeMode ?? undefined,
          raw: sentResults
        } satisfies DeliveryResult)
      this.core.updateDeliveryStatus({
        deliveryId: record.id,
        status: result.status,
        result
      })
      return {
        deliveryId: record.id,
        status: result.status,
        result
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.core.updateDeliveryStatus({
        deliveryId: record.id,
        status: 'failed',
        result: { error: message }
      })
      return {
        deliveryId: record.id,
        status: 'failed',
        result: null,
        error: message
      }
    }
  }
}
