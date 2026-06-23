<template>
  <div
    v-if="isOpen"
    :class="
      isStandalone
        ? 'h-screen w-full flex flex-col bg-(--theme-bg-main)'
        : 'fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm'
    "
  >
    <!-- Standalone Window Top Bar (macOS hidden titlebar) -->
    <header
      v-if="isStandalone"
      class="relative h-12 border-b-[0.5px] border-(--theme-border-header) bg-(--theme-bg-header) flex items-center drag-region shrink-0"
    >
      <!-- Left header background (match App.vue) -->
      <div
        class="absolute left-2.5 top-2.5 -bottom-px bg-(--theme-bg-sidebar) border-t border-x border-(--theme-border-sidebar) [box-shadow:var(--theme-shadow-sidebar)] backdrop-blur pointer-events-none rounded-t-xl"
        style="width: 220px"
      ></div>

      <!-- Left header area (match sidebar width) -->
      <div class="relative flex items-center h-full" style="width: 212px">
        <div class="w-18 shrink-0 h-full flex items-center"></div>
      </div>

      <!-- Center Title -->
      <div class="flex-1 text-left pl-8 font-medium tracking-tight">
        <div class="flex items-center text-[16px] text-(--theme-text-bright)">
          <component :is="activeCat.icon" :size="18" class="mr-2 text-(--theme-text-dim)" />
          <span>{{ activeCat.label }}</span>
        </div>
      </div>
      <div class="pr-6 text-xs font-medium" :class="saveStatusClass">
        {{ saveStatusText }}
      </div>
    </header>

    <div
      :class="
        isStandalone
          ? 'flex flex-1 overflow-y-hidden overflow-x-visible'
          : 'bg-(--theme-bg-main) w-250 h-192 rounded-2xl shadow-2xl flex overflow-hidden border border-(--theme-border-base)'
      "
    >
      <!-- Modal Sidebar -->
      <aside
        class="ml-2.5 mb-2.5 bg-(--theme-bg-sidebar) border-x border-b border-(--theme-border-sidebar) [box-shadow:var(--theme-shadow-sidebar)] flex flex-col relative z-20 shrink-0 overflow-visible rounded-b-xl"
        style="width: 220px"
      >
        <div class="flex-1 overflow-y-auto px-2 space-y-1">
          <div
            v-for="cat in categories"
            :key="cat.id"
            class="flex items-center px-3 py-2 rounded-lg text-sm mb-0.5 cursor-pointer transition-colors border border-transparent"
            :class="
              activeCategory === cat.id
                ? 'bg-(--theme-bg-active-item) [box-shadow:var(--theme-shadow-active-item)] border-(--theme-border-active-item) text-(--theme-text-bright) font-medium'
                : 'text-(--theme-text-main) hover:bg-(--theme-bg-hover-item)'
            "
            @click="activeCategory = cat.id"
          >
            <component
              :is="cat.icon"
              :size="16"
              class="mr-3"
              :class="
                activeCategory === cat.id ? 'text-(--theme-text-bright)' : 'text-(--theme-text-dim)'
              "
            />
            {{ cat.label }}
          </div>
        </div>
      </aside>

      <!-- Main Content -->
      <div class="flex-1 min-w-0 flex flex-col bg-(--theme-bg-main)">
        <!-- Header -->
        <header
          v-if="!hideHeader && !isStandalone"
          class="h-14 border-b border-(--theme-border-base) flex items-center justify-between px-6"
        >
          <div class="flex items-center text-sm font-bold text-(--theme-text-bright)">
            <component :is="activeCat.icon" :size="18" class="mr-2 text-(--theme-text-dim)" />
            {{ activeCat.label }}
          </div>
          <div class="flex items-center gap-4">
            <span class="text-xs font-medium" :class="saveStatusClass">{{ saveStatusText }}</span>
            <button
              class="text-(--theme-text-dim) hover:text-(--theme-text-main)"
              @click="emit('close')"
            >
              <X :size="20" />
            </button>
          </div>
        </header>

        <!-- Content Area -->
        <div class="flex-1 min-w-0 overflow-hidden flex p-3 bg-(--theme-bg-content)">
          <component
            :is="currentComponent"
            v-bind="currentProps"
            ref="activeComponentRef"
            v-on="currentListeners"
            @dirty-change="handleDirtyChange"
          />
        </div>

        <!-- Footer -->
        <footer
          class="h-16 border-t border-(--theme-border-base) flex items-center justify-end px-6"
        >
          <div class="flex space-x-3">
            <button
              class="px-6 py-2 text-sm font-medium text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn) rounded-lg transition-colors border border-(--theme-border-base)"
              @click="emit('close')"
            >
              关闭
            </button>
            <button
              class="px-6 py-2 text-sm font-medium text-white bg-[#00ba88] hover:opacity-90 rounded-lg transition-colors shadow-sm"
              @click="saveAll"
            >
              保存
            </button>
          </div>
        </footer>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  Settings,
  Bot,
  FolderOpen,
  Layers,
  Brain,
  Plug,
  Sparkles,
  Puzzle,
  MessageCircle,
  Globe,
  Palette,
  Clock3,
  MousePointerClick,
  X
} from 'lucide-vue-next'
import ProvidersSettings from './components/ProvidersSettings.vue'
import GeneralSettings from './components/GeneralSettings.vue'
import ProjectsSettings from './components/ProjectsSettings.vue'
import PlaceholderSettings from './components/PlaceholderSettings.vue'
import ContextSettings from './components/ContextSettings.vue'
import KnowledgeSettings from './components/KnowledgeSettings.vue'
import SkillsSettings from './components/SkillsSettings.vue'
import McpSettings from './components/McpSettings.vue'
import ScheduledTasksSettings from './components/ScheduledTasksSettings.vue'
import AgentPluginsSettings from './components/AgentPluginsSettings.vue'
import ImSettings from './components/ImSettings.vue'
import WebFetchSettings from './components/WebFetchSettings.vue'
import ComputerUseSettings from './components/ComputerUseSettings.vue'

