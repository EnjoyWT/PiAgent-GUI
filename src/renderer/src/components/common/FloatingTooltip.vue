<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  text: string
  left: number
  top: number
  placement?: 'top' | 'bottom'
  offsetX?: number
  offsetY?: number
  variant?: 'default' | 'compact'
  interactive?: boolean
  mode?: 'default' | 'list'
}>()

const emit = defineEmits<{
  (e: 'mouseleave'): void
  (e: 'mouseenter'): void
}>()

const VIEWPORT_PADDING = 8

const tooltipRef = ref<HTMLElement | null>(null)
const resolvedLeft = ref(0)

const lines = computed(() => (props.text || '').split('\n'))

const placement = computed(() => props.placement ?? 'top')
const offsetX = computed(() => (Number.isFinite(props.offsetX) ? (props.offsetX as number) : 0))
const offsetY = computed(() => (Number.isFinite(props.offsetY) ? (props.offsetY as number) : 0))
const anchorLeft = computed(() => props.left + offsetX.value)
const baseY = computed(() => (placement.value === 'bottom' ? '0%' : '-100%'))
const enterY = computed(() => (placement.value === 'bottom' ? '20%' : '-80%'))
const variant = computed(() => props.variant ?? 'default')
const isCompact = computed(() => variant.value === 'compact')
const interactive = computed(() => props.interactive !== false)
const mode = computed(() => props.mode ?? 'default')

const clampHorizontalPosition = async (): Promise<void> => {
  resolvedLeft.value = anchorLeft.value
  if (!props.visible) return

  await nextTick()
  const el = tooltipRef.value
  if (!el) return

  const { width } = el.getBoundingClientRect()
  const half = width / 2
  const min = VIEWPORT_PADDING + half
  const max = window.innerWidth - VIEWPORT_PADDING - half
  if (max < min) return

  resolvedLeft.value = Math.min(Math.max(anchorLeft.value, min), max)
}

watch(
  () => [props.visible, anchorLeft.value, props.top, props.text, props.variant] as const,
  ([visible]) => {
    if (visible) void clampHorizontalPosition()
  },
  { flush: 'post' }
)

const handleViewportChange = () => {
  if (props.visible) void clampHorizontalPosition()
}

onMounted(() => {
  window.addEventListener('resize', handleViewportChange)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleViewportChange)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="floating-tooltip">
      <div
        v-if="visible"
        ref="tooltipRef"
        class="fixed z-9999 capability-tooltip-panel"
        :class="isCompact ? 'tooltip--compact' : ''"
        :style="{
          left: `${resolvedLeft}px`,
          top: `${props.top + offsetY}px`,
          transform: 'translate(-50%, var(--ft-base-y))',
          '--ft-base-y': baseY,
          '--ft-enter-y': enterY,
          pointerEvents: interactive ? 'auto' : 'none'
        }"
        @mouseenter="interactive ? emit('mouseenter') : undefined"
        @mouseleave="interactive ? emit('mouseleave') : undefined"
      >
        <div v-if="mode === 'list'" class="tooltip-inner">
          <div
            v-if="lines.length > 0"
            class="tooltip-body tooltip-muted leading-snug"
            :class="isCompact ? 'text-[10px]' : 'text-[11px]'"
          >
            <div
              v-for="(line, index) in lines.filter((line) => line !== '')"
              :key="`${index}-${line}`"
              class="tooltip-line"
            >
              {{ line }}
            </div>
          </div>
        </div>
        <div v-else class="tooltip-inner">
          <div
            v-if="lines.length > 0 && lines[0]"
            class="tooltip-title leading-snug"
            :class="isCompact ? 'text-[11px] font-medium' : 'text-[12px] font-semibold'"
          >
            {{ lines[0] }}
          </div>
          <div
            v-if="lines.length > 1 && lines[1]"
            class="mt-0.5 leading-snug pb-0.5 tooltip-path tooltip-muted"
            :class="isCompact ? 'text-[10px]' : 'text-[11px]'"
          >
            {{ lines[1] }}
          </div>
          <div
            v-if="lines.length > 2"
            class="mt-0.5 leading-snug tooltip-muted"
            :class="isCompact ? 'text-[10px]' : 'text-[11px]'"
          >
            {{ lines.slice(2).join(' ') }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.capability-tooltip-panel {
  border: 1px solid var(--theme-border-base);
  border-radius: 0.7rem;
  background: color-mix(in srgb, var(--theme-bg-sidebar) 94%, var(--theme-bg-content));
  color: var(--theme-text-main);
  padding: 0.45rem 0.7rem;
  width: max-content;
  max-width: min(260px, calc(100vw - 16px));
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.26),
    0 1px 0 color-mix(in srgb, var(--theme-text-bright) 6%, transparent) inset;
  word-break: normal;
  backdrop-filter: saturate(160%) blur(8px);
}

.tooltip--compact {
  padding: 0.35rem 0.55rem;
  max-width: min(220px, calc(100vw - 16px));
}

.tooltip-inner {
  display: flex;
  flex-direction: column;
}

.tooltip-inner > div {
  line-height: 1.5;
}

.tooltip-title {
  color: var(--theme-text-bright);
}

.tooltip-muted {
  color: var(--theme-text-dim);
}

.tooltip-body {
  max-height: 180px;
  overflow-y: auto;
  padding-right: 2px;
}

.tooltip-line {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.tooltip-path {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.floating-tooltip-enter-active,
.floating-tooltip-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}

.floating-tooltip-enter-from,
.floating-tooltip-leave-to {
  opacity: 0;
  transform: translate(-50%, var(--ft-enter-y));
}

.floating-tooltip-enter-to,
.floating-tooltip-leave-from {
  opacity: 1;
  transform: translate(-50%, var(--ft-base-y));
}
</style>
