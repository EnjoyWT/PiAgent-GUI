import type {
  DeliveryCommand,
  TransportCapabilities,
  TransportCapabilityDegradeMode
} from '../transport/transport-contract.ts'

export type PlannedImDeliveryCommand = {
  commands: DeliveryCommand[]
  degradeMode: TransportCapabilityDegradeMode | null
}

export const planImDeliveryCommand = (
  command: DeliveryCommand,
  capabilities: TransportCapabilities
): PlannedImDeliveryCommand => {
  const normalized = normalizeUnsupportedPayload(command, capabilities)
  const commands = splitLongTextCommand(normalized.command, capabilities.maxTextLength)
  return {
    commands,
    degradeMode: normalized.degradeMode
  }
}

const normalizeUnsupportedPayload = (
  command: DeliveryCommand,
  capabilities: TransportCapabilities
): { command: DeliveryCommand; degradeMode: TransportCapabilityDegradeMode | null } => {
  const payload = asPayloadRecord(command.payload)
  if (!payload) return { command, degradeMode: null }

  if (payload.kind === 'rich_card' && !capabilities.canRenderRichCards) {
    return {
      command: {
        ...command,
        payload: {
          kind: 'text',
          text: String(payload.fallbackText ?? '[card]')
        }
      },
      degradeMode: 'text_fallback'
    }
  }

  if (payload.kind === 'interaction' && !capabilities.canRenderButtons) {
    return {
      command: {
        ...command,
        payload: {
          kind: 'text',
          text: String(payload.prompt ?? payload.fallbackText ?? '[interaction]')
        }
      },
      degradeMode: 'text_fallback'
    }
  }

  if (payload.kind === 'markdown') {
    return {
      command: {
        ...command,
        payload: {
          kind: 'text',
          text: String(payload.fallbackText ?? payload.markdown ?? '')
        }
      },
      degradeMode: 'text_fallback'
    }
  }

  return { command, degradeMode: null }
}

const splitLongTextCommand = (
  command: DeliveryCommand,
  maxTextLength?: number
): DeliveryCommand[] => {
  const payload = asPayloadRecord(command.payload)
  const text = payload?.kind === 'text' ? String(payload.text ?? '') : null
  const limit = maxTextLength && maxTextLength > 0 ? Math.trunc(maxTextLength) : null
  if (!text || !limit || text.length <= limit) return [command]

  const chunks: string[] = []
  for (let index = 0; index < text.length; index += limit) {
    chunks.push(text.slice(index, index + limit))
  }
  return chunks.map((chunk, index) => ({
    ...command,
    deliveryId: index === 0 ? command.deliveryId : `${command.deliveryId}:${index + 1}`,
    payload: {
      kind: 'text',
      text: chunk
    }
  }))
}

const asPayloadRecord = (payload: unknown): Record<string, unknown> | null =>
  payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null
