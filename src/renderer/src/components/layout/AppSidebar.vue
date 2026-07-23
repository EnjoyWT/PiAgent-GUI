<template>
  <!-- Sidebar -->
  <aside
    data-testid="app-sidebar"
    class="sidebar-shell mb-2.5 flex flex-col relative z-20 shrink-0 overflow-visible rounded-b-xl border-x border-b transition-[width,opacity,box-shadow,background-color,margin] ease-in-out"
    :class="[
      isSidebarVisible ? 'ml-2.5' : 'ml-0',
      isSidebarVisible
        ? 'bg-(--theme-bg-sidebar) border-(--theme-border-sidebar) [box-shadow:var(--theme-shadow-sidebar)] opacity-100'
        : 'bg-transparent border-transparent shadow-none pointer-events-none opacity-0',
      isResizeActive ? 'sidebar-shell--resize-active' : ''
    ]"
    :style="{
      width: isSidebarVisible ? `${props.sidebarWidth}px` : '0px',
      transitionDuration: isSidebarVisible ? (isResizing ? '0ms' : '420ms') : '260ms'
    }"
  >
    <div
      v-if="isSidebarVisible"
      class="sidebar-resize-hotspot absolute top-0 -right-0.75 z-20 h-full w-1.5"
      @mouseenter="setResizeActive(true)"
      @mouseleave="onResizeHoverLeave"
      @mousedown.prevent="onResizeStart"
    ></div>

    <!-- Threads List -->
    <div
      class="sidebar-scroll flex-1 min-h-0 overflow-y-auto px-2 space-y-1 mt-2 transform-gpu transition-all duration-200"
      :class="isSidebarVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'"
    >
      <!-- Subtle empty hint if needed, otherwise empty -->
      <div
        v-if="threadGroups.length === 0"
        class="flex flex-col items-center justify-center py-10 opacity-20 select-none"
      >
        <MessageSquarePlus :size="32" stroke-width="1.5" />
      </div>

      <div
        v-for="(group, groupIndex) in threadGroups"
        :key="group.workspacePath"
        class="flex flex-col"
      >
        <div
          class="group flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm cursor-pointer hover:bg-(--theme-bg-hover-item) text-(--theme-text-main) select-none transition-colors"
          @click="onWorkspaceHeaderClick(group.workspacePath)"
          @contextmenu.prevent="openWorkspaceContextMenu($event, group.workspacePath)"
          @mousedown.left.prevent
          @mouseenter="setHoveredWorkspace(group.workspacePath)"
          @mouseleave="setHoveredWorkspace(null)"
        >
          <template v-if="hoveredWorkspacePath === group.workspacePath">
            <ChevronDown
              :size="16"
              class="text-(--theme-text-dim) transition-transform"
              :class="isGroupExpanded(group.workspacePath) ? 'rotate-0' : '-rotate-90'"
            />
          </template>
          <template v-else>
            <FolderOpen
              v-if="isGroupExpanded(group.workspacePath)"
              :size="16"
              class="text-(--theme-text-dim) shrink-0"
            />
            <FolderClosed v-else :size="16" class="text-(--theme-text-dim) shrink-0" />
          </template>
          <Tooltip
            :text="
              group.workspacePath === TEMP_WORKSPACE_KEY ? '所有的临时会话' : group.workspacePath
            "
            :placement="groupIndex === 0 ? 'bottom' : 'top'"
            :offset="8"
            :offset-x="groupIndex === 0 ? 24 : 15"
            class="min-w-0"
            :style="{ maxWidth: `${props.sidebarWidth - (group.displayName ? 110 : 75)}px` }"
          >
            <span class="truncate font-medium text-(--theme-text-bright)">
              {{ group.folderName }}
            </span>
          </Tooltip>
          <span
            v-if="group.displayName && group.displayName !== group.folderName"
            class="text-xs text-(--theme-text-dim) truncate min-w-0"
            :style="{ maxWidth: `${props.sidebarWidth * 0.3}px` }"
            >{{ group.displayName }}</span
          >
          <div
            class="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <button
              type="button"
              class="p-1 rounded-md text-(--theme-text-dim) hover:text-(--theme-text-bright) hover:bg-(--theme-bg-hover-btn)"
              aria-label="newchat"
              @click.stop="onCreateThreadInWorkspace(group.workspacePath)"
            >
              <SquarePen :size="14" />
            </button>
          </div>
        </div>

        <Transition
          name="group-collapse"
          @before-enter="onGroupBeforeEnter"
          @enter="onGroupEnter"
          @after-enter="onGroupAfterEnter"
          @before-leave="onGroupBeforeLeave"
          @leave="onGroupLeave"
          @after-leave="onGroupAfterLeave"
        >
          <div v-show="isGroupExpanded(group.workspacePath)">
            <div class="space-y-1 pt-1.5 pb-1">
              <div
                v-for="thread in getVisibleThreads(group)"
                :key="thread.id"
                data-testid="thread-item"
                :data-thread-id="thread.id"
                class="group relative flex items-center gap-2 pl-2.5 pr-2.5 py-2 rounded-lg text-sm cursor-pointer border select-none"
                :class="
                  props.activeThreadId === thread.id
                    ? 'bg-(--theme-bg-active-item) [box-shadow:var(--theme-shadow-active-item)] border-(--theme-border-active-item) text-(--theme-text-bright) font-medium'
                    : 'hover:bg-(--theme-bg-hover-item) text-(--theme-text-main) border-transparent'
                "
                @click="emit('selectThread', thread.id)"
                @mousedown.prevent
              >
                <span class="w-4 shrink-0 inline-flex items-center justify-center">
                  <LoaderCircle
                    v-if="isThreadStreaming(thread.id)"
                    :size="14"
                    class="animate-spin text-(--theme-text-dim)"
                  />
                  <span
                    v-else-if="hasRunFinishedIndicator(thread.id)"
                    class="h-2 w-2 rounded-full bg-sky-500/85"
                    aria-label="有已完成的后台回复"
                  ></span>
                </span>
                <span
                  class="block truncate min-w-0 flex-1 pr-11"
                  :style="{ maxWidth: `${props.sidebarWidth - 35}px` }"
                  >{{ thread.title || '新对话' }}</span
                >
                <span
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-(--theme-text-dim) select-none transition-opacity group-hover:opacity-0"
                  :title="'创建于: ' + thread.created_at"
                  >{{ formatCreatedAgo(thread.created_at) }}</span
                >
                <button
                  type="button"
                  class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-(--theme-text-dim) hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
                  aria-label="Delete thread"
                  @click.stop="emit('deleteThread', thread.id)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>

              <!-- Expand/Collapse Buttons -->
              <div
                v-if="group.threads.length > 5 && !isWorkspaceFullyExpanded(group.workspacePath)"
                class="group relative flex items-center gap-2 pl-2.5 pr-2.5 py-2 rounded-lg text-sm cursor-pointer border border-transparent select-none hover:bg-(--theme-bg-hover-item) text-(--theme-text-dim) hover:text-(--theme-text-bright) transition-colors"
                @click="fullyExpandedWorkspaces[group.workspacePath] = true"
              >
                <span class="w-4 shrink-0"></span>
                <span class="block truncate min-w-0 flex-1">展开显示</span>
              </div>
              <div
                v-if="group.threads.length > 5 && isWorkspaceFullyExpanded(group.workspacePath)"
                class="group relative flex items-center gap-2 pl-2.5 pr-2.5 py-2 rounded-lg text-sm cursor-pointer border border-transparent select-none hover:bg-(--theme-bg-hover-item) text-(--theme-text-dim) hover:text-(--theme-text-bright) transition-colors"
                @click="fullyExpandedWorkspaces[group.workspacePath] = false"
              >
                <span class="w-4 shrink-0"></span>
                <span class="block truncate min-w-0 flex-1">收起显示</span>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <transition name="menu">
      <div
        v-if="workspaceContextMenu"
        class="fixed z-50 w-32 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) p-1 shadow-2xl"
        :style="{
          left: `${workspaceContextMenu.x}px`,
          top: `${workspaceContextMenu.y}px`
        }"
        @click.stop
        @contextmenu.prevent
      >
        <button
          type="button"
          class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-(--theme-text-main) transition-colors hover:bg-rose-500/10 hover:text-rose-500"
          @click="deleteWorkspaceFromContextMenu"
        >
          <Trash2 :size="13" />
          <span>删除</span>
        </button>
      </div>
    </transition>

    <!-- Sidebar Footer -->
    <div
      class="p-4 border-t border-(--theme-border-base) space-y-4 shrink-0 transform-gpu transition-all duration-200"
      :class="isSidebarVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'"
    >
      <transition name="menu">
        <div
          v-if="isMenuOpen"
          class="absolute bottom-10 left-1 w-56 bg-(--theme-bg-sidebar) rounded-2xl shadow-2xl border border-(--theme-border-base) py-2 z-50 origin-bottom-left"
          @mouseenter="handleMouseEnter"
          @mouseleave="handleMouseLeave"
        >
          <div
            class="px-4 py-2.5 bg-(--theme-bg-hover-btn) text-(--theme-text-main) flex items-center text-sm cursor-pointer rounded-xl mx-2 mt-1"
            @click="onOpenSettings"
          >
            <SettingsIcon :size="16" class="mr-3 text-(--theme-text-dim)" /> 设置
          </div>
        </div>
      </transition>

      <div class="flex items-center justify-between">
        <div
          class="p-1 hover:bg-(--theme-bg-hover-btn) rounded-md cursor-pointer transition-colors"
          @mouseenter="handleMouseEnter"
          @mouseleave="handleMouseLeave"
        >
          <MoreHorizontal :size="20" class="text-(--theme-text-dim)" />
        </div>
        <button
          v-if="props.updateBadge"
          type="button"
          class="relative flex items-center overflow-hidden px-2.5 py-1.5 rounded-xl text-sm cursor-pointer transition-colors"
          :class="updateBadgeClass"
          aria-label="打开更新设置"
          @click="emit('openUpdateSettings')"
        >
          <component :is="updateBadgeIcon" :size="16" class="mr-1.5 opacity-80" />
          <span>{{ props.updateBadge.label }}</span>
          <span
            v-if="props.updateBadge.progressPercent !== null"
            class="pointer-events-none absolute inset-x-2 bottom-0.75 h-0.5 overflow-hidden rounded-full bg-current/20"
          >
            <span
              class="block h-full rounded-full bg-current transition-[width] duration-200"
              :style="{ width: `${props.updateBadge.progressPercent}%` }"
            ></span>
          </span>
        </button>
      </div>
    </div>
  </aside>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { WorkspaceRow, ThreadRow as SidebarThread } from '../../../../preload/db-types'
