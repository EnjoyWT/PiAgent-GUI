<script setup lang="ts">
import type { MessageRenderBlock } from './flow-blocks'

type AnswerBlock = Extract<MessageRenderBlock, { kind: 'question_answer' | 'questionnaire_answer' }>

defineProps<{
  block: AnswerBlock
}>()
</script>

<template>
  <div class="w-full flex justify-end">
    <div class="group w-full min-w-0 flex flex-col items-end">
      <div
        class="w-fit self-end rounded-xl border bg-(--theme-bg-user-content) border-(--theme-border-user-content) px-2.25 py-1 max-w-[78%]"
      >
        <div
          class="prose prose-sm max-w-none text-sm text-(--theme-text-user) whitespace-pre-wrap leading-relaxed"
          v-text="block.text"
        />
      </div>
    </div>
  </div>
</template>
