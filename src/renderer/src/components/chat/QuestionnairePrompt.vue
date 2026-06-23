<script setup lang="ts">
import { computed } from 'vue'
import type { PendingQuestionnaire } from '@shared/questionnaire-tool'

const props = defineProps<{
  questionnaire: PendingQuestionnaire
}>()

const emit = defineEmits<{
  (e: 'answer-option', optionId: string): void
}>()

const currentQuestion = computed(
  () => props.questionnaire.questionnaire.questions[props.questionnaire.currentStepIndex] ?? null
)

const panelTitle = computed(() => {
  const question = currentQuestion.value
  return question?.title?.trim() || props.questionnaire.questionnaire.title?.trim() || '问卷'
})
</script>

<template>
  <div
    v-if="currentQuestion"
    class="mb-3 max-h-[80vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_6px_18px_rgba(15,23,42,0.06)]"
  >
    <div class="text-[13px] font-semibold text-slate-800">
      {{ panelTitle }}
    </div>
    <div class="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-slate-700">
      {{ currentQuestion.prompt }}
    </div>

    <div v-if="(currentQuestion.options?.length ?? 0) > 0" class="mt-4 flex flex-wrap gap-3">
      <button
        v-for="option in currentQuestion.options ?? []"
        :key="option.id"
        type="button"
        class="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 cursor-pointer"
        @click="emit('answer-option', option.id)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