import type { AppUpdateSidebarBadge } from '@shared/app-update'
import Tooltip from '../common/Tooltip.vue'
import { useHoverIntent } from '@renderer/composables/useHoverIntent'
import {
  MessageSquarePlus,
  Settings as SettingsIcon,
  MoreHorizontal,
  CircleArrowUp,
  Download,
  Trash2,
  FolderClosed,
  FolderOpen,
  ChevronDown,
  SquarePen,
  LoaderCircle
} from 'lucide-vue-next'

const DEFAULT_SIDEBAR_WIDTH = 260
const MIN_SIDEBAR_WIDTH = 220
const MAX_SIDEBAR_WIDTH = 520

const props = defineProps<{
  isSidebarVisible: boolean
  sidebarWidth: number
  threads: SidebarThread[]
  workspaces: WorkspaceRow[]
  activeThreadId: string | null
  streamingByThreadId: Record<string, boolean>
  runFinishedIndicatorByThreadId: Record<string, boolean>
  updateBadge: AppUpdateSidebarBadge | null
}>()

const emit = defineEmits<{
  (e: 'update:sidebarWidth', value: number): void
  (e: 'update:resizeActive', value: boolean): void
  (e: 'selectThread', value: string): void
  (e: 'selectWorkspace', value: string): void
  (e: 'deleteThread', value: string): void
  (e: 'deleteWorkspace', workspacePath: string): void
  (e: 'openSettings'): void
  (e: 'openUpdateSettings'): void
  (e: 'createThreadInWorkspace', workspacePath: string): void
  (e: 'createThread'): void
  (e: 'createTempThread'): void
}>()

