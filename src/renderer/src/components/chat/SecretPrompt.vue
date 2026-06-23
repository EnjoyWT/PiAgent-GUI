<script setup lang="ts">
import { ref, watch } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'
import type { SecretPromptParams } from '@shared/secret-input'

const props = defineProps<{
  secret: SecretPromptParams
}>()

const emit = defineEmits<{
  (e: 'submit', value: string): void
}>()

const value = ref('')
const isSecretVisible = ref(false)

watch(
  () => props.secret.secretId,
  () => {
    value.value = ''
    isSecretVisible.value = false
  }
)

const submit = (): void => {
  const normalized = value.value.trim()
  if (!normalized) return
  emit('submit', normalized)
  value.value = ''
  isSecretVisible.value = false
}
</script>

<template>
  <div
    class="mb-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-4 shadow-[0_6px_18px_rgba(15,23,42,0.06)]"
  >
    <div class="text-[13px] font-semibold text-amber-900">
      {{ secret.title || '安全输入' }}
    </div>
    <div class="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-amber-950/80">
      {{ secret.prompt }}
    </div>

    <div class="mt-4 flex items-center gap-3">
      <div class="relative min-w-0 flex-1">
        <input
          v-model="value"
          :type="isSecretVisible ? 'text' : 'password'"
          class="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 pr-10 text-[13px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-200"
          :placeholder="secret.placeholder || '不会回显到对话'"
          @keydown.enter.prevent="submit"
        />
        <button
          type="button"
          class="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-amber-700/70 transition-colors hover:bg-amber-100 hover:text-amber-900 cursor-pointer"
          :aria-label="isSecretVisible ? '隐藏输入内容' : '显示输入内容'"
          :title="isSecretVisible ? '隐藏' : '显示'"
          @click="isSecretVisible = !isSecretVisible"
        >
          <Eye v-if="!isSecretVisible" :size="16" />
          <EyeOff v-else :size="16" />
        </button>
      </div>
      <button
        type="button"
        class="inline-flex shrink-0 items-center rounded-xl bg-amber-500 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-amber-600 cursor-pointer"
        @click="submit"
      >
        {{ secret.confirmLabel || '提交' }}
      </button>
    </div>
  </div>
</template>
