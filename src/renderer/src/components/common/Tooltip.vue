<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue'
import { useHoverIntent } from '@renderer/composables/useHoverIntent'

const props = defineProps<{
  text: string
  placement?: 'top' | 'bottom'
  offset?: number
  offsetX?: number
  maxWidth?: number
  multiline?: boolean
  hoverGroup?: string
}>()

const visible = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)

const style = ref({
  left: '0px',
  top: '0px',
  transform: ''
})
const tooltipStyle = computed(() => ({
  ...style.value,
  maxWidth: props.maxWidth ? `${props.maxWidth}px` : undefined
}))

const finalPlacement = ref<'top' | 'bottom'>('top')

const GAP = () => props.offset ?? 8

const show = async () => {
  if (visible.value) return
  visible.value = true
  await nextTick()
  updatePosition()
}

const hide = () => {
  visible.value = false
}

const hoverIntent = useHoverIntent({
  groupId: props.hoverGroup ?? 'tooltip-global',
  onOpen: () => void show(),
  onClose: hide,
  closeDelay: 100
})

const handleTriggerEnter = () => hoverIntent.enter()
const handleTriggerLeave = () => hoverIntent.close()
const handleTooltipEnter = () => hoverIntent.cancel()
const handleTooltipLeave = () => hoverIntent.close()

// ✅ 自动定位 + 自动翻转
const updatePosition = () => {
  if (!triggerRef.value || !tooltipRef.value) return

  const t = triggerRef.value.getBoundingClientRect()
  const tip = tooltipRef.value.getBoundingClientRect()

  let placement = props.placement ?? 'top'

  // 自动翻转
  if (placement === 'top' && t.top < tip.height + 10) {
    placement = 'bottom'
  } else if (placement === 'bottom' && window.innerHeight - t.bottom < tip.height + 10) {
    placement = 'top'
  }

  finalPlacement.value = placement

  const offsetX = props.offsetX ?? 0
  const PADDING = 8 // 距离屏幕边缘的最小间距

  // 1. 理想中心位置
  let left = t.left + t.width / 2 + offsetX - tip.width / 2
  let top = placement === 'top' ? t.top - GAP() : t.bottom + GAP()

  // 2. 限制左边界
  if (left < PADDING) {
    left = PADDING
  }

  // 3. 限制右边界
  if (left + tip.width > window.innerWidth - PADDING) {
    left = window.innerWidth - tip.width - PADDING
  }

  style.value = {
    left: `${left}px`,
    top: `${top}px`,
    transform: placement === 'top' ? 'translateY(-100%)' : 'translateY(0)'
  }
}

// ✅ 滚动 / resize 自适应
const handleUpdate = () => {
  if (visible.value) updatePosition()
}

onMounted(() => {
  window.addEventListener('scroll', handleUpdate, true)
  window.addEventListener('resize', handleUpdate)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleUpdate, true)
  window.removeEventListener('resize', handleUpdate)
})
</script>

<template>
  <!-- trigger -->
  <span
    ref="triggerRef"
    class="inline-flex"
    v-bind="$attrs"
    @mouseenter="handleTriggerEnter"
    @mouseleave="handleTriggerLeave"
  >
    <slot />
  </span>

  <!-- tooltip -->
  <Teleport to="body">
    <Transition name="tooltip-fade">
      <div
        v-if="visible"
        ref="tooltipRef"
        class="tooltip"
        :class="props.multiline ? 'tooltip--multiline' : ''"
        :style="tooltipStyle"
        @mouseenter="handleTooltipEnter"
        @mouseleave="handleTooltipLeave"
      >
        {{ text }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 🌟 主体样式（浅色卡片风格） */
.tooltip {
  position: fixed;
  z-index: 9999;

  background: var(--theme-bg-sidebar); /* 采用侧边栏色作为 Tooltip 背景 */
  color: var(--theme-text-main);

  font-size: 12px;
  line-height: 1.4;

  padding: 6px 10px;
  border-radius: 8px;

  border: 1px solid var(--theme-border-base);

  /* 更高级的阴影（分层） */
  box-shadow:
    0 8px 20px rgba(0, 0, 0, 0.2),
    0 2px 6px rgba(0, 0, 0, 0.1);

  white-space: nowrap;
  pointer-events: auto;

  backdrop-filter: saturate(180%) blur(2px);
}

.tooltip--multiline {
  white-space: pre-line;
  overflow-wrap: anywhere;
}

/* hover 微反馈（非常轻） */
.tooltip:hover {
  box-shadow:
    0 10px 26px rgba(0, 0, 0, 0.1),
    0 3px 8px rgba(0, 0, 0, 0.08);
}

/* 🎬 动画（克制、顺滑） */
.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
  /* 我们在 JS 中处理了 left，这里只需要处理 scale 和微小的 Y 轴偏移 */
  scale: 0.97;
}

.tooltip-fade-enter-to,
.tooltip-fade-leave-from {
  opacity: 1;
  scale: 1;
}
</style>