const isMenuOpen = ref(false)
const isResizing = ref(false)
const isResizeActive = ref(false)
const resizeStartX = ref(0)

const TEMP_WORKSPACE_KEY = 'temp-workspaces-group'
const tempWorkspacesRootDir = ref<string>('')

const isTempWorkspacePath = (p: string): boolean => {
  if (tempWorkspacesRootDir.value && p.startsWith(tempWorkspacesRootDir.value)) {
    return true
  }
  return p.toLowerCase().includes('temp-workspaces')
}

onMounted(async () => {
  try {
    const { rootDir } = await window.api.workspace.getTempRoot()
    if (rootDir) {
      tempWorkspacesRootDir.value = rootDir
    }
  } catch {
    // ignore
  }
})
const resizeStartWidth = ref(DEFAULT_SIDEBAR_WIDTH)
const workspaceContextMenu = ref<{ workspacePath: string; x: number; y: number } | null>(null)

const workspaceNameByPath = ref<Record<string, string>>({})
for (const w of props.workspaces) {
  workspaceNameByPath.value[w.path] = w.name ?? ''
}

const expandedWorkspace = ref<Record<string, boolean>>({})
const fullyExpandedWorkspaces = ref<Record<string, boolean>>({})
const hoveredWorkspacePath = ref<string | null>(null)
const getBaseName = (p: string): string => {
  const parts = (p ?? '').replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

const parseDbDate = (value: string): Date | null => {
  if (!value) return null
  const trimmed = value.trim()
  // SQLite datetime('now') => 'YYYY-MM-DD HH:MM:SS' (UTC), not ISO.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)) {
    const iso = trimmed.replace(' ', 'T') + 'Z'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : d
}

const formatCreatedAgo = (createdAt: string): string => {
  const created = parseDbDate(createdAt)
  if (!created) return ''
  const diffMs = Date.now() - created.getTime()
  if (diffMs <= 0) return '刚刚'

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return minutes <= 1 ? '1分' : `${minutes}分`

  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 24) return `${hours}小时`

  const days = Math.floor(diffMs / 86_400_000)
  if (days < 7) return `${days}天`

  const weeks = Math.floor(days / 7)
  if (days < 30) return `${Math.max(1, weeks)}周`

  const months = Math.floor(days / 30)
  if (days < 365) return `${Math.max(1, months)}月`

  const years = Math.floor(days / 365)
  return `${Math.max(1, years)}年`
}

