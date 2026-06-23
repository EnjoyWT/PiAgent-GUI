<template>
  <div class="flex-1 flex flex-col gap-3 overflow-y-auto text-(--theme-text-main)">
    <!-- 搜索引擎部分 -->
    <section class="bg-(--theme-bg-main) border border-(--theme-border-base) rounded-2xl p-6 shadow-sm space-y-5">
      <div class="space-y-2">
        <h3 class="text-lg font-bold text-(--theme-text-bright)">搜索引擎</h3>
        <p class="text-sm text-(--theme-text-dim) leading-relaxed">
          选择用于网络搜索的搜索引擎。目前支持 Google 搜索。
        </p>
      </div>

      <div class="space-y-3">
        <div class="relative">
          <select
            v-model="searchEngine"
            class="w-full h-11 px-4 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) text-[14px] font-semibold text-(--theme-text-main) outline-none hover:bg-(--theme-bg-hover-btn) transition-colors appearance-none pr-10"
          >
            <option value="google">Google</option>
          </select>
          <div class="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-(--theme-text-dim)">
            <ChevronDown :size="18" />
          </div>
        </div>
      </div>
    </section>

    <!-- WebFetch 浏览器部分 -->
    <section class="bg-(--theme-bg-main) border border-(--theme-border-base) rounded-2xl p-6 shadow-sm space-y-5">
      <div class="space-y-2">
        <h3 class="text-lg font-bold text-(--theme-text-bright)">WebFetch 浏览器</h3>
        <p class="text-sm text-(--theme-text-dim) leading-relaxed">
          打开浏览器窗口登录网站。登录后，WebFetch 可以访问需要身份验证的内容。
        </p>
      </div>

      <div class="flex items-stretch gap-3">
        <div class="relative flex-1">
          <input
            v-model="browserUrl"
            type="text"
            class="w-full h-11 px-4 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) text-[14px] text-(--theme-text-main) placeholder:text-(--theme-text-dim) outline-none focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent)"
            placeholder="https://"
            @keydown.enter.prevent="openBrowser"
          />
        </div>
        <button
          type="button"
          class="h-11 px-5 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-[14px] font-semibold text-(--theme-text-main) shadow-sm inline-flex items-center gap-2 transition-colors shrink-0"
          @click="openBrowser"
        >
          <ExternalLink :size="16" class="text-(--theme-text-dim)" />
          打开浏览器
        </button>
      </div>

      <div
        v-if="statusText"
        class="text-xs font-semibold"
        :class="statusTone === 'bad' ? 'text-red-500' : 'text-emerald-600'"
      >
        {{ statusText }}
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ExternalLink, ChevronDown } from 'lucide-vue-next'

const emit = defineEmits<{
  (event: 'dirty-change', dirty: boolean): void
}>()

const SEARCH_ENGINE_SETTING_KEY = 'webfetch_search_engine'
const DEFAULT_BROWSER_URL = 'https://www.google.com'

const searchEngine = ref('google')
const savedSearchEngine = ref('google')
const browserUrl = ref(DEFAULT_BROWSER_URL)
const statusText = ref('')
const statusTone = ref<'good' | 'bad'>('good')

const isDirty = computed(() => searchEngine.value !== savedSearchEngine.value)

watch(isDirty, (dirty) => emit('dirty-change', dirty), { immediate: true })

const normalizeBrowserUrl = (raw: string): string => {
  const value = raw.trim()
  if (!value) return DEFAULT_BROWSER_URL
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

const loadSettings = async (): Promise<void> => {
  const value = await window.api.db.settings.get(SEARCH_ENGINE_SETTING_KEY)
  searchEngine.value = value === 'google' ? value : 'google'
  savedSearchEngine.value = searchEngine.value
  emit('dirty-change', false)
}

const saveSettings = async (): Promise<void> => {
  await window.api.db.settings.set(SEARCH_ENGINE_SETTING_KEY, searchEngine.value)
  savedSearchEngine.value = searchEngine.value
  emit('dirty-change', false)
}

const openBrowser = async (): Promise<void> => {
  statusText.value = ''
  const url = normalizeBrowserUrl(browserUrl.value)
  browserUrl.value = url
  try {
    await window.api.webfetch.openBrowser(url)
    statusTone.value = 'good'
    statusText.value = 'WebFetch 浏览器已打开'
  } catch (error) {
    statusTone.value = 'bad'
    statusText.value = error instanceof Error ? error.message : '打开 WebFetch 浏览器失败'
  }
}

onMounted(loadSettings)

defineExpose({
  saveSettings
})
</script>
