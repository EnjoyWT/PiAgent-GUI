<template>
  <div class="flex-1 flex flex-col gap-3 overflow-y-auto pb-6 text-(--theme-text-main)">
    <div
      class="bg-(--theme-bg-main) border border-(--theme-border-base) rounded-2xl p-6 shadow-sm space-y-5"
    >
      <div class="space-y-2">
        <h3 class="text-lg font-bold text-(--theme-text-bright)">界面主题</h3>
        <p class="text-sm text-(--theme-text-dim) leading-relaxed">
          选择适合你的偏好主题样式，或创建自定义配色方案。
        </p>
      </div>

      <!-- Theme Selector -->
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
        <!-- Built-in Themes -->
        <button
          v-for="theme in builtInThemes"
          :key="theme.id"
          type="button"
          class="flex flex-col items-center justify-center p-4 border rounded-xl gap-3 transition-colors relative overflow-hidden"
          :class="
            appTheme === theme.id
              ? 'border-(--theme-accent) bg-(--theme-bg-active-item) text-(--theme-accent) font-medium'
              : 'border-(--theme-border-base) hover:bg-(--theme-bg-hover-btn) text-(--theme-text-main)'
          "
          @click="selectTheme(theme.id)"
        >
          <div
            class="w-16 h-12 rounded border flex overflow-hidden shadow-sm"
            :style="{
              backgroundColor: theme.preview.main,
              borderColor: theme.preview.border
            }"
          >
            <div
              class="w-1/3 h-full border-r"
              :style="{
                backgroundColor: theme.preview.sidebar,
                borderColor: theme.preview.sidebarBorder ?? theme.preview.border,
                boxShadow: theme.preview.sidebarShadow ?? 'none'
              }"
            ></div>
            <div class="flex-1 h-full" :style="{ backgroundColor: theme.preview.main }"></div>
          </div>
          <span>{{ theme.label }}</span>
          <div
            v-if="appTheme === theme.id"
            class="absolute top-2 right-2 w-2 h-2 rounded-full bg-(--theme-accent)"
          ></div>
        </button>

        <!-- Custom Themes List -->
        <button
          v-for="custom in customThemes"
          :key="custom.id"
          type="button"
          class="group flex flex-col items-center justify-center p-4 border rounded-xl gap-3 transition-colors relative overflow-hidden"
          :class="
            appTheme === custom.id
              ? 'border-(--theme-accent) bg-(--theme-bg-active-item) text-(--theme-accent) font-medium'
              : 'border-(--theme-border-base) hover:bg-(--theme-bg-hover-btn) text-(--theme-text-main)'
          "
          @click="selectTheme(custom.id)"
        >
          <div
            class="w-16 h-12 rounded border border-(--theme-border-base) flex overflow-hidden shadow-sm"
            :style="{ backgroundColor: custom.vars['--theme-bg-main'] }"
          >
            <div
              class="w-1/3 h-full border-r"
              :style="{
                backgroundColor: custom.vars['--theme-bg-sidebar'],
                borderColor: custom.vars['--theme-border-sidebar']
              }"
            ></div>
            <div
              class="flex-1 h-full"
              :style="{ backgroundColor: custom.vars['--theme-bg-main'] }"
            ></div>
          </div>
          <span>{{ custom.name }}</span>
          <div
            v-if="appTheme === custom.id"
            class="absolute top-2 right-2 w-2 h-2 rounded-full bg-(--theme-accent)"
          ></div>

          <div
            class="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center bg-(--theme-bg-sidebar)/80 border border-(--theme-border-base) rounded-lg backdrop-blur shadow-sm"
          >
            <button
              class="text-(--theme-text-dim) hover:text-(--theme-accent) p-1.5"
              title="编辑"
              @click.stop="editCustomTheme(custom)"
            >
              <Pencil :size="14" />
            </button>
            <button
              class="text-(--theme-text-dim) hover:text-rose-500 p-1.5"
              title="删除"
              @click.stop="deleteCustomTheme(custom.id)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </button>

        <!-- Create New Custom Theme -->
        <button
          type="button"
          class="flex flex-col items-center justify-center p-4 border border-dashed rounded-xl gap-3 transition-colors border-(--theme-border-base) hover:border-(--theme-accent) hover:bg-(--theme-bg-hover-item) text-(--theme-text-dim) hover:text-(--theme-accent)"
          @click="startCustomTheme"
        >
          <div
            class="w-10 h-10 rounded-full bg-(--theme-bg-content) flex items-center justify-center"
          >
            <Plus :size="20" />
          </div>
          <span>新建主题</span>
        </button>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="theme-editor-modal-fade">
        <div
          v-if="isEditing"
          class="fixed inset-0 z-95 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
          @mousedown.self="cancelEdit"
        >
          <div
            class="w-full max-w-210 max-h-[86vh] bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            role="dialog"
            aria-modal="true"
            :aria-label="editingTheme.id ? '编辑自定义主题' : '创建自定义主题'"
          >
            <div
              class="flex items-center justify-between gap-4 border-b border-(--theme-border-base) px-6 py-4 shrink-0"
            >
              <h3 class="text-lg font-bold text-(--theme-text-bright)">
                {{ editingTheme.id ? '编辑自定义主题' : '创建自定义主题' }}
              </h3>
              <button
                type="button"
                class="h-8 w-8 rounded-lg text-(--theme-text-dim) hover:bg-(--theme-bg-hover-btn) hover:text-(--theme-text-main) flex items-center justify-center"
                @click="cancelEdit"
              >
                <X :size="20" />
              </button>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label class="block text-sm font-medium text-(--theme-text-main) mb-1">
                  主题名称
                </label>
                <input
                  v-model="editingTheme.name"
                  type="text"
                  class="w-full px-3 py-2 bg-(--theme-bg-content) border border-(--theme-border-base) text-(--theme-text-main) placeholder:text-(--theme-text-dim) rounded-lg focus:outline-none focus:ring-2 focus:ring-(--theme-accent)/30 focus:border-(--theme-accent)"
                  placeholder="输入主题名称..."
                />
              </div>

              <p class="text-xs text-(--theme-text-dim)">
                支持直接输入 CSS 值。`rgba(...)`、`transparent`、阴影等复杂值请用文本框编辑。
              </p>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 pt-2">
                <template v-for="section in themeVarSections" :key="section.title">
                  <h4
                    class="col-span-full text-sm font-bold text-(--theme-text-bright) border-b border-(--theme-border-base) pb-1 mt-2"
                  >
                    {{ section.title }}
                  </h4>

                  <div
                    v-for="varName in section.vars"
                    :key="varName"
                    class="flex items-center justify-between gap-3"
                  >
                    <label class="text-xs text-(--theme-text-main) font-mono">
                      {{ getThemeVarLabel(varName) }}
                    </label>
                    <div class="flex items-center gap-2">
                      <input
                        v-model="editingTheme.vars[varName]"
                        type="text"
                        class="w-40 px-2 py-1 text-xs bg-(--theme-bg-content) border border-(--theme-border-base) text-(--theme-text-main) rounded font-mono"
                      />
                      <input
                        v-if="supportsColorPicker(editingTheme.vars[varName], varName)"
                        v-model="editingTheme.vars[varName]"
                        type="color"
                        class="w-6 h-6 p-0 border-0 rounded cursor-pointer bg-transparent"
                      />
                      <div v-else class="w-6 h-6"></div>
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <div
              class="flex justify-end gap-3 border-t border-(--theme-border-base) px-6 py-4 shrink-0"
            >
              <button
                type="button"
                class="px-4 py-2 text-sm text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn) rounded-lg transition-colors"
                @click="cancelEdit"
              >
                取消
              </button>
              <button
                type="button"
                class="px-6 py-2 text-sm font-medium text-white bg-(--theme-accent) hover:opacity-90 rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="!editingTheme.name"
                @click="saveCustomTheme"
              >
                保存并应用
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Trash2, Pencil, X } from 'lucide-vue-next'
import { loadAppTheme, setAppTheme, saveCustomThemes, CustomTheme } from '../../../utils/theme'