const isThreadStreaming = (threadId: string): boolean =>
  Boolean(props.streamingByThreadId?.[threadId])

const hasRunFinishedIndicator = (threadId: string): boolean =>
  Boolean(props.runFinishedIndicatorByThreadId?.[threadId])

const updateBadgeClass = computed(() => {
  if (!props.updateBadge) return ''
  if (props.updateBadge.tone === 'downloaded') {
    return 'bg-emerald-500/12 text-emerald-600 hover:bg-emerald-500/20'
  }
  if (props.updateBadge.tone === 'downloading') {
    return 'bg-sky-500/12 text-sky-600 hover:bg-sky-500/20'
  }
  if (props.updateBadge.tone === 'error') {
    return 'bg-rose-500/10 text-rose-500 hover:bg-rose-500/18'
  }
  return 'bg-(--theme-accent)/10 text-(--theme-accent) hover:bg-(--theme-accent)/20'
})

const updateBadgeIcon = computed(() => {
  if (!props.updateBadge) return CircleArrowUp
  return props.updateBadge.tone === 'downloading' ? Download : CircleArrowUp
})

const onCreateThreadInWorkspace = (workspacePath: string): void => {
  if (workspacePath === TEMP_WORKSPACE_KEY) {
    emit('createTempThread')
  } else {
    emit('createThreadInWorkspace', workspacePath)
  }
}

const refreshWorkspaceNames = async (): Promise<void> => {
  try {
    const rows = await window.api.db.workspaces.list()
    const next: Record<string, string> = {}
    for (const w of rows) next[w.path] = w.name ?? ''
    workspaceNameByPath.value = next
  } catch {
    // ignore
  }
}

watch(
  () => Array.from(new Set(props.threads.map((s) => s.workspace_path))).join('|'),
  () => {
    void refreshWorkspaceNames()
  }
)

