<template>
  <div class="flex-1 flex flex-col gap-3 overflow-y-auto">
    <div class="bg-(--theme-bg-main) border border-(--theme-border-base) rounded-2xl p-6 shadow-sm space-y-5">
      <div class="space-y-2">
        <h3 class="text-lg font-bold text-(--theme-text-bright)">工具模型</h3>
        <p class="text-sm text-(--theme-text-dim) leading-relaxed">
          在保证生成质量的前提下尽可能快的模型，用于对话标题生成、记忆相关操作等自动化任务。
        </p>
        <button
          type="button"
          class="inline-flex items-center text-sm text-(--theme-accent) hover:underline w-fit"
          @click="openLearnMore"
        >
          了解更多
          <ExternalLink class="w-4 h-4 ml-1" />
        </button>
      </div>

      <div class="space-y-2">
        <div class="flex items-stretch gap-3">
          <div class="relative flex-1">
            <button
              ref="toolModelButtonRef"
              type="button"
              class="w-full h-11 px-4 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) flex items-center justify-between gap-3"
              @click="toggleToolModelMenu"
            >
              <div class="flex items-center gap-2 min-w-0">
                <Sparkles :size="16" class="text-(--theme-text-dim) shrink-0" />
                <span
                  class="text-[14px] font-semibold tracking-tight truncate text-(--theme-text-main)"
                >
                  {{ toolModelLabel || '选择模型...' }}
                </span>
              </div>
              <ChevronDown :size="18" class="text-(--theme-text-dim) shrink-0" />
            </button>

            <div
              v-if="showToolModelMenu"
              ref="toolModelMenuRef"
              class="absolute left-0 right-0 mt-2 max-h-90 overflow-hidden rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) shadow-[0_18px_50px_rgba(0,0,0,0.3)] z-30"
            >
              <div class="sticky top-0 z-10 bg-(--theme-bg-sidebar)/95 backdrop-blur p-2 border-b border-(--theme-border-base)">
                <div class="relative">
                  <Search
                    :size="14"
                    class="absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)"
                  />
                  <input
                    ref="toolModelSearchRef"
                    v-model="toolModelSearchQuery"
                    type="text"
                    placeholder="搜索模型..."
                    class="w-full h-9 pl-9 pr-3 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-content) text-[13px] text-(--theme-text-main) placeholder:text-(--theme-text-dim) outline-none focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent)"
                  />
                </div>
              </div>

              <div class="max-h-78 overflow-y-auto">
                <template v-for="group in groupedFilteredToolModels" :key="group.providerName">
                  <div
                    class="px-3 py-2 text-[13px] bg-(--theme-bg-content) border-y border-(--theme-border-base) text-(--theme-text-dim) flex items-center gap-2"
                  >
                    <img
                      v-if="getProviderIconUrl(group.providerName)"
                      :src="getProviderIconUrl(group.providerName)!"
                      :alt="`${group.providerName} icon`"
                      class="w-3 h-3"
                      draggable="false"
                    />
                    <span>{{ group.providerName }}</span>
                  </div>
                  <button
                    v-for="m in group.items"
                    :key="m.key"
                    class="w-full text-left px-8 py-2.5 hover:bg-(--theme-bg-hover-item) border-b border-(--theme-border-base) last:border-b-0 text-(--theme-text-main)"
                    :class="
                      selectedToolModel?.key === m.key
                        ? 'bg-(--theme-bg-active-item) !text-(--theme-text-bright)'
                        : ''
                    "
                    type="button"
                    @click="selectToolModel(m)"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-[13px] truncate text-(--theme-text-main)">
                          {{ m.label }}
                        </div>
                      </div>
                      <Check
                        v-if="selectedToolModel?.key === m.key"
                        :size="16"
                        class="text-emerald-600 shrink-0"
                      />
                    </div>
                  </button>
                </template>

                <div
                  v-if="groupedFilteredToolModels.length === 0"
                  class="px-3 py-6 text-center text-[12px] text-(--theme-text-dim)"
                >
                  没有匹配模型
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            class="w-11 h-11 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) flex items-center justify-center"
            :disabled="isTestingConnection"
            aria-label="连接测试"
            :title="isTestingConnection ? '正在测试…' : '连接测试'"
            @click="runConnectionTest"
          >
            <component
              :is="testIconComponent"
              :size="18"
              :class="[
                isTestingConnection ? 'animate-spin' : '',
                testStatus.tone === 'good'
                  ? 'text-emerald-600'
                  : testStatus.tone === 'warn'
                    ? 'text-amber-500'
                    : testStatus.tone === 'bad'
                      ? 'text-red-500'
                      : 'text-(--theme-text-dim)'
              ]"
            />
          </button>
        </div>

        <div
          v-if="testStatus.text"
          class="text-xs font-semibold"
          :class="
            testStatus.tone === 'good'
              ? 'text-emerald-600'
              : testStatus.tone === 'warn'
                ? 'text-amber-500'
                : testStatus.tone === 'bad'
                  ? 'text-red-500'
                  : 'text-(--theme-text-dim)'
          "
        >
          {{ testStatus.text }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  Check,
  ChevronDown,
  ExternalLink,
  FlaskConical,
  Loader2,
  Search,
  Sparkles
} from 'lucide-vue-next'
import { getProviderIconUrl } from '@renderer/utils/providerIcons'

