import type { BuiltinPluginModule } from '../../plugin-system/plugin-types.ts'
import type {
  DeliveryCommand,
  DeliveryResult,
  TransportCapabilities,
  TransportInboundHandler,
  TransportPlugin,
  TransportRegisterContext
} from '../transport-contract.ts'
import type { InboundEnvelope } from '../../core-v2/domain.ts'

export const DESKTOP_CHAT_TRANSPORT_ID = 'desktop-chat'
export const DESKTOP_CHAT_TRANSPORT_ACCOUNT_ID = 'desktop'

export class DesktopChatTransportPlugin implements TransportPlugin {
  readonly metadata = {
    id: DESKTOP_CHAT_TRANSPORT_ID,
    displayName: 'Desktop Chat',
    version: '1.0.0'
  }

  private readonly handlers = new Set<TransportInboundHandler>()
  private readonly connectedAccounts = new Set<string>()
  private readonly sentCommands: DeliveryCommand[] = []

  getCapabilities(): TransportCapabilities {
    return {
      canEditMessage: true,
      canStreamByEdit: true,
      canRenderButtons: true,
      canRenderRichCards: true,
      canReplyInThread: false,
      canUploadImage: true,
      canUploadFile: true,
      canCollectStructuredForm: true
    }
  }

  connect(accountId: string): void {
    this.connectedAccounts.add(accountId)
  }

  disconnect(accountId: string): void {
    this.connectedAccounts.delete(accountId)
  }

  send(command: DeliveryCommand): DeliveryResult {
    this.sentCommands.push(command)
    return {
      status: 'sent',
      externalMessageId: `desktop-delivery:${command.deliveryId}`,
      degradeMode: 'native'
    }
  }

  onInbound(handler: TransportInboundHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  async emitInbound(envelope: InboundEnvelope): Promise<void> {
    for (const handler of this.handlers) {
      await handler(envelope)
    }
  }

  listSentCommands(): DeliveryCommand[] {
    return this.sentCommands.map((command) => ({ ...command }))
  }
}

export const createDesktopChatTransportPlugin = (): DesktopChatTransportPlugin =>
  new DesktopChatTransportPlugin()

export const desktopChatTransportModule: BuiltinPluginModule<
  TransportPlugin,
  TransportRegisterContext
> = {
  manifest: {
    id: DESKTOP_CHAT_TRANSPORT_ID,
    kind: 'transport',
    apiVersion: '1',
    version: '1.0.0',
    displayName: 'Desktop Chat',
    description: 'Built-in desktop chat transport.'
  },
  register: () => createDesktopChatTransportPlugin()
}