const threadGroups = computed(() => {
  const groupsByPath = new Map<
    string,
    {
      workspacePath: string
      threads: SidebarThread[]
      firstCreatedAtMs: number
    }
  >()

  for (const w of props.workspaces) {
    if (isTempWorkspacePath(w.path)) {
      continue
    }
    groupsByPath.set(w.path, {
      workspacePath: w.path,
      threads: [],
      firstCreatedAtMs: Number.MAX_SAFE_INTEGER
    })
  }

  for (const s of props.threads) {
    const isTemp = isTempWorkspacePath(s.workspace_path)
    const key = isTemp ? TEMP_WORKSPACE_KEY : s.workspace_path
    const ms = parseDbDate(s.created_at)?.getTime()
    const createdAtMs = typeof ms === 'number' && Number.isFinite(ms) ? ms : 0

    let group = groupsByPath.get(key)
    if (!group) {
      group = { workspacePath: key, threads: [], firstCreatedAtMs: createdAtMs }
      groupsByPath.set(key, group)
    }

    group.threads.push(s)
    group.firstCreatedAtMs = Math.min(group.firstCreatedAtMs, createdAtMs)
  }

  const groups = Array.from(groupsByPath.values())
  groups.sort((a, b) => {
    // Keep the temporary sessions group pinned to the very top when it exists.
    if (a.workspacePath === TEMP_WORKSPACE_KEY && b.workspacePath !== TEMP_WORKSPACE_KEY) return -1
    if (b.workspacePath === TEMP_WORKSPACE_KEY && a.workspacePath !== TEMP_WORKSPACE_KEY) return 1

    // Workspaces with threads come first, sorted by thread creation time
    // Workspaces without threads come last
    if (a.threads.length > 0 && b.threads.length === 0) return -1
    if (a.threads.length === 0 && b.threads.length > 0) return 1

    if (a.threads.length > 0 && b.threads.length > 0) {
      const diff = b.firstCreatedAtMs - a.firstCreatedAtMs
      if (diff !== 0) return diff
    }

    return a.workspacePath.localeCompare(b.workspacePath)
  })

  return groups.map(({ firstCreatedAtMs: _firstCreatedAtMs, ...g }) => {
    const isTempGroup = g.workspacePath === TEMP_WORKSPACE_KEY
    const folderName = isTempGroup ? '临时会话' : getBaseName(g.workspacePath)
    const displayName = isTempGroup ? '' : workspaceNameByPath.value[g.workspacePath] || ''
    return { ...g, folderName, displayName }
  })
})

watch(
  () => threadGroups.value.map((g) => g.workspacePath).join('|'),
  (joined) => {
    if (!joined) return
    for (const g of threadGroups.value) {
      if (expandedWorkspace.value[g.workspacePath] === undefined) {
        expandedWorkspace.value[g.workspacePath] = threadGroups.value.length === 1
      }
    }
  },
  { immediate: true }
)

watch(
  [() => props.activeThreadId, () => props.threads],
  ([id, threads]) => {
    if (!id || !threads) return
    const active = threads.find((s) => s.id === id)
    if (!active) return
    const workspaceKey = isTempWorkspacePath(active.workspace_path)
      ? TEMP_WORKSPACE_KEY
      : active.workspace_path
    expandedWorkspace.value[workspaceKey] = true

    // Auto-expand the workspace threads list if active thread is at index >= 5
    const workspaceThreads = threads.filter((s) => {
      const isTargetTemp = isTempWorkspacePath(s.workspace_path)
      const isActiveTemp = isTempWorkspacePath(active.workspace_path)
      return isTargetTemp && isActiveTemp ? true : s.workspace_path === active.workspace_path
    })
    const activeIndex = workspaceThreads.findIndex((s) => s.id === id)
    if (activeIndex >= 5) {
      fullyExpandedWorkspaces.value[workspaceKey] = true
    }
  },
  { immediate: true }
)

const isWorkspaceFullyExpanded = (workspacePath: string): boolean => {
  return !!fullyExpandedWorkspaces.value[workspacePath]
}

const getVisibleThreads = (group: { workspacePath: string; threads: SidebarThread[] }) => {
  if (isWorkspaceFullyExpanded(group.workspacePath) || group.threads.length <= 5) {
    return group.threads
  }
  return group.threads.slice(0, 5)
}

const isGroupExpanded = (workspacePath: string): boolean =>
  expandedWorkspace.value[workspacePath] ?? threadGroups.value.length === 1

const onWorkspaceHeaderClick = (workspacePath: string): void => {
  closeWorkspaceContextMenu()
  toggleGroup(workspacePath)
}

const toggleGroup = (workspacePath: string): void => {
  expandedWorkspace.value[workspacePath] = !isGroupExpanded(workspacePath)
}

const setHoveredWorkspace = (workspacePath: string | null): void => {
  hoveredWorkspacePath.value = workspacePath
}

