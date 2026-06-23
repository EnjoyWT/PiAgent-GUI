<script setup lang="ts">
import { computed, ref } from 'vue'
import { FolderOpen, Plus, X, Trash2 } from 'lucide-vue-next'
import { globalDialog } from '../../../utils/dialog'

const props = defineProps<{
  open: boolean
  extraDirs: string[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'add'): void
  (e: 'openDir', dir: string): void
  (e: 'remove', dir: string): void
}>()

const hasDirs = computed(() => (props.extraDirs?.length ?? 0) > 0)
const removing = ref<string | null>(null)

const onBackdrop = () => emit('close')

const handleRemove = async (dir: string) => {
  if (removing.value) return
  const ok = await globalDialog.confirm({
    title: '移除目录',
    message: '从扫描列表移除该目录？',
    detail: dir,
    confirmText: '移除',
    cancelText: '取消',
    danger: true
  })
  if (!ok) return
  removing.value = dir
  try {
    emit('remove', dir)
  } finally {
    removing.value = null
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="skills-paths-modal-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-95 flex items-center justify-center bg-black/40 px-4"
        @mousedown.self="onBackdrop"
      >
        <div
          class="w-full max-w-180 h-[80vh] max-h-160 rounded-2xl border border-gray-200 bg-white shadow-[0_30px_80px_rgba(0,0,0,0.25)] overflow-hidden flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="管理自定义技能路径"
        >
          <div class="flex items-start justify-between gap-3 px-5 pt-5 shrink-0">
            <div class="min-w-0">
              <div class="text-[15px] font-semibold text-gray-900">管理自定义技能路径</div>
              <div class="mt-1 text-[12px] text-gray-500">
                添加的目录会参与技能扫描；移除不会删除目录内容。
              </div>
            </div>
            <button
              type="button"
              class="h-9 w-9 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 flex items-center justify-center"
              aria-label="Close"
              @click="emit('close')"
            >
              <X :size="16" />
            </button>
          </div>

          <div class="mt-4 px-5 pb-5 flex-1 min-h-0 flex flex-col">
            <div class="flex items-center justify-between gap-3 shrink-0">
              <div class="text-[12px] text-gray-600">
                已添加
                <span class="font-semibold text-gray-800">{{ extraDirs.length }}</span> 个
              </div>
              <button
                type="button"
                class="h-9 px-3 rounded-xl text-[13px] font-semibold text-white bg-[#6f9aa4] hover:bg-[#5f8790] flex items-center gap-2"
                @click="emit('add')"
              >
                <Plus :size="16" />
                添加目录
              </button>
            </div>

            <div
              v-if="!hasDirs"
              class="mt-4 flex-1 min-h-0 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-[12px] text-gray-500 flex items-center justify-center"
            >
              <div>暂无自定义路径。可添加你的个人技能目录或其他外部路径。</div>
            </div>

            <div
              v-else
              class="mt-4 flex-1 min-h-0 overflow-auto rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6"
            >
              <div class="grid gap-2">
                <div
                  v-for="dir in extraDirs"
                  :key="dir"
                  class="group flex items-center gap-1 rounded-2xl border border-gray-100 bg-white px-3 py-2 transition-colors"
                >
                  <button
                    type="button"
                    class="shrink-0 h-9 w-9 rounded-xl bg-white text-gray-600 flex items-center justify-center"
                    :title="'打开目录：' + dir"
                    @click="emit('openDir', dir)"
                  >
                    <FolderOpen :size="16" />
                  </button>

                  <div class="min-w-0 flex-1">
                    <div class="font-mono text-[11px] text-gray-800 truncate" :title="dir">
                      {{ dir }}
                    </div>
                  </div>

                  <button
                    type="button"
                    class="shrink-0 h-9 px-3 rounded-xl border border-transparent text-[13px] text-gray-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                    :disabled="Boolean(removing) && removing !== dir"
                    @click="handleRemove(dir)"
                  >
                    <Trash2 :size="16" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.skills-paths-modal-fade-enter-active,
.skills-paths-modal-fade-leave-active {
  transition: opacity 0.12s ease;
}

.skills-paths-modal-fade-enter-from,
.skills-paths-modal-fade-leave-to {
  opacity: 0;
}
</style>
