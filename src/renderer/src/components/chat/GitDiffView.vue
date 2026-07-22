<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import '@git-diff-view/vue/styles/diff-view-pure.css'
import { DiffModeEnum, DiffView } from '@git-diff-view/vue'
import { buildDiffViewHunks } from './git-diff'

const props = withDefaults(
  defineProps<{
    diff: string
    filePath?: string
    maxHeight?: number
  }>(),
  {
    maxHeight: 360
  }
)

const hunks = computed((): string[] => {
  return buildDiffViewHunks({ diff: props.diff, filePath: props.filePath })
})

const rawDiff = computed(() => (props.diff ?? '').replace(/\r\n/g, '\n').trimEnd())

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
  <pre
    v-else-if="rawDiff.trim()"
    class="pi-git-diff-raw max-w-full overflow-auto rounded-md bg-(--theme-bg-main) px-2 py-1 text-[11px] leading-relaxed text-(--theme-text-main)"
    >{{ rawDiff }}</pre>
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
