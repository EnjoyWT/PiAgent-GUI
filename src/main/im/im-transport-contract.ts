import type {
  ImDeliveryCommand,
  ImDeliveryResult,
  ImTransportCapabilities
} from './im-delivery-types.ts'
import type { ImPluginDoctor } from './im-doctor-types.ts'
import type { ImTransportInboundEvent } from './im-inbound-types.ts'
import type {
  TransportPluginAccountSetupEvent,
  TransportPluginAccountSetupStartInput,
  TransportPluginAccountSetupStartResult
} from '../../shared/transport-plugins.ts'

export type ImTransportPlatformKind =
  | 'feishu'
  | 'telegram'
  | 'slack'
  | 'wecom'
  | 'desktop'
  | 'generic'

export type ImTransportPlugin = {
  metadata: {
    id: string
    displayName: string
    version: string
    protocolVersion: 2
    platformKind: ImTransportPlatformKind
  }
  getCapabilities(accountId: string): Promise<ImTransportCapabilities> | ImTransportCapabilities
  getDoctor(accountId: string): Promise<ImPluginDoctor> | ImPluginDoctor
  connect(accountId: string): Promise<void> | void
  disconnect(accountId: string): Promise<void> | void
  startAccountSetup?(
    input: TransportPluginAccountSetupStartInput
  ): Promise<TransportPluginAccountSetupStartResult> | TransportPluginAccountSetupStartResult
  cancelAccountSetup?(sessionId: string): Promise<void> | void
  onAccountSetupEvent?(
    handler: (event: TransportPluginAccountSetupEvent) => Promise<void> | void
  ): () => void
  onInbound(handler: (event: ImTransportInboundEvent) => Promise<void> | void): () => void
  send(command: ImDeliveryCommand): Promise<ImDeliveryResult> | ImDeliveryResult
}
