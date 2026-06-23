<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, X } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  loading?: boolean
  targetDir: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', payload: { source: string; force: boolean }): void
}>()

const source = ref('')
const force = ref(false)

const canSubmit = computed(() => source.value.trim().length > 0 && !props.loading)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    source.value = ''
    force.value = false
  }
)

const submit = () => {
  const next = source.value.trim()
  if (!next || props.loading) return
  emit('submit', { source: next, force: force.value })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="skills-install-modal-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-95 flex items-center justify-center bg-black/40 px-4"
        @mousedown.self="emit('close')"
      >
        <div
          class="w-full max-w-180 rounded-2xl border border-gray-200 bg-white shadow-[0_30px_80px_rgba(0,0,0,0.25)] overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="安装技能"
        >
          <div class="flex items-start justify-between gap-3 px-5 pt-5">
            <div class="min-w-0">
              <div class="text-[15px] font-semibold text-gray-900">安装技能</div>
              <div class="mt-1 text-[12px] text-gray-500">
                支持 skills.sh 链接或
                <span class="font-mono">owner/repo@skill-name</span>。默认安装到公共目录，供 PiAgent
                和其他兼容 agent 共享。
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

          <div class="px-5 pb-5 pt-4">
            <div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] uppercase tracking-[0.12em] text-gray-400">目标目录</div>
              <div class="mt-1 font-mono text-[12px] break-all text-gray-700">
                {{ targetDir || '正在加载…' }}
              </div>
            </div>

            <div class="mt-4">
              <label class="block text-[12px] font-semibold text-gray-700">skills.sh 来源</label>
              <input
                v-model="source"
                type="text"
                class="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-900 outline-none focus:border-[#00ba88] focus:ring-2 focus:ring-[#00ba88]/15"
                placeholder="例如：https://skills.sh/anthropics/skills/skill-creator 或 anthropics/skills@skill-creator"
                @keydown.enter.prevent="submit"
              />
              <div class="mt-2 text-[12px] text-gray-500">
                也支持仓库分支，例如 <span class="font-mono">owner/repo@skill-name#main</span>。
              </div>
            </div>

            <label
              class="mt-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700"
            >
              <input v-model="force" type="checkbox" class="h-4 w-4 rounded border-gray-300" />
              覆盖已存在的同名技能文件
            </label>

            <div class="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                class="h-9 px-4 rounded-xl border border-gray-200 bg-white text-[13px] text-gray-700 hover:bg-gray-50"
                :disabled="Boolean(loading)"
                @click="emit('close')"
              >
                取消
              </button>
              <button
                type="button"
                class="h-9 px-4 rounded-xl text-[13px] font-semibold text-white bg-[#00ba88] hover:bg-[#00a87a] disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                :disabled="!canSubmit"
                @click="submit"
              >
                <Download :size="15" />
                {{ loading ? '安装中…' : '开始安装' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.skills-install-modal-fade-enter-active,
.skills-install-modal-fade-leave-active {
  transition: opacity 0.12s ease;
}

.skills-install-modal-fade-enter-from,
.skills-install-modal-fade-leave-to {
  opacity: 0;
}
</style>
