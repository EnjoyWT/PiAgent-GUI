<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search, SquarePen, PanelLeft, FolderOpen, Bug } from 'lucide-vue-next'
import FloatingTooltip from '../common/FloatingTooltip.vue'
import { useHoverIntent } from '@renderer/composables/useHoverIntent'

const props = defineProps<{
  isSidebarVisible: boolean
  sidebarWidth: number
  isSidebarResizeActive: boolean
  messageCount: number
  workspacePath?: string
  runtimeStatusTone?: 'idle' | 'ok' | 'error'
  isRuntimeDebugVisible?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggleSidebar'): void
  (e: 'createThread'): void
  (e: 'createTempThread'): void
  (e: 'createNewWorkspaceThread'): void
  (e: 'openWorkspaceFolder'): void
  (e: 'toggleRuntimeDebug'): void
  (e: 'openSearch'): void
}>()

const isDropdownOpen = ref(false)

const toggleDropdown = () => {
  isDropdownOpen.value = !isDropdownOpen.value
}

const closeDropdown = () => {
  isDropdownOpen.value = false
}

const handleCreateTemporary = () => {
  closeDropdown()
  emit('createTempThread')
}

const handleCreateInNewWorkspace = () => {
  closeDropdown()
  emit('createNewWorkspaceThread')
}

const tooltip = ref<{ visible: boolean; text: string; left: number; top: number }>({
  visible: false,
  text: '',
  left: 0,
  top: 0
})

const hideTooltip = () => {
  tooltip.value.visible = false
}

let pendingTooltip: { element: HTMLElement; text: string } | null = null
const tooltipHover = useHoverIntent({
  groupId: 'app-header-tooltip',
  onOpen: () => {
    if (!pendingTooltip) return
    const { element: el, text } = pendingTooltip
    const rect = el.getBoundingClientRect()
    tooltip.value = {
      visible: true,
      text,
      left: rect.left + rect.width / 2,
      top: rect.bottom
    }
  },
  onClose: hideTooltip,
  closeDelay: 100
})

const handleTooltipEnter = (event: MouseEvent, text: string): void => {
  const element = event.currentTarget as HTMLElement | null
  if (!element) return
  pendingTooltip = { element, text }
  tooltipHover.enter()
}

const handleTooltipLeave = (): void => {
  pendingTooltip = null
  tooltipHover.close()
}

const workspaceDisplayName = computed(() => {
  const path = (props.workspacePath ?? '').trim()
  if (!path) return '未选择目录'
  const normalized = path.replace(/[\\/]+$/g, '')
  const parts = normalized.split(/[\\/]/)
  return parts[parts.length - 1] || normalized
})
</script>

