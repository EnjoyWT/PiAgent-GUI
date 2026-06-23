<script setup lang="ts">
import { computed } from 'vue'
import { FileCode2 } from 'lucide-vue-next'
import type { ChatFileChange } from './types'

const props = defineProps<{
  change: ChatFileChange
}>()

const hasDiff = computed(() => Boolean(props.change.diff?.trim()))

const shortDiff = computed(() => {
  if (!props.change.diff) return ''
  const lines = props.change.diff.split('\n')
  return lines.slice(0, 16).join('\n')
})
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white/70 p-2">
    <div class="flex items-center justify-between gap-2 text-[11px]">
      <div class="min-w-0 flex items-center gap-1.5 text-gray-700">
        <FileCode2 :size="12" class="text-gray-500" />
        <span class="truncate font-medium">{{ change.path }}</span>
      </div>
      <div class="shrink-0 tabular-nums text-gray-500">
        <span v-if="change.addedLines" class="text-emerald-600">+{{ change.addedLines }}</span>
        <span v-if="change.removedLines" class="ml-1 text-rose-600"
          >-{{ change.removedLines }}</span
        >
      </div>
    </div>
    <pre
      v-if="hasDiff"
      class="mt-2 max-h-44 overflow-auto rounded-md bg-gray-900 p-2 text-[10px] leading-relaxed text-gray-100"
    ><code>{{ shortDiff }}</code></pre>
  </div>
</template>
