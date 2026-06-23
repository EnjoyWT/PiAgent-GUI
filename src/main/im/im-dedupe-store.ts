import type { ImInboundEnvelope } from './im-inbound-types.ts'

export type ImDedupeDecision =
  | {
      accepted: true
      dedupeKey: string
    }
  | {
      accepted: false
      dedupeKey: string
      existingTraceId: string
      reason: 'duplicate_dedupe_key'
    }

export class ImDedupeStore {
  private readonly traceIdByDedupeKey = new Map<string, string>()

  accept(envelope: Pick<ImInboundEnvelope, 'dedupeKey' | 'imTraceId'>): ImDedupeDecision {
    const existingTraceId = this.traceIdByDedupeKey.get(envelope.dedupeKey)
    if (existingTraceId) {
      return {
        accepted: false,
        dedupeKey: envelope.dedupeKey,
        existingTraceId,
        reason: 'duplicate_dedupe_key'
      }
    }

    this.traceIdByDedupeKey.set(envelope.dedupeKey, envelope.imTraceId)
    return {
      accepted: true,
      dedupeKey: envelope.dedupeKey
    }
  }
}