const appTheme = ref('modern')
const customThemes = ref<CustomTheme[]>([])

const builtInThemes = [
  {
    id: 'modern',
    label: '极简现代',
    preview: {
      sidebar: '#F9FAFB',
      main: '#FFFFFF',
      border: '#E5E7EB',
      sidebarBorder: 'rgba(243, 244, 246, 0.5)'
    }
  },
  {
    id: 'classic',
    label: '经典灰白',
    preview: {
      sidebar: '#FFFFFF',
      main: '#FAFAFA',
      border: '#E5E7EB',
      sidebarBorder: 'transparent',
      sidebarShadow: '4px 0 14px rgba(15, 23, 42, 0.08)'
    }
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    preview: {
      sidebar: '#05252E',
      main: '#062C36',
      border: '#0B3A45',
      sidebarBorder: 'rgba(143, 176, 175, 0.18)'
    }
  },
  {
    id: 'dark',
    label: 'Dark',
    preview: {
      sidebar: '#000000',
      main: '#000000',
      border: '#2F3336',
      sidebarBorder: '#2F3336'
    }
  }
]

const isEditing = ref(false)
const editingTheme = ref<CustomTheme>({
  id: '',
  name: '',
  vars: {}
})

const themeVarSections = [
  {
    title: '基础背景',
    vars: [
      '--theme-bg-sidebar',
      '--theme-bg-main',
      '--theme-bg-header',
      '--theme-bg-header-left',
      '--theme-bg-content',
      '--theme-bg-user-content',
      '--theme-border-user-content'
    ]
  },
  {
    title: '文字颜色',
    vars: ['--theme-text-main', '--theme-text-dim', '--theme-text-bright', '--theme-text-user']
  },
  {
    title: '边框与阴影',
    vars: [
      '--theme-border-base',
      '--theme-border-header',
      '--theme-border-sidebar',
      '--theme-shadow-sidebar',
      '--theme-shadow-active-item'
    ]
  },
  {
    title: '交互状态',
    vars: [
      '--theme-bg-active-item',
      '--theme-border-active-item',
      '--theme-bg-hover-item',
      '--theme-bg-hover-btn',
      '--theme-accent',
      '--theme-accent-dim',
      '--chat-input-border-idle',
      '--focus-ring-color',
      '--focus-ring-shadow',
      '--chat-input-badge-bg'
    ]
  }
]

