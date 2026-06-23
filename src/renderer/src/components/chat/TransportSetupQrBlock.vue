<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertCircle, Check, CheckCircle2, Clock3, RefreshCw } from 'lucide-vue-next'
import type { TransportSetupQrProjection } from '@shared/agent-runtime'
import {
  resolveTransportSetupQrImageSource,
  resolveTransportSetupQrTiming
} from '../../utils/transport-setup-qr'

const props = withDefaults(
  defineProps<{
    qr: TransportSetupQrProjection
    showRegenerate?: boolean
  }>(),
  {
    showRegenerate: true
  }
)

const emit = defineEmits<{
  (e: 'regenerate', payload: TransportSetupQrProjection): void
}>()

const now = ref(Date.now())
const imageSource = ref('')
let timer: number | null = null
let imageResolveVersion = 0
let mounted = false

const timing = computed(() => resolveTransportSetupQrTiming(props.qr, now.value))
const effectiveStatus = computed(() => timing.value.effectiveStatus)
const remainingLabel = computed(() => timing.value.remainingLabel)

const title = computed(() => {
  switch (effectiveStatus.value) {
    case 'completed':
      return '账号接入成功'
    case 'scanned':
      return '已扫码，待确认'
    case 'expired':
      return '二维码已过期'
    case 'failed':
      return '登录失败'
    case 'cancelled':
      return '已取消'
    default:
      return '微信扫码登录'
  }
})

const description = computed(() => {
  switch (effectiveStatus.value) {
    case 'completed':
      return '已完成账号接入'
    case 'scanned':
      return '请在手机微信上点击确认'
    case 'expired':
      return '请重新生成后扫码'
    case 'failed':
    case 'cancelled':
      return '请尝试重新生成二维码'
    default:
      return remainingLabel.value
        ? `请扫码登录，剩余 ${remainingLabel.value}`
        : '请使用手机微信扫码'
  }
})

const canRegenerate = computed(() => timing.value.canRegenerate)
const shouldShowRegenerate = computed(() => props.showRegenerate && canRegenerate.value)

const refreshImageSource = async (): Promise<void> => {
  const version = ++imageResolveVersion
  const nextSource = await resolveTransportSetupQrImageSource(props.qr).catch(() => '')
  if (version === imageResolveVersion) imageSource.value = nextSource
}

const tick = (): void => {
  now.value = Date.now()
}

const stopTimer = (): void => {
  if (timer == null) return
  window.clearInterval(timer)
  timer = null
}

const startTimer = (): void => {
  if (timer != null) return
  timer = window.setInterval(tick, 1000)
}

const syncTimer = (): void => {
  if (!mounted) return
  if (timing.value.shouldTick) startTimer()
  else stopTimer()
}

const onRegenerate = (): void => {
  emit('regenerate', props.qr)
}

// const logTimingSnapshot = (source: string, previousStatus?: string): void => {
//   const snapshot = timing.value
// console.info('[transport-setup-qr:timing]', {
//   source,
//   previousStatus: previousStatus ?? null,
//   status: props.qr.status ?? 'active',
//   effectiveStatus: snapshot.effectiveStatus,
//   sessionId: props.qr.sessionId,
//   transportId: props.qr.transportId,
//   accountId: props.qr.accountId,
//   methodId: props.qr.methodId,
//   startedAt: props.qr.startedAt ?? null,
//   expiresAt: props.qr.expiresAt ?? null,
//   now: new Date(now.value).toISOString(),
//   remainingMs: snapshot.remainingMs,
//   remainingLabel: snapshot.remainingLabel,
//   shouldTick: snapshot.shouldTick
// })
// }

watch(
  () => [props.qr.sessionId, props.qr.imageUrl, props.qr.qrText],
  () => {
    void refreshImageSource()
  },
  { immediate: true }
)

watch(
  () => [props.qr.sessionId, props.qr.startedAt, props.qr.expiresAt, props.qr.status],
  () => {
    tick()
    syncTimer()
  }
)

watch(
  () => timing.value.shouldTick,
  () => {
    syncTimer()
  }
)

// watch(
//   () => effectiveStatus.value,
//   (nextStatus, previousStatus) => {
//     if (nextStatus === previousStatus) return
//     logTimingSnapshot('effective-status-change', previousStatus)
//   },
//   { immediate: true }
// )

onMounted(() => {
  mounted = true
  tick()
  syncTimer()
})

onBeforeUnmount(() => {
  mounted = false
  stopTimer()
})
</script>

<template>
  <div
    class="w-86 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-content)/75 px-3 py-3 shadow-sm"
  >
    <div class="flex gap-3">
      <div
        class="relative h-38 w-38 shrink-0 overflow-hidden rounded-lg border border-black/8 bg-white p-2"
      >
        <img
          v-if="imageSource"
          :src="imageSource"
          alt="微信登录二维码"
          class="h-full w-full object-contain"
          :class="{
            'opacity-25 grayscale': effectiveStatus === 'expired' || effectiveStatus === 'completed'
          }"
        />
        <div
          v-else
          class="flex h-full w-full items-center justify-center text-xs font-medium text-(--theme-text-dim)"
        >
          生成中
        </div>
        <div
          v-if="effectiveStatus === 'completed'"
          aria-label="成功接入"
          class="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-[1px]"
        >
          <div
            class="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-lg"
          >
            <Check :size="32" class="text-emerald-500 stroke-3" />
          </div>
          <span class="text-sm font-medium text-white drop-shadow-sm">成功接入</span>
        </div>
        <div
          v-if="effectiveStatus === 'expired'"
          class="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-semibold text-(--theme-text-main)"
        >
          已过期
        </div>
      </div>

      <div class="flex min-w-0 flex-1 flex-col justify-between py-1">
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-1.5 text-sm font-semibold text-(--theme-text-main)">
            <CheckCircle2
              v-if="effectiveStatus === 'completed'"
              :size="15"
              class="text-emerald-600"
            />
            <AlertCircle
              v-else-if="effectiveStatus === 'expired' || effectiveStatus === 'failed'"
              :size="15"
              class="text-amber-600"
            />
            <Clock3 v-else :size="15" class="text-(--theme-text-dim)" />
            <span class="truncate">{{ title }}</span>
          </div>
          <div class="text-[11px] leading-relaxed text-(--theme-text-dim)">
            {{ description }}
          </div>
        </div>

        <div class="flex flex-col items-center mt-2">
          <button
            v-if="shouldShowRegenerate"
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3.5 text-xs font-medium text-(--theme-text-main) transition-colors hover:bg-(--theme-bg-hover-btn)"
            @click="onRegenerate"
          >
            <RefreshCw :size="13" />
            <span>重新生成</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
