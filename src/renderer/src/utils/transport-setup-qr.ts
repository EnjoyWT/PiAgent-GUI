import { toDataURL } from 'qrcode'
import type { TransportSetupQrProjection } from '@shared/agent-runtime'
import type {
  TransportPluginAccountSetupEvent,
  TransportPluginAccountSetupStartResult
} from '@shared/transport-plugins'

const DATA_IMAGE_PREFIX = /^data:image\//i
type TransportSetupQrEffectiveStatus = NonNullable<TransportSetupQrProjection['status']>

const normalize = (value?: string): string => (value ?? '').trim()

const isImageDataUrl = (value: string): boolean => DATA_IMAGE_PREFIX.test(value)

const parseTimeMs = (value?: string): number | null => {
  const normalized = normalize(value)
  if (!normalized) return null
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const formatRemainingLabel = (remainingMs: number | null): string => {
  if (remainingMs == null) return ''
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export const resolveTransportSetupQrPayload = (qr: TransportSetupQrProjection): string => {
  const imageUrl = normalize(qr.imageUrl)
  if (imageUrl && !isImageDataUrl(imageUrl)) return imageUrl
  return normalize(qr.qrText) || imageUrl
}

export const resolveTransportSetupQrImageSource = async (
  qr: TransportSetupQrProjection
): Promise<string> => {
  const imageUrl = normalize(qr.imageUrl)
  if (isImageDataUrl(imageUrl)) return imageUrl

  const payload = resolveTransportSetupQrPayload(qr)
  if (!payload) return ''

  return toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: {
      dark: '#111827',
      light: '#ffffff'
    }
  })
}

export const resolveTransportPluginSetupQrImageSource = async (
  event: TransportPluginAccountSetupEvent | null | undefined
): Promise<string> => {
  if (!event || event.type !== 'qr') return ''

  return resolveTransportSetupQrImageSource({
    transportId: event.pluginId ?? '',
    accountId: event.accountId ?? '',
    methodId: event.methodId ?? '',
    sessionId: event.sessionId,
    imageUrl: normalize(event.qrImageDataUrl) || normalize(event.qrUrl),
    qrText: event.qrText
  })
}

const resolveTransportPluginSetupQrStatus = (
  event: TransportPluginAccountSetupEvent | null | undefined
): TransportSetupQrEffectiveStatus | undefined => {
  if (!event) return undefined
  if (event.type === 'qr') return 'active'
  if (event.type === 'completed') return 'completed'
  if (event.type === 'expired') return 'expired'
  if (event.type === 'failed') return 'failed'

  switch (event.state) {
    case 'waiting_scan':
      return 'active'
    case 'scanned':
    case 'waiting_confirm':
      return 'scanned'
    case 'completed':
      return 'completed'
    case 'expired':
      return 'expired'
    case 'cancelled':
      return 'cancelled'
    case 'failed':
      return 'failed'
    default:
      return undefined
  }
}

export const resolveTransportPluginSetupQrProjection = (
  session: TransportPluginAccountSetupStartResult | null | undefined,
  qrEvent: TransportPluginAccountSetupEvent | null | undefined,
  latestEvent: TransportPluginAccountSetupEvent | null | undefined
): TransportSetupQrProjection | null => {
  const qr = qrEvent?.type === 'qr' ? qrEvent : null
  const sessionId = normalize(qr?.sessionId) || normalize(session?.sessionId)
  if (!sessionId) return null

  return {
    transportId: normalize(qr?.pluginId) || normalize(session?.pluginId),
    accountId: normalize(qr?.accountId) || normalize(session?.accountId),
    methodId: normalize(qr?.methodId) || normalize(session?.methodId),
    sessionId,
    imageUrl: normalize(qr?.qrImageDataUrl) || normalize(qr?.qrUrl),
    qrText: normalize(qr?.qrText) || undefined,
    startedAt: normalize(session?.startedAt) || undefined,
    expiresAt: normalize(qr?.expiresAt) || normalize(session?.expiresAt ?? undefined) || undefined,
    status: resolveTransportPluginSetupQrStatus(latestEvent)
  }
}

export const resolveTransportSetupQrTiming = (
  qr: TransportSetupQrProjection,
  nowMs = Date.now()
): {
  startedAtMs: number | null
  expiresAtMs: number | null
  elapsedMs: number | null
  totalMs: number | null
  remainingMs: number | null
  remainingLabel: string
  effectiveStatus: TransportSetupQrEffectiveStatus
  shouldTick: boolean
  canRegenerate: boolean
} => {
  const startedAtMs = parseTimeMs(qr.startedAt)
  const expiresAtMs = parseTimeMs(qr.expiresAt)
  const status = qr.status ?? 'active'
  const remainingMs = expiresAtMs == null ? null : Math.max(0, expiresAtMs - nowMs)
  const isExpiredByClock =
    expiresAtMs != null && remainingMs === 0 && (status === 'active' || status === 'scanned')
  const effectiveStatus: TransportSetupQrEffectiveStatus = isExpiredByClock ? 'expired' : status
  const elapsedMs = startedAtMs == null ? null : Math.max(0, nowMs - startedAtMs)
  const totalMs =
    startedAtMs == null || expiresAtMs == null ? null : Math.max(0, expiresAtMs - startedAtMs)
  const shouldTick =
    (effectiveStatus === 'active' || effectiveStatus === 'scanned') &&
    expiresAtMs != null &&
    remainingMs != null &&
    remainingMs > 0

  return {
    startedAtMs,
    expiresAtMs,
    elapsedMs,
    totalMs,
    remainingMs,
    remainingLabel: formatRemainingLabel(remainingMs),
    effectiveStatus,
    shouldTick,
    canRegenerate: ['expired', 'failed', 'cancelled'].includes(effectiveStatus)
  }
}
