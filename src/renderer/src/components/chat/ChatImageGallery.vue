<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import type { ChatImageBlock } from './types'
import { getChatImageAssetUrl } from '../../utils/chat-image-assets'

const props = defineProps<{
  images: ChatImageBlock[]
  align?: 'user' | 'assistant'
}>()

const columnsClass = computed(() => {
  if (props.images.length <= 1) return 'grid-cols-1'
  if (props.images.length === 2) return 'grid-cols-2'
  return 'grid-cols-2'
})

const previewUrl = ref<string | null>(null)

const openPreview = (image: ChatImageBlock): void => {
  previewUrl.value = getChatImageAssetUrl(image.assetId)
}

const closePreview = (): void => {
  previewUrl.value = null
}

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && previewUrl.value) {
    closePreview()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="grid gap-2"
    :class="[columnsClass, align === 'user' ? 'max-w-[360px]' : 'max-w-[520px]']"
  >
    <button
      v-for="(image, index) in images"
      :key="`${image.assetId}:${index}`"
      type="button"
      class="group overflow-hidden rounded-2xl border border-black/8 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
      title="打开图片"
      @click="openPreview(image)"
    >
      <img
        :src="getChatImageAssetUrl(image.assetId)"
        :alt="`image-${index + 1}`"
        class="block h-auto max-h-[320px] w-full object-cover transition-transform duration-200 group-hover:scale-[1.015]"
      />
    </button>

    <Teleport to="body">
      <Transition name="preview-fade">
        <div
          v-if="previewUrl"
          class="fixed inset-0 z-100 flex items-center justify-center bg-transparent p-10"
          @click="closePreview"
        >
          <div class="relative" @click.stop>
            <img
              :src="previewUrl"
              class="block w-auto h-auto max-w-[90vw] max-h-[85vh] min-w-[320px] min-h-[240px] object-contain rounded-2xl shadow-2xl border border-white/10 bg-white/5"
              alt="Preview"
            />
            <button
              class="absolute -top-4 -right-4 w-9 h-9 rounded-full border border-black/8 bg-white/95 hover:bg-white text-gray-800 flex items-center justify-center transition-all cursor-pointer shadow-xl z-10"
              type="button"
              @click.stop="closePreview"
            >
              <X :size="20" />
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.preview-fade-enter-active,
.preview-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
  filter: blur(4px);
}
</style>
