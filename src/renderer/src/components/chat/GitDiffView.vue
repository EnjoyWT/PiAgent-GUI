<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import '@git-diff-view/vue/styles/diff-view-pure.css'
import { DiffModeEnum, DiffView } from '@git-diff-view/vue'

const props = withDefaults(
  defineProps<{
    diff: string
    maxHeight?: number
  }>(),
  {
    maxHeight: 360
  }
)

const hunks = computed((): string[] => {
  const raw = (props.diff ?? '').replace(/\r\n/g, '\n')
  if (!raw.trim()) return []
  const lines = raw.split('\n')
  const hunkStarts: number[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('@@')) hunkStarts.push(i)
  }
  if (hunkStarts.length === 0) return []

  const header = lines.slice(0, hunkStarts[0]).join('\n').trimEnd()
  const result: string[] = []
  for (let i = 0; i < hunkStarts.length; i += 1) {
    const start = hunkStarts[i]
    const end = i + 1 < hunkStarts.length ? hunkStarts[i + 1] : lines.length
    const body = lines.slice(start, end).join('\n')
    result.push(i === 0 && header ? `${header}\n${body}` : body)
  }
  return result
})

const currentTheme = ref<'light' | 'dark'>('light')
let observer: MutationObserver | null = null

onMounted(() => {
  const updateTheme = () => {
    const theme = document.documentElement.getAttribute('data-theme')
    currentTheme.value = theme === 'solarized-dark' || theme === 'dark' ? 'dark' : 'light'
  }
  updateTheme()
  observer = new MutationObserver(updateTheme)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<template>
  <div
    v-if="hunks.length > 0"
    class="pi-git-diff"
    :style="{ '--pi-diff-max-h': `${props.maxHeight}px` }"
  >
    <DiffView
      class="diff-tailwindcss-wrapper"
      :data="{ hunks }"
      :diff-view-mode="DiffModeEnum.Unified"
      :diff-view-theme="currentTheme"
      :diff-view-font-size="12"
      :diff-view-highlight="true"
      :diff-view-wrap="false"
    />
  </div>
</template>

<style scoped>
.pi-git-diff :deep(.diff-table-scroll-container) {
  max-height: var(--pi-diff-max-h, 360px);
  overflow-y: auto !important;
  overscroll-behavior: contain;
}

.pi-git-diff :deep(.diff-line-old-num),
.pi-git-diff :deep(.diff-line-new-num),
.pi-git-diff :deep(.diff-line-num) {
  padding-left: 6px !important;
  padding-right: 6px !important;
}

.pi-git-diff :deep(.unified-diff-table-num-col) {
  /*
   * Unified mode shows old + new line numbers inside one cell, so the column
   * needs room for both. We keep the library's computed aside width but remove
   * its extra +5px padding multiplier.
   */
  width: calc(var(--diff-aside-width--)) !important;
}

.pi-git-diff :deep(.diff-line-hunk-action) {
  /* This cell has a library `min-w-[100px]` plus inline width; neutralize both. */
  width: 0 !important;
  min-width: 10px !important;
  max-width: none !important;
}

.pi-git-diff :deep(.diff-line-num) {
  /* Let the colgroup width win over the library inline widths/min-widths. */
  width: 0 !important;
  min-width: 0 !important;
  max-width: none !important;
}
</style>
