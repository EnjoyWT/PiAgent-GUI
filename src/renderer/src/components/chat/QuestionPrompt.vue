<script setup lang="ts">
import type { QuestionToolParams } from '@shared/question-tool'

const props = defineProps<{
  question: QuestionToolParams
}>()

const emit = defineEmits<{
  (e: 'answer-option', optionId: string): void
}>()
</script>

<template>
  <div v-if="(question.options?.length ?? 0) > 0" class="mb-2 pb-2">
    <div class="flex flex-wrap gap-3">
      <button
        v-for="option in question.options ?? []"
        :key="option.id"
        type="button"
        class="inline-flex h-7.5 items-center rounded-full border border-gray-300 bg-white/80 px-3 text-[12px] font-medium text-gray-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-gray-50 hover:border-gray-400 cursor-pointer"
        @click="emit('answer-option', option.id)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