const themeVarLabels: Record<string, string> = {
  '--theme-bg-sidebar': 'bg-sidebar',
  '--theme-bg-main': 'bg-main',
  '--theme-bg-header': 'bg-header',
  '--theme-bg-header-left': 'bg-header-left',
  '--theme-bg-content': 'bg-content',
  '--theme-bg-user-content': 'bg-user-content',
  '--theme-border-user-content': 'border-user-content',
  '--theme-text-main': 'text-main',
  '--theme-text-dim': 'text-dim',
  '--theme-text-bright': 'text-bright',
  '--theme-text-user': 'text-user',
  '--theme-border-base': 'border-base',
  '--theme-border-header': 'border-header',
  '--theme-border-sidebar': 'border-sidebar',
  '--theme-shadow-sidebar': 'shadow-sidebar',
  '--theme-shadow-active-item': 'shadow-active-item',
  '--theme-bg-active-item': 'bg-active-item',
  '--theme-border-active-item': 'border-active-item',
  '--theme-bg-hover-item': 'bg-hover-item',
  '--theme-bg-hover-btn': 'bg-hover-btn',
  '--theme-accent': 'accent',
  '--theme-accent-dim': 'accent-dim',
  '--chat-input-border-idle': 'chat-input-border-idle',
  '--focus-ring-color': 'focus-ring-color',
  '--focus-ring-shadow': 'focus-ring-shadow',
  '--chat-input-badge-bg': 'chat-input-badge-bg'
}

