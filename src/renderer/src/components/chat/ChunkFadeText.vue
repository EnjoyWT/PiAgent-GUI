<script setup lang="ts">
type FadeChunk = {
  id: string | number
  text: string
  fresh?: boolean
}

defineProps<{
  chunks: FadeChunk[]
}>()
</script>

<template>
  <div class="chunk-fade-text whitespace-pre-wrap wrap-break-word leading-relaxed">
    <span
      v-for="chunk in chunks"
      :key="chunk.id"
      class="chunk-fade-token"
      :class="{ 'chunk-fade-token-fresh': chunk.fresh }"
      >{{ chunk.text }}</span
    >
  </div>
</template>

<style scoped>
.chunk-fade-token {
  white-space: pre-wrap;
}

.chunk-fade-token-fresh {
  animation: chunk-fade-in 180ms ease-out;
}

@keyframes chunk-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