const openWorkspaceContextMenu = (event: MouseEvent, workspacePath: string): void => {
  if (workspacePath === TEMP_WORKSPACE_KEY) return
  const menuWidth = 128
  const menuHeight = 34
  const margin = 8
  const viewportWidth =
    typeof window === 'undefined' ? event.clientX + menuWidth : window.innerWidth
  const viewportHeight =
    typeof window === 'undefined' ? event.clientY + menuHeight : window.innerHeight
  workspaceContextMenu.value = {
    workspacePath,
    x: clamp(event.clientX, margin, Math.max(margin, viewportWidth - menuWidth - margin)),
    y: clamp(event.clientY, margin, Math.max(margin, viewportHeight - menuHeight - margin))
  }
}

const closeWorkspaceContextMenu = (): void => {
  workspaceContextMenu.value = null
}

const deleteWorkspaceFromContextMenu = (): void => {
  const workspacePath = workspaceContextMenu.value?.workspacePath
  closeWorkspaceContextMenu()
  if (!workspacePath) return
  emit('deleteWorkspace', workspacePath)
}

const onWorkspaceContextMenuKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') closeWorkspaceContextMenu()
}

const footerMenuHover = useHoverIntent({
  groupId: 'sidebar-footer-menu',
  onOpen: () => {
    isMenuOpen.value = true
  },
  onClose: () => {
    isMenuOpen.value = false
  },
  closeDelay: 300
})

const handleMouseEnter = footerMenuHover.enter
const handleMouseLeave = footerMenuHover.close

const onOpenSettings = (): void => {
  emit('openSettings')
  isMenuOpen.value = false
}

const getMaxSidebarWidth = (): number => {
  if (typeof window === 'undefined') return MAX_SIDEBAR_WIDTH
  const viewportMax = Math.floor(window.innerWidth * 0.6)
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, viewportMax))
}

const applySidebarWidth = (nextWidth: number): void => {
  emit('update:sidebarWidth', clamp(nextWidth, MIN_SIDEBAR_WIDTH, getMaxSidebarWidth()))
}

const onResizeMove = (event: MouseEvent): void => {
  const deltaX = event.clientX - resizeStartX.value
  applySidebarWidth(resizeStartWidth.value + deltaX)
}

const stopResize = (): void => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup', stopResize)
    window.removeEventListener('mouseleave', stopResize)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  isResizing.value = false
  setResizeActive(false)
}

const setResizeActive = (value: boolean): void => {
  isResizeActive.value = value
  emit('update:resizeActive', value)
}

const onResizeHoverLeave = (): void => {
  if (!isResizing.value) setResizeActive(false)
}

