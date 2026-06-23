<template>
  <div class="flex-1 flex flex-col gap-3 overflow-y-auto">
    <div class="bg-(--theme-bg-main) border border-(--theme-border-base) rounded-2xl p-6 shadow-sm space-y-5">
      <div class="space-y-2">
        <h3 class="text-lg font-bold text-(--theme-text-bright)">项目管理</h3>
        <p class="text-sm text-(--theme-text-dim) leading-relaxed">
          管理您已创建的项目。删除项目将同时删除其本地目录和对应的聊天记录。
        </p>
      </div>

      <div class="space-y-4">
        <div
          v-if="workspaces.length === 0"
          class="text-center py-12 border-2 border-dashed border-(--theme-border-base) rounded-xl"
        >
          <FolderOpen :size="48" class="mx-auto text-(--theme-text-dim) mb-3" />
          <p class="text-sm text-(--theme-text-dim) font-medium">暂无项目</p>
        </div>

        <div v-else class="grid gap-3">
          <div
            v-for="ws in workspaces"
            :key="ws.path"
            class="group flex items-center justify-between p-4 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:border-(--theme-accent)/30 hover:shadow-sm transition-all"
          >
            <div class="flex items-center gap-4 min-w-0">
              <div
                class="w-10 h-10 rounded-lg bg-(--theme-bg-hover-item) flex items-center justify-center shrink-0 group-hover:bg-(--theme-bg-active-item) transition-colors border border-(--theme-border-base)"
              >
                <FolderOpen :size="20" class="text-(--theme-text-dim) group-hover:text-(--theme-accent)" />
              </div>
              <div class="min-w-0">
                <h4 class="text-[14px] font-semibold text-(--theme-text-bright) truncate">
                  {{ ws.name || '未命名项目' }}
                </h4>
                <p class="text-[12px] text-(--theme-text-dim) truncate mt-0.5 font-mono">
                  {{ ws.path }}
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <button
                class="p-2 text-(--theme-accent) hover:bg-(--theme-bg-hover-btn) rounded-lg transition-colors"
                title="在访达中打开"
                @click="openInFinder(ws.path)"
              >
                <ExternalLink :size="18" />
              </button>
              <button
                class="p-2 text-(--theme-text-dim) hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                title="删除项目"
                @click="confirmDelete(ws)"
              >
                <Trash2 :size="18" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { FolderOpen, Trash2, ExternalLink } from 'lucide-vue-next'
import { globalDialog } from '@renderer/utils/dialog'

interface Workspace {
  path: string
  name: string | null
  created_at: string
  last_opened_at: string | null
}

const workspaces = ref<Workspace[]>([])
let offWorkspacesChanged: (() => void) | null = null

const loadWorkspaces = async () => {
  workspaces.value = await window.api.db.workspaces.list()
}

const openInFinder = async (path: string) => {
  await window.api.openExternal(`file://${path}`)
}

const confirmDelete = async (ws: Workspace) => {
  // First confirmation
  const firstConfirmed = await globalDialog.confirm({
    title: '确认删除项目',
    message: `您确定要删除项目「${ws.name || '未命名项目'}」吗？`,
    detail: '此操作将从项目列表中移除该项目。',
    confirmText: '继续',
    cancelText: '取消',
    danger: true
  })

  if (!firstConfirmed) return

  // Second confirmation
  const secondConfirmed = await globalDialog.confirm({
    title: '极其重要的提醒',
    message: '删除项目将永久清空对应的聊天记录，并物理删除整个项目目录。',
    detail: `项目路径：${ws.path}\n\n警告：删除后无法恢复，请确保您已备份重要数据。`,
    confirmText: '彻底删除',
    cancelText: '我再想想',
    danger: true
  })

  if (!secondConfirmed) return

  try {
    // 1. Delete directory on disk
    await window.api.workspace.deleteDirectory(ws.path)
    // 2. Delete from DB (workspaces + threads)
    await window.api.db.workspaces.delete(ws.path)

    await loadWorkspaces()
  } catch (error) {
    console.error('Failed to delete workspace:', error)
    await globalDialog.alert({
      title: '删除失败',
      message: '删除项目时发生错误',
      detail: String(error)
    })
  }
}

onMounted(() => {
  void loadWorkspaces()
  offWorkspacesChanged = window.api.db.workspaces.onChanged(() => {
    void loadWorkspaces()
  })
})

onUnmounted(() => {
  offWorkspacesChanged?.()
})
</script>
