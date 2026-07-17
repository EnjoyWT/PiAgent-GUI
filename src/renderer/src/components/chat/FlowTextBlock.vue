<script setup lang="ts">
import { computed } from 'vue'
import MarkdownContent from './MarkdownContent.vue'
import GitDiffView from './GitDiffView.vue'
import type { MessageRenderBlock } from './flow-blocks'

type TextOrQuestionBlock = Extract<
  MessageRenderBlock,
  { kind: 'text' | 'run_final_text' | 'questionnaire_question' }
>

const props = defineProps<{
  block: TextOrQuestionBlock
}>()

const getDisplayedContent = (): string => {
  return props.block.text
}

const isStreaming = (): boolean => 'isActive' in props.block && Boolean(props.block.isActive)

type DiffParts = { prefix: string; diff: string; suffix: string }

const tryExtractDiffParts = (raw: string): DiffParts | null => {
  const text = raw ?? ''
  if (!text.trim()) return null

  const fenceRe = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)\n?```/m
  const match = fenceRe.exec(text)
  if (match) {
    const lang = (match[1] ?? '').toLowerCase()
    const body = match[2] ?? ''
    const looksLikeDiff =
      lang === 'diff' ||
      lang === 'patch' ||
      /^diff --git /m.test(body) ||
      /^@@ /m.test(body) ||
      /^---\s+/m.test(body)
    if (looksLikeDiff && /^@@ /m.test(body)) {
      return {
        prefix: text.slice(0, match.index).trimEnd(),
        diff: body.trim(),
        suffix: text.slice(match.index + match[0].length).trimStart()
      }
    }
  }

  const looksLikeUnified =
    /^diff --git /m.test(text) ||
    (/^\---\s+/m.test(text) && /^\+\+\+\s+/m.test(text) && /^@@ /m.test(text)) ||
    /^@@ /m.test(text)
  if (!looksLikeUnified || !/^@@ /m.test(text)) return null
  return { prefix: '', diff: text.trim(), suffix: '' }
}

const diffParts = computed((): DiffParts | null => {
  return tryExtractDiffParts(getDisplayedContent())
})
</script>

<template>
  <div>
    <!-- 激活状态流式输出 -->
    <MarkdownContent
      v-if="isStreaming()"
      :content="getDisplayedContent()"
      :is-streaming="true"
      class="text-sm text-(--theme-text-main)"
    />

    <!-- 非激活状态：带 diff 块的文本 -->
    <template v-else-if="diffParts">
      <MarkdownContent
        v-if="diffParts.prefix"
        :content="diffParts.prefix"
        class="text-sm text-(--theme-text-main)"
      />
      <div class="my-2 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-content)/70 p-2">
        <GitDiffView :diff="diffParts.diff" />
      </div>
      <MarkdownContent
        v-if="diffParts.suffix"
        :content="diffParts.suffix"
        class="text-sm text-(--theme-text-main)"
      />
    </template>

    <!-- 非激活状态：普通文本 -->
    <MarkdownContent
      v-else
      :content="getDisplayedContent()"
      class="text-sm text-(--theme-text-main)"
    />
  </div>
</template>