defineProps<{
  isOpen: boolean
  isStandalone?: boolean
  hideHeader?: boolean
}>()

const emit = defineEmits(['close'])

const categories = [
  { id: 'general', label: '通用', icon: Settings },
  { id: 'providers', label: '提供商', icon: Bot },
  { id: 'projects', label: '项目', icon: FolderOpen },
  { id: 'chat', label: '上下文', icon: Layers },
  { id: 'scheduledTasks', label: '定时任务', icon: Clock3 },
  // { id: 'prompts', label: '快捷提示', icon: Zap },
  { id: 'knowledge', label: '记忆', icon: Brain },
  { id: 'mcp', label: 'MCP 服务器', icon: Plug },
  { id: 'skills', label: '技能', icon: Sparkles },
  { id: 'plugins', label: '插件', icon: Puzzle },
  { id: 'im', label: 'IM', icon: MessageCircle },
  { id: 'computerUse', label: 'computer use', icon: MousePointerClick },
  // { id: 'voice', label: '语音', icon: Mic },
  // { id: 'tts', label: 'Text-to-Speech', icon: Volume2 },
  { id: 'search', label: '网络搜索', icon: Globe },
  { id: 'theme', label: '配色方案', icon: Palette }
]

import ThemeSettings from './components/ThemeSettings.vue'

const activeCategory = ref<'general' | 'providers' | string>('general')

onMounted(async () => {
  const hash = window.location.hash
  if (hash.includes('?')) {
    const searchParams = new URLSearchParams(hash.split('?')[1])
    const category = searchParams.get('category')
    if (category) {
      activeCategory.value = category
    }
  }

  // Listen for category changes from the main process
  window.api.onSettingsCategory((category: string) => {
    activeCategory.value = category
  })
})

const activeCat = computed(
  () => categories.find((c) => c.id === activeCategory.value) ?? categories[0]
)
const categoryComponents: Record<string, any> = {
  providers: ProvidersSettings,
  general: GeneralSettings,
  projects: ProjectsSettings,
  chat: ContextSettings,
  scheduledTasks: ScheduledTasksSettings,
  knowledge: KnowledgeSettings,
  skills: SkillsSettings,
  mcp: McpSettings,
  im: ImSettings,
  plugins: AgentPluginsSettings,
  computerUse: ComputerUseSettings,
  search: WebFetchSettings,
  theme: ThemeSettings
}

const currentComponent = computed(
  () => categoryComponents[activeCategory.value] ?? PlaceholderSettings
)

const currentProps = computed(() => {
  if (activeCategory.value === 'general') {
    return {
      tempRootDir: generalSettings.tempRootDir
    }
  }
  return {}
})

const currentListeners = computed(() => {
  if (activeCategory.value === 'general') {
    return {
      'open-temp-root': openTempRoot
    }
  }
  return {}
})

const generalSettings = reactive({
  tempRootDir: ''
})

const loadGeneral = async () => {
  const res = await window.api.workspace.getTempRoot()
  generalSettings.tempRootDir = res.rootDir ?? ''
}

const openTempRoot = async () => {
  await window.api.workspace.openTempRoot()
  await loadGeneral()
}

const activeComponentRef = ref<{
  saveProvider?: () => Promise<void>
  saveSettings?: () => Promise<void>
} | null>(null)
const currentDirty = ref(false)

const saveStatusText = computed(() => (currentDirty.value ? '未保存' : '所有更改已保存'))
const saveStatusClass = computed(() =>
  currentDirty.value ? 'text-rose-500' : 'text-(--theme-text-dim)'
)

const handleDirtyChange = (dirty: boolean) => {
  currentDirty.value = Boolean(dirty)
}

const saveAll = async () => {
  if (typeof activeComponentRef.value?.saveSettings === 'function') {
    await activeComponentRef.value.saveSettings()
    currentDirty.value = false
    return
  }
  if (typeof activeComponentRef.value?.saveProvider === 'function') {
    await activeComponentRef.value.saveProvider()
    currentDirty.value = false
  }
}

watch(activeCategory, () => {
  currentDirty.value = false
})
onMounted(async () => {
  const hash = window.location.hash
  if (hash.includes('?')) {
    const searchParams = new URLSearchParams(hash.split('?')[1])
    const category = searchParams.get('category')
    if (category) {
      activeCategory.value = category
    }
  }

  // Listen for category changes from the main process
  window.api.onSettingsCategory((category: string) => {
    activeCategory.value = category
  })

  await Promise.all([loadGeneral()])
})
</script>