<template>
  <!-- Top Header -->
  <header
    class="relative h-14 border-b-[0.5px] border-(--theme-border-header) bg-(--theme-bg-header) flex items-center drag-region shrink-0"
  >
    <!-- Left header background: extend 1px below to遮盖 header 底部边框，并在展开时与 sidebar 右侧阴影对齐 -->
    <div
      class="absolute top-2.5 -bottom-px backdrop-blur pointer-events-none rounded-t-xl border-t border-x transition-[width,opacity,box-shadow,background-color,left] ease-in-out"
      :class="[
        isSidebarVisible ? 'left-2.5' : 'left-0',
        isSidebarVisible
          ? 'bg-(--theme-bg-sidebar) border-(--theme-border-sidebar) [box-shadow:var(--theme-shadow-sidebar)] opacity-100'
          : 'bg-transparent border-transparent shadow-none opacity-0'
      ]"
      :style="{
        width: isSidebarVisible ? `${sidebarWidth}px` : '0px',
        transitionDuration: isSidebarVisible ? (isSidebarResizeActive ? '0ms' : '420ms') : '260ms',
        borderRightColor: isSidebarResizeActive ? 'rgba(141, 153, 168, 0.9)' : undefined
      }"
    ></div>

    <!-- Left header area: same width as sidebar when expanded -->
    <div
      class="relative flex items-center h-full rounded-t-xl transition-[width,left] ease-in-out"
      :style="{
        width: isSidebarVisible ? `${sidebarWidth}px` : '180px',
        transitionDuration: isSidebarVisible ? (isSidebarResizeActive ? '0ms' : '420ms') : '260ms'
      }"
    >
      <div class="w-18 shrink-0 h-full flex items-center"></div>
      <!-- Traffic lights placeholder -->
      <div class="flex-1 flex items-center justify-end pr-3 no-drag space-x-1.5 -mt-0.75">
        <button
          class="p-1 hover:bg-(--theme-bg-hover-btn) rounded transition-colors"
          :aria-label="isSidebarVisible ? '收起侧边栏' : '展开侧边栏'"
          @click="emit('toggleSidebar')"
          @mouseenter.stop="
            handleTooltipEnter($event, isSidebarVisible ? '收起侧边栏' : '展开侧边栏')
          "
          @mouseleave.stop="handleTooltipLeave"
        >
          <PanelLeft
            :size="16"
            class="text-gray-500 transform transition-transform duration-200 ease-in-out"
            :class="isSidebarVisible ? 'rotate-0' : 'rotate-180'"
          />
        </button>
        <button
          class="p-1 hover:bg-(--theme-bg-hover-btn) rounded transition-colors"
          aria-label="搜索"
          @click="emit('openSearch')"
          @mouseenter.stop="handleTooltipEnter($event, '搜索')"
          @mouseleave.stop="handleTooltipLeave"
        >
          <Search :size="16" class="text-gray-500" />
        </button>

        <div class="relative">
          <button
            class="p-1 hover:bg-(--theme-bg-hover-btn) rounded transition-colors"
            aria-label="新建会话"
            @click="toggleDropdown"
            @mouseenter.stop="handleTooltipEnter($event, '新建会话')"
            @mouseleave.stop="handleTooltipLeave"
          >
            <SquarePen :size="16" class="text-gray-500" />
          </button>

          <!-- Fullscreen invisible overlay to capture clicks anywhere (including Electron's drag-region) instantly -->
          <div
            v-if="isDropdownOpen"
            class="fixed inset-0 z-40 no-drag cursor-default"
            @click.stop="closeDropdown"
          ></div>

          <transition name="menu">
            <div
              v-if="isDropdownOpen"
              class="absolute top-8 left-1/2 -translate-x-1/2 z-50 w-40 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) p-1 shadow-2xl origin-top text-left"
            >
              <!-- 选项 1: 新建临时会话 -->
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-(--theme-text-main) transition-colors hover:bg-(--theme-bg-hover-btn)"
                @click="handleCreateTemporary"
              >
                <SquarePen :size="14" class="text-gray-400" />
                <span class="font-medium text-(--theme-text-bright)">新建临时会话</span>
              </button>

              <!-- 选项 2: 选择工作目录 -->
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-(--theme-text-main) transition-colors hover:bg-(--theme-bg-hover-btn)"
                @click="handleCreateInNewWorkspace"
              >
                <FolderOpen :size="14" class="text-gray-400" />
                <span class="font-medium text-(--theme-text-bright)">选择工作目录</span>
              </button>
            </div>
          </transition>
        </div>
      </div>
    </div>

    <!-- Center Title -->
    <div
      class="flex-1 flex items-center justify-center text-[11px] font-medium tracking-tight gap-1"
    >
      <div class="text-gray-400">{{ messageCount }} 条消息</div>
      <span class="text-[9px] text-gray-300">•</span>
      <button
        type="button"
        class="flex flex-row items-center gap-1.5 no-drag cursor-pointer text-gray-400 hover:text-gray-700 transition-colors"
        :class="
          props.runtimeStatusTone === 'error'
            ? 'text-red-500 hover:text-red-600'
            : props.runtimeStatusTone === 'ok'
              ? 'text-emerald-600 hover:text-emerald-700'
              : 'text-gray-500 hover:text-gray-700'
        "
        aria-label="打开工作目录"
        @click="emit('openWorkspaceFolder')"
        @mouseenter.stop="handleTooltipEnter($event, props.workspacePath || workspaceDisplayName)"
        @mouseleave.stop="handleTooltipLeave"
      >
        <div class="flex items-center gap-0.5">
          <FolderOpen :size="11" class="inline-block" />
          <span class="truncate max-w-40">{{ workspaceDisplayName }}</span>
        </div>
      </button>
    </div>

    <!-- Right actions -->
    <div class="relative flex items-center justify-end h-full pr-5 no-drag space-x-1.5 shrink-0">
      <button
        type="button"
        class="p-1 hover:bg-(--theme-bg-hover-btn) rounded transition-colors"
        :aria-label="isRuntimeDebugVisible ? '关闭 Runtime Inspector' : '打开 Runtime Inspector'"
        @click="emit('toggleRuntimeDebug')"
        @mouseenter.stop="handleTooltipEnter($event, 'Runtime Inspector')"
        @mouseleave.stop="handleTooltipLeave"
      >
        <Bug
          :size="16"
          class="transition-colors"
          :class="isRuntimeDebugVisible ? 'text-(--theme-accent)' : 'text-gray-500'"
        />
      </button>
    </div>
  </header>

  <FloatingTooltip
    :visible="tooltip.visible"
    :text="tooltip.text"
    :left="tooltip.left"
    :top="tooltip.top"
    placement="bottom"
    :offset-y="10"
    variant="compact"
    :interactive="false"
    @mouseleave="hideTooltip"
  />
</template>