const defaultVars = {
  '--theme-bg-sidebar': '#F9FAFB',
  '--theme-bg-main': '#FFFFFF',
  '--theme-bg-header-left': 'rgba(249, 250, 251, 0.9)',
  '--theme-border-sidebar': 'rgba(220, 223, 228, 0.35)',
  '--theme-bg-header': '#FFFFFF',
  '--theme-bg-user-content': '#E8F1FF',
  '--theme-border-user-content': '#D7E6FF',
  '--theme-text-main': '#111827',
  '--theme-text-dim': '#6B7280',
  '--theme-text-bright': '#000000',
  '--theme-text-user': '#1F2937',
  '--theme-border-base': '#F3F4F6',
  '--theme-border-header': '#f3f4f6',
  '--theme-shadow-sidebar': '0 0 10px rgba(15, 23, 42, 0.05)',
  '--theme-bg-active-item': 'rgba(229, 231, 235, 0.5)',
  '--theme-border-active-item': '#f3f4f6',
  '--theme-shadow-active-item': 'none',
  '--theme-bg-hover-item': 'rgba(229, 231, 235, 0.5)',
  '--theme-bg-hover-btn': '#f3f4f6',
  '--theme-bg-content': '#F5F5F5',
  '--theme-accent': '#3B82F6',
  '--theme-accent-dim': '#60A5FA',
  '--chat-input-border-idle': '#F3F4F6',
  '--focus-ring-color': 'var(--theme-accent)',
  '--focus-ring-shadow':
    '0 0 6px 0px color-mix(in srgb, var(--focus-ring-color) 18%, transparent), 0 0 12px 2px color-mix(in srgb, var(--focus-ring-color) 8%, transparent)',
  '--chat-input-badge-bg': '#8AA6B3'
}

const withDefaultVars = (vars: Record<string, string>): Record<string, string> => ({
  ...defaultVars,
  ...vars
})

const getThemeVarLabel = (varName: string): string =>
  themeVarLabels[varName] ?? varName.replace(/^--/, '')

const supportsColorPicker = (value: string | undefined, varName: string): boolean => {
  if (!value || varName.includes('shadow')) return false
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
}

onMounted(async () => {
  const data = await loadAppTheme()
  appTheme.value = data.theme
  customThemes.value = data.customThemes
})

const selectTheme = async (themeId: string): Promise<void> => {
  appTheme.value = themeId
  await setAppTheme(themeId, customThemes.value)
}

const startCustomTheme = (): void => {
  isEditing.value = true
  editingTheme.value = {
    id: 'custom-' + Date.now(),
    name: '我的自定义主题',
    vars: withDefaultVars({})
  }
}

const editCustomTheme = (theme: CustomTheme): void => {
  isEditing.value = true
  editingTheme.value = {
    ...JSON.parse(JSON.stringify(theme)),
    vars: withDefaultVars(theme.vars)
  }
}

const cancelEdit = (): void => {
  isEditing.value = false
}

const saveCustomTheme = async (): Promise<void> => {
  if (!editingTheme.value.name) return

  const existingIdx = customThemes.value.findIndex((t) => t.id === editingTheme.value.id)
  if (existingIdx >= 0) {
    customThemes.value[existingIdx] = { ...editingTheme.value }
  } else {
    customThemes.value.push({ ...editingTheme.value })
  }

  await saveCustomThemes(customThemes.value)
  await selectTheme(editingTheme.value.id)
  isEditing.value = false
}

const deleteCustomTheme = async (id: string): Promise<void> => {
  customThemes.value = customThemes.value.filter((t) => t.id !== id)
  await saveCustomThemes(customThemes.value)
  if (appTheme.value === id) {
    await selectTheme('modern')
  }
}
</script>

<style scoped>
.theme-editor-modal-fade-enter-active,
.theme-editor-modal-fade-leave-active {
  transition: opacity 0.12s ease;
}

.theme-editor-modal-fade-enter-from,
.theme-editor-modal-fade-leave-to {
  opacity: 0;
}
</style>
