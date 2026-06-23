import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { resolveTransportSetupQrImageSource } =
  await import('../../../src/renderer/src/utils/transport-setup-qr.ts')
const { resolveTransportPluginSetupQrImageSource } =
  await import('../../../src/renderer/src/utils/transport-setup-qr.ts')
const { resolveTransportPluginSetupQrProjection } =
  await import('../../../src/renderer/src/utils/transport-setup-qr.ts')
const { resolveTransportSetupQrTiming } =
  await import('../../../src/renderer/src/utils/transport-setup-qr.ts')

test('uses provided image data URL directly for transport setup QR', async () => {
  const source = await resolveTransportSetupQrImageSource({
    transportId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login',
    sessionId: 'setup-1',
    imageUrl: 'data:image/png;base64,abc',
    qrText: 'token'
  })

  assert.equal(source, 'data:image/png;base64,abc')
})

test('generates a renderable QR image when plugin provides a URL instead of image data', async () => {
  const source = await resolveTransportSetupQrImageSource({
    transportId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login',
    sessionId: 'setup-1',
    imageUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
    qrText: 'abc'
  })

  assert.match(source, /^data:image\/png;base64,/)
})

test('resolves plugin setup QR URL events to renderable image data URLs', async () => {
  const source = await resolveTransportPluginSetupQrImageSource({
    type: 'qr',
    pluginId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login',
    sessionId: 'setup-1',
    qrImageDataUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
    qrText: 'abc',
    expiresAt: '2026-04-30T03:06:00.000Z'
  })

  assert.match(source, /^data:image\/png;base64,/)
  assert.notEqual(source, 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3')
})

test('maps plugin setup events to shared QR card projection statuses', () => {
  const session = {
    pluginId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login',
    sessionId: 'setup-1',
    startedAt: '2026-04-30T03:00:00.000Z',
    expiresAt: '2026-04-30T03:06:00.000Z'
  }
  const qrEvent = {
    type: 'qr' as const,
    pluginId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login',
    sessionId: 'setup-1',
    qrImageDataUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
    qrText: 'abc',
    expiresAt: '2026-04-30T03:06:00.000Z'
  }

  const scanned = resolveTransportPluginSetupQrProjection(session, qrEvent, {
    type: 'status',
    pluginId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login',
    sessionId: 'setup-1',
    state: 'waiting_confirm',
    message: 'Waiting for QR scan.'
  })

  assert.equal(scanned?.status, 'scanned')
  assert.equal(scanned?.imageUrl, 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3')
  assert.equal(scanned?.qrText, 'abc')
  assert.equal(scanned?.startedAt, '2026-04-30T03:00:00.000Z')
  assert.equal(scanned?.expiresAt, '2026-04-30T03:06:00.000Z')

  const completed = resolveTransportPluginSetupQrProjection(session, qrEvent, {
    type: 'completed',
    pluginId: 'wechat',
    accountId: 'default',
    methodId: 'wechat_qr_login',
    sessionId: 'setup-1',
    config: {}
  })

  assert.equal(completed?.status, 'completed')
})

test('IM settings QR block uses shared QR card without card regenerate action', () => {
  const componentSource = readFileSync(
    new URL(
      '../../../src/renderer/src/windows/settings/components/ImSettings.vue',
      import.meta.url
    ),
    'utf8'
  )

  assert.match(componentSource, /import TransportSetupQrBlock/)
  assert.match(componentSource, /<TransportSetupQrBlock[\s\S]*:show-regenerate="false"/)
  assert.match(componentSource, /setupQrProjection/)
  assert.doesNotMatch(
    componentSource,
    /class="rounded-lg border px-3 py-2 font-semibold"[\s\S]*setupStatusLabel/
  )
})

test('transport QR card can hide its regenerate button for settings usage', () => {
  const componentSource = readFileSync(
    new URL('../../../src/renderer/src/components/chat/TransportSetupQrBlock.vue', import.meta.url),
    'utf8'
  )

  assert.match(componentSource, /showRegenerate\?: boolean/)
  assert.match(componentSource, /shouldShowRegenerate/)
  assert.match(componentSource, /v-if="shouldShowRegenerate"/)
})

test('computes QR countdown from persisted absolute session times', () => {
  const timing = resolveTransportSetupQrTiming(
    {
      transportId: 'wechat',
      accountId: 'default',
      methodId: 'wechat_qr_login',
      sessionId: 'setup-1',
      imageUrl: 'data:image/png;base64,abc',
      startedAt: '2026-04-29T08:03:30.000Z',
      expiresAt: '2026-04-29T08:11:30.000Z',
      status: 'active'
    },
    Date.parse('2026-04-29T08:04:35.000Z')
  )

  assert.equal(timing.effectiveStatus, 'active')
  assert.equal(timing.remainingLabel, '06:55')
  assert.equal(timing.elapsedMs, 65_000)
  assert.equal(timing.totalMs, 480_000)
  assert.equal(timing.shouldTick, true)
})

test('does not keep ticking historical QR cards after their absolute expiry', () => {
  const timing = resolveTransportSetupQrTiming(
    {
      transportId: 'wechat',
      accountId: 'default',
      methodId: 'wechat_qr_login',
      sessionId: 'setup-1',
      imageUrl: 'data:image/png;base64,abc',
      startedAt: '2026-04-29T08:03:30.000Z',
      expiresAt: '2026-04-29T08:11:30.000Z',
      status: 'active'
    },
    Date.parse('2026-04-29T08:30:00.000Z')
  )

  assert.equal(timing.effectiveStatus, 'expired')
  assert.equal(timing.remainingMs, 0)
  assert.equal(timing.remainingLabel, '00:00')
  assert.equal(timing.shouldTick, false)
  assert.equal(timing.canRegenerate, true)
})

test('completed QR cards show a success badge over the QR area', () => {
  const componentSource = readFileSync(
    new URL('../../../src/renderer/src/components/chat/TransportSetupQrBlock.vue', import.meta.url),
    'utf8'
  )

  assert.match(componentSource, /v-if="effectiveStatus === 'completed'"/)
  assert.match(componentSource, /aria-label="成功接入"/)
  assert.match(componentSource, />\s*成功接入\s*</)
})