const props = defineProps<{
  tempRootDir: string
}>()

const emit = defineEmits(['open-temp-root'])

type ToolModelOption = {
  key: string
  providerId: string
  providerName: string
  modelId: string
  label: string
}

const TOOL_MODEL_SETTING_KEY = 'tool_model'

const toolModelOptions = ref<ToolModelOption[]>([])
const selectedToolModel = ref<ToolModelOption | null>(null)

const showToolModelMenu = ref(false)
const toolModelSearchQuery = ref('')
const toolModelButtonRef = ref<HTMLElement | null>(null)
const toolModelMenuRef = ref<HTMLElement | null>(null)
const toolModelSearchRef = ref<HTMLInputElement | null>(null)

const testStatus = reactive<{ text: string; tone: 'idle' | 'good' | 'warn' | 'bad' }>({
  text: '',
  tone: 'idle'
})
const isTestingConnection = ref(false)

const testIconComponent = computed(() => (isTestingConnection.value ? Loader2 : FlaskConical))

const toolModelLabel = computed(() => selectedToolModel.value?.label)

const groupedFilteredToolModels = computed(() => {
  const q = toolModelSearchQuery.value.trim().toLowerCase()
  const filtered = toolModelOptions.value.filter((m) => {
    if (!q) return true
    return (
      m.label.toLowerCase().includes(q) ||
      m.modelId.toLowerCase().includes(q) ||
      m.providerName.toLowerCase().includes(q)
    )
  })
  const groups = new Map<string, ToolModelOption[]>()
  for (const item of filtered) {
    const list = groups.get(item.providerName) ?? []
    list.push(item)
    groups.set(item.providerName, list)
  }
  return Array.from(groups.entries()).map(([providerName, items]) => ({
    providerName,
    items
  }))
})

const resolveSelectedOption = (key: string | null) => {
  if (!key) return null
  return toolModelOptions.value.find((m) => m.key === key) ?? null
}

const loadToolModels = async () => {
  const providers = await window.api.providerConfig.listProviders()
  const options: ToolModelOption[] = []
  const details = await Promise.all(
    providers
      .filter((item) => item.enabled)
      .map((provider) => window.api.providerConfig.getProviderDetail(provider.id))
  )
  for (const p of details) {
    for (const m of p.models.filter((item) => item.enabled)) {
      options.push({
        key: `${p.id}::${m.modelId}`,
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.modelId,
        label: m.label || m.modelId
      })
    }
  }

  if (options.length === 0) {
    options.push({
      key: 'google::gemini-2.5-flash',
      providerId: 'google',
      providerName: 'Google Gemini',
      modelId: 'gemini-2.5-flash',
      label: 'gemini-2.5-flash'
    })
  }

  toolModelOptions.value = options
}

