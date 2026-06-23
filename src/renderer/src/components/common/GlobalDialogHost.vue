<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { AlertTriangle, Info } from 'lucide-vue-next'
import { globalDialog } from '../../utils/dialog'

const state = globalDialog.state

const isConfirm = computed(() => state.kind === 'confirm')
const icon = computed(() => (state.danger ? AlertTriangle : Info))

const confirmBtnRef = ref<HTMLButtonElement | null>(null)

const handleClose = (result: boolean) => globalDialog.close(result)
const handleBackdrop = () => {
  // Backdrop closes like "cancel" for confirm, "ok" for alert.
  handleClose(isConfirm.value ? false : true)
}

const onKeydown = (e: KeyboardEvent) => {
  if (!state.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    handleClose(isConfirm.value ? false : true)
  }
}

watch(
  () => state.open,
  async (open) => {
    if (!open) return
    await nextTick()
    confirmBtnRef.value?.focus()
  }
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="global-dialog-fade">
      <div
        v-if="state.open"
        class="fixed inset-0 z-100 flex items-center justify-center bg-black/40 px-4"
        @mousedown.self="handleBackdrop"
      >
        <div
          class="w-full max-w-130 rounded-2xl border border-(--theme-border-base) bg-(--theme-bg-main) shadow-[0_30px_80px_rgba(0,0,0,0.5)] overflow-hidden"
          role="dialog"
          aria-modal="true"
          :aria-label="state.title"
        >
          <div class="flex items-start gap-3 px-5 pt-5">
            <div
              class="mt-0.5 h-9 w-9 shrink-0 rounded-xl flex items-center justify-center"
              :class="
                state.danger
                  ? 'bg-rose-500/10 text-rose-500'
                  : 'bg-(--theme-accent)/10 text-(--theme-accent)'
              "
            >
              <component :is="icon" :size="18" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-[15px] font-semibold text-(--theme-text-bright)">
                {{ state.title }}
              </div>
              <div
                class="mt-1 text-[13px] text-(--theme-text-main) whitespace-pre-wrap wrap-break-word"
              >
                {{ state.message }}
              </div>
              <div
                v-if="state.detail"
                class="mt-3 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-content) px-3 py-2 font-mono text-[11px] text-(--theme-text-main) whitespace-pre-wrap wrap-break-word"
              >
                {{ state.detail }}
              </div>
            </div>
          </div>

          <div class="mt-5 flex items-center justify-end gap-2 px-5 pb-5">
            <button
              v-if="isConfirm"
              type="button"
              class="h-9 px-4 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) text-[13px] text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)"
              @click="handleClose(false)"
            >
              {{ state.cancelText }}
            </button>
            <button
              ref="confirmBtnRef"
              type="button"
              class="h-9 px-4 rounded-xl text-[13px] font-semibold text-white"
              :class="
                state.danger
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-(--theme-accent) hover:opacity-90'
              "
              @click="handleClose(true)"
            >
              {{ state.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.global-dialog-fade-enter-active,
.global-dialog-fade-leave-active {
  transition: opacity 0.12s ease;
}

.global-dialog-fade-enter-from,
.global-dialog-fade-leave-to {
  opacity: 0;
}
</style>