const onResizeStart = (event: MouseEvent): void => {
  if (!props.isSidebarVisible) return
  isResizing.value = true
  setResizeActive(true)
  resizeStartX.value = event.clientX
  resizeStartWidth.value = props.sidebarWidth
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', stopResize)
  window.addEventListener('mouseleave', stopResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

onMounted(() => {
  void refreshWorkspaceNames()
  window.addEventListener('click', closeWorkspaceContextMenu)
  window.addEventListener('keydown', onWorkspaceContextMenuKeydown)
})

onUnmounted(() => {
  stopResize()
  footerMenuHover.cancel()
  isMenuOpen.value = false
  window.removeEventListener('click', closeWorkspaceContextMenu)
  window.removeEventListener('keydown', onWorkspaceContextMenuKeydown)
})

watch(
  () => props.isSidebarVisible,
  (visible) => {
    if (!visible) {
      stopResize()
      return
    }
    applySidebarWidth(props.sidebarWidth || DEFAULT_SIDEBAR_WIDTH)
  }
)

const onGroupBeforeEnter = (el: Element): void => {
  const node = el as HTMLElement
  node.style.height = '0px'
  node.style.overflow = 'hidden'
  node.style.transformOrigin = 'top'
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

const calcDurationMs = (heightPx: number, base: number, perPx: number, min: number, max: number) =>
  clamp(Math.round(base + heightPx * perPx), min, max)

const onGroupEnter = (el: Element, done: () => void): void => {
  const node = el as HTMLElement
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) {
    node.style.height = 'auto'
    node.style.overflow = ''
    done()
    return
  }

  const targetHeight = node.scrollHeight
  const durationHeight = calcDurationMs(targetHeight, 300, 0.18, 420, 720)
  const durationSpring = durationHeight + 80
  let heightDone = false
  let animDone = false
  const maybeDone = () => {
    if (heightDone && animDone) done()
  }

  const handler = (e: TransitionEvent) => {
    if (e.target !== node) return
    if (e.propertyName !== 'height') return
    node.removeEventListener('transitionend', handler)
    heightDone = true
    maybeDone()
  }
  node.addEventListener('transitionend', handler)
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  node.offsetHeight
  // Approximate iOS spring with a fast ease-out + slight overshoot via keyframes.
  node.style.transition = `height ${durationHeight}ms cubic-bezier(0.16, 1, 0.3, 1)`
  node.style.height = `${targetHeight}px`

  if (typeof node.animate === 'function') {
    const anim = node.animate(
      [
        { opacity: 0, transform: 'translateY(-6px) scale(0.985)' },
        { opacity: 1, transform: 'translateY(2px) scale(1.01)', offset: 0.72 },
        { opacity: 1, transform: 'translateY(0px) scale(1)' }
      ],
      { duration: durationSpring, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
    )
    anim.finished
      .catch(() => undefined)
      .finally(() => {
        animDone = true
        maybeDone()
      })
  } else {
    animDone = true
    maybeDone()
  }
}

const onGroupAfterEnter = (el: Element): void => {
  const node = el as HTMLElement
  node.style.transition = ''
  node.style.height = 'auto'
  node.style.overflow = ''
  node.style.opacity = ''
  node.style.transform = ''
}

const onGroupBeforeLeave = (el: Element): void => {
  const node = el as HTMLElement
  node.style.height = `${node.scrollHeight}px`
  node.style.overflow = 'hidden'
  node.style.transformOrigin = 'top'
}

const onGroupLeave = (el: Element, done: () => void): void => {
  const node = el as HTMLElement
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) {
    node.style.height = '0px'
    done()
    return
  }

  const heightPx = node.scrollHeight
  const durationHeight = calcDurationMs(heightPx, 240, 0.14, 320, 520)
  const durationFade = Math.max(220, Math.round(durationHeight * 0.85))
  let heightDone = false
  let animDone = false
  const maybeDone = () => {
    if (heightDone && animDone) done()
  }

  const handler = (e: TransitionEvent) => {
    if (e.target !== node) return
    if (e.propertyName !== 'height') return
    node.removeEventListener('transitionend', handler)
    heightDone = true
    maybeDone()
  }
  node.addEventListener('transitionend', handler)
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  node.offsetHeight
  node.style.transition = `height ${durationHeight}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
  node.style.height = '0px'

  if (typeof node.animate === 'function') {
    const anim = node.animate(
      [
        { opacity: 1, transform: 'translateY(0px) scale(1)' },
        { opacity: 0, transform: 'translateY(-4px) scale(0.99)' }
      ],
      { duration: durationFade, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' }
    )
    anim.finished
      .catch(() => undefined)
      .finally(() => {
        animDone = true
        maybeDone()
      })
  } else {
    animDone = true
    maybeDone()
  }
}

const onGroupAfterLeave = (el: Element): void => {
  const node = el as HTMLElement
  node.style.transition = ''
  node.style.height = ''
  node.style.overflow = ''
  node.style.opacity = ''
  node.style.transform = ''
}
</script>

<style scoped>
.sidebar-resize-hotspot {
  cursor: col-resize;
}

.sidebar-shell--resize-active {
  border-right-color: rgba(141, 153, 168, 0.9) !important;
}

.sidebar-scroll {
  scrollbar-gutter: stable;
  scrollbar-width: thin !important;
  scrollbar-color: rgba(128, 128, 128, 0.25) transparent;
}

.sidebar-scroll::-webkit-scrollbar {
  display: block !important;
  width: 8px;
}

.sidebar-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-scroll::-webkit-scrollbar-thumb {
  border-radius: 9999px;
  background-color: rgba(128, 128, 128, 0.2);
  border: 2px solid transparent;
  background-clip: content-box;
}

.sidebar-scroll:hover::-webkit-scrollbar-thumb {
  background-color: rgba(128, 128, 128, 0.35);
}

@media (prefers-reduced-motion: reduce) {
  .group-collapse-enter-active,
  .group-collapse-leave-active {
    transition: none !important;
  }
}
</style>
