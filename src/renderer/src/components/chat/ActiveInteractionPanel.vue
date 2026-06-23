<script setup lang="ts">
import QuestionPrompt from './QuestionPrompt.vue'
import QuestionnairePrompt from './QuestionnairePrompt.vue'
import SecretPrompt from './SecretPrompt.vue'
import type { QuestionToolParams } from '@shared/question-tool'
import type { PendingQuestionnaire } from '@shared/questionnaire-tool'
import type { SecretPromptParams } from '@shared/secret-input'

defineProps<{
  question: QuestionToolParams | null
  questionnaire: PendingQuestionnaire | null
  secret: SecretPromptParams | null
}>()

const emit = defineEmits<{
  (e: 'question-answer-option', optionId: string): void
  (e: 'questionnaire-answer-option', optionId: string): void
  (e: 'secret-submit', value: string): void
}>()
</script>

<template>
  <div v-if="questionnaire || secret || question" class="relative">
    <QuestionnairePrompt
      v-if="questionnaire"
      :questionnaire="questionnaire"
      @answer-option="emit('questionnaire-answer-option', $event)"
    />

    <SecretPrompt v-else-if="secret" :secret="secret" @submit="emit('secret-submit', $event)" />

    <QuestionPrompt
      v-else-if="question"
      :question="question"
      @answer-option="emit('question-answer-option', $event)"
    />
  </div>
</template>
