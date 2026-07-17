<script setup lang="ts">
import { Image as ImageIcon } from 'lucide-vue-next'
import type { MessageRenderBlock } from './flow-blocks'

type ToolImageBlock = Extract<MessageRenderBlock, { kind: 'tool_image' }>

defineProps<{
  block: ToolImageBlock
}>()

const emit = defineEmits<{
  (e: 'widget-layout-change'): void
}>()
</script>

<template>
  <div class="w-full py-1">
    <figure
      class="max-w-[min(720px,92vw)] overflow-hidden rounded-lg border border-(--theme-border-base) bg-(--theme-bg-content)/70"
    >
      <div
        class="flex items-center gap-1.5 border-b border-(--theme-border-base) px-2.5 py-1.5 text-[12px] text-(--theme-text-dim)"
      >
        <ImageIcon :size="14" class="shrink-0" />
        <span class="truncate">{{ block.image.title }}</span>
        <span
          v-if="block.image.width && block.image.height"
          class="ml-auto shrink-0 tabular-nums"
        >
          {{ block.image.width }}×{{ block.image.height }}
        </span>
      </div>
      <img
        :src="block.image.url"
        :alt="block.image.title"
        class="block h-auto max-h-[520px] w-full object-contain"
        loading="lazy"
        @load="emit('widget-layout-change')"
      />
    </figure>
  </div>
</template>