const loadToolModelSelection = async () => {
  const raw = await window.api.db.settings.get(TOOL_MODEL_SETTING_KEY)
  selectedToolModel.value = resolveSelectedOption((raw ?? '').trim() || null)
}

const persistToolModelSelection = async () => {
  if (!selectedToolModel.value) {
    await window.api.db.settings.set(TOOL_MODEL_SETTING_KEY, '')
    return
  }
  await window.api.db.settings.set(TOOL_MODEL_SETTING_KEY, selectedToolModel.value.key)
}

const toggleToolModelMenu = async () => {
  showToolModelMenu.value = !showToolModelMenu.value
  if (showToolModelMenu.value) {
    await nextTick()
    toolModelSearchRef.value?.focus()
  }
}

const closeToolModelMenu = () => {
  showToolModelMenu.value = false
  toolModelSearchQuery.value = ''
}

const selectToolModel = async (model: ToolModelOption | null) => {
  selectedToolModel.value = model
  await persistToolModelSelection()
  closeToolModelMenu()
  testStatus.text = ''
  testStatus.tone = 'idle'
}

const resolveToolModelForTest = (): {
  providerId: string
  providerName: string
  modelId: string
  label: string
} | null => {
  const selected = selectedToolModel.value
  if (selected)
    return {
      providerId: selected.providerId,
      providerName: selected.providerName,
      modelId: selected.modelId,
      label: selected.label
    }
  const fallback = toolModelOptions.value[0]
  if (!fallback) return null
  return {
    providerId: fallback.providerId,
    providerName: fallback.providerName,
    modelId: fallback.modelId,
    label: fallback.label
  }
}

const runConnectionTest = async () => {
  const target = resolveToolModelForTest()
  if (!target) {
    testStatus.text = '未找到可用模型'
    testStatus.tone = 'bad'
    return
  }
  const provider = await window.api.providerConfig.getProviderDetail(target.providerId)

  if (!provider.apiKey?.trim()) {
    testStatus.text = '请先在「提供商」中配置 API Key'
    testStatus.tone = 'bad'
    return
  }

  isTestingConnection.value = true
  testStatus.text = '检测连接...'
  testStatus.tone = 'idle'

  try {
    const res = await window.api.providerConfig.validate({
      providerId: target.providerId,
      modelId: target.modelId
    })
    if (!res.ok) throw new Error(res.message)
    const ms = res.ms ?? 0
    const seconds = (ms / 1000).toFixed(2)
    if (ms < 2500) {
      testStatus.text = `✅ 良好 (${seconds}s) 适合工具操作`
      testStatus.tone = 'good'
    } else if (ms < 5000) {
      testStatus.text = `⚠️ 较慢 (${seconds}s) 可用但可能感觉迟缓`
      testStatus.tone = 'warn'
    } else {
      testStatus.text = `❌ 不可用 (${seconds}s) 对于响应式工具使用来说太慢`
      testStatus.tone = 'bad'
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    testStatus.text = `❌ 连接失败：${msg.slice(0, 160)}`
    testStatus.tone = 'bad'
  } finally {
    isTestingConnection.value = false
  }
}

const onGlobalPointerDown = (event: MouseEvent) => {
  if (!showToolModelMenu.value) return
  const t = event.target as Node | null
  if (!t) return
  const button = toolModelButtonRef.value
  const menu = toolModelMenuRef.value
  if (button?.contains(t) || menu?.contains(t)) return
  closeToolModelMenu()
}

const onGlobalKeyDown = (event: KeyboardEvent) => {
  if (!showToolModelMenu.value) return
  if (event.key === 'Escape') closeToolModelMenu()
}

const openLearnMore = async () => {
  // UI-only: keep a stable, non-broken link.
  await window.api.openExternal('https://github.com/openai/codex')
}

onMounted(async () => {
  await loadToolModels()
  await loadToolModelSelection()
  document.addEventListener('mousedown', onGlobalPointerDown, true)
  document.addEventListener('keydown', onGlobalKeyDown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onGlobalPointerDown, true)
  document.removeEventListener('keydown', onGlobalKeyDown, true)
})
</script>
