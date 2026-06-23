<script setup lang="ts">
import { X } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    open: boolean
    'aria-label': string
    width?: 'sm' | 'md' | 'lg'
  }>(),
  {
    width: 'md'
  }
)

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="base-dialog-fade">
      <div v-if="open" class="base-dialog-overlay" @click.self="emit('close')">
        <div
          class="base-dialog-card"
          :class="{
            'base-dialog-card--sm': width === 'sm',
            'base-dialog-card--lg': width === 'lg'
          }"
          role="dialog"
          aria-modal="true"
          :aria-label="props['aria-label']"
        >
          <div class="mb-3 flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <slot name="header" />
            </div>
            <button
              type="button"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-(--theme-text-dim) hover:bg-(--theme-bg-hover-btn)"
              aria-label="关闭"
              @click="emit('close')"
            >
              <X :size="16" />
            </button>
          </div>

          <slot />

          <div v-if="$slots.footer" class="mt-4 flex justify-end">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.base-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.34);
  padding: 1.5rem;
  backdrop-filter: blur(8px);
}

.base-dialog-card {
  width: min(42rem, 100%);
  border: 1px solid var(--theme-border-base);
  border-radius: 1rem;
  background: var(--theme-bg-main);
  color: var(--theme-text-main);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.32);
  padding: 1.25rem;
}

.base-dialog-card--sm {
  width: min(28rem, 100%);
}

.base-dialog-card--lg {
  width: min(52rem, 100%);
}

.base-dialog-fade-enter-active,
.base-dialog-fade-leave-active {
  transition: opacity 160ms ease;
}

.base-dialog-fade-enter-active .base-dialog-card,
.base-dialog-fade-leave-active .base-dialog-card {
  transition:
    transform 160ms ease,
    opacity 160ms ease;
}

.base-dialog-fade-enter-from,
.base-dialog-fade-leave-to {
  opacity: 0;
}

.base-dialog-fade-enter-from .base-dialog-card,
.base-dialog-fade-leave-to .base-dialog-card {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
</style>
