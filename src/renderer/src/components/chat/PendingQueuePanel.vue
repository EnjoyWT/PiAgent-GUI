<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUp, Clock3, Trash2 } from 'lucide-vue-next'
import Tooltip from '../common/Tooltip.vue'
import type { PendingQueueItem, QueueRuntimeState } from './types'

const props = defineProps<{
  items: PendingQueueItem[]
  runtimeState: QueueRuntimeState
  dispatchPolicy?: 'auto' | 'paused'
}>()

const emit = defineEmits<{
  (e: 'dispatch-item', itemId: string): void
  (e: 'dispatch-all'): void
  (e: 'delete-item', itemId: string): void
}>()

const previewItems: PendingQueueItem[] = []

const displayItems = computed(() => (props.items.length > 0 ? props.items : previewItems))

const title = computed(() => `${displayItems.value.length} 条待发送消息`)
const queuedCount = computed(
  () => displayItems.value.filter((item) => item.status === 'queued').length
)
const formatItemLabel = (item: PendingQueueItem): string => {
  const text = (item.text ?? '').trim()
  if (text) return text
  const imageCount = item.images?.length ?? 0
  if (imageCount > 0) return imageCount === 1 ? '[图片]' : `[${imageCount} 张图片]`
  return '[空消息]'
}
</script>

<template>
  <section
    v-if="displayItems.length > 0"
    class="relative isolate overflow-hidden rounded-2xl border border-gray-200/60 bg-(--theme-bg-main) bg-clip-padding"
  >
    <header class="flex items-center justify-between gap-4 border-b border-gray-200/60 py-2">
      <div class="min-w-0">
        <div class="flex items-center gap-2 text-[#5f7391] pl-4">
          <Clock3 :size="15" stroke-width="2.1" />
          <div class="text-[13px] font-semibold tracking-tight text-[#5c708d]">
            {{ title }}
          </div>
        </div>
      </div>

      <div class="pr-2">
        <Tooltip text="合并发送全部" :offset="0">
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#7c8ca0] transition-colors hover:bg-gray-100 hover:text-[#566a84]"
            aria-label="合并发送全部待发消息"
            :disabled="queuedCount === 0"
            :class="queuedCount === 0 ? 'opacity-40 cursor-default pointer-events-none' : ''"
            @click="queuedCount > 0 && emit('dispatch-all')"
          >
            <ArrowUp :size="14" stroke-width="2.1" />
          </button>
        </Tooltip>
      </div>
    </header>

    <div class="max-h-45 overflow-y-auto divide-y divide-gray-200/60 queue-scroll">
      <div
        v-for="(item, index) in displayItems"
        :key="item.id"
        class="flex min-h-9 items-center gap-0.5 bg-transparent pl-4 pr-1.5 transition-opacity"
        :class="item.status === 'submitted' ? 'opacity-55' : ''"
      >
        <div class="min-w-0 flex-1">
          <div
            class="truncate text-[12px] font-normal leading-5"
            :class="item.status === 'submitted' ? 'text-[#AAB4C3]' : 'text-[#8A97AA]'"
            :title="
              item.status === 'submitted'
                ? `${formatItemLabel(item)}\n\n已提交到底层 runtime，等待真正消费。`
                : formatItemLabel(item)
            "
          >
            {{ formatItemLabel(item) }}
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-0">
          <Tooltip
            :text="item.status === 'submitted' ? '已提交，等待消费' : '插入当前回复'"
            :offset="0"
          >
            <button
              type="button"
              class="inline-flex h-7 w-6 items-center justify-center text-[#7c8ca0] transition-colors hover:text-[#566a84]"
              :aria-label="`插入第 ${index + 1} 条待发消息到当前回复`"
              :disabled="item.status === 'submitted'"
              :class="
                item.status === 'submitted' ? 'opacity-40 cursor-default pointer-events-none' : ''
              "
              @click="
                props.items.length > 0 && item.status === 'queued' && emit('dispatch-item', item.id)
              "
            >
              <ArrowUp :size="14" stroke-width="2.1" />
            </button>
          </Tooltip>

          <Tooltip :text="item.status === 'submitted' ? '已提交，暂不可删除' : '删除'" :offset="0">
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center text-[#a0acbb] transition-colors hover:text-[#dc2626]"
              :aria-label="`删除第 ${index + 1} 条待发消息`"
              :disabled="item.status === 'submitted'"
              :class="
                item.status === 'submitted' ? 'opacity-40 cursor-default pointer-events-none' : ''
              "
              @click="
                props.items.length > 0 && item.status === 'queued' && emit('delete-item', item.id)
              "
            >
              <Trash2 :size="16" />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.queue-scroll {
  scrollbar-width: thin !important;
  scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
}

.queue-scroll::-webkit-scrollbar {
  width: 4px;
  display: block !important;
}

.queue-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.queue-scroll::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 4px;
  transition: background 0.2s;
}

.queue-scroll:hover::-webkit-scrollbar-thumb {
  background: rgba(156, 163, 175, 0.5);
}
</style>
