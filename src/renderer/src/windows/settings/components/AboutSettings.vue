<template>
  <div class="flex-1 flex flex-col gap-3 overflow-y-auto">
    <div
      class="bg-(--theme-bg-main) border border-(--theme-border-base) rounded-2xl p-6 shadow-sm space-y-5"
    >
      <div class="space-y-2">
        <h3 class="text-lg font-bold text-(--theme-text-bright)">关于 PiAgent</h3>
      </div>

      <div class="grid gap-2 text-sm">
        <div class="flex items-center justify-between gap-3">
          <span class="text-(--theme-text-dim)">应用</span>
          <span class="font-semibold text-(--theme-text-main)">PiAgent</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-(--theme-text-dim)">当前版本</span>
          <span class="font-semibold text-(--theme-text-main)">v{{ updateStatus.currentVersion }}</span>
        </div>
        <!-- 状态行已移除，更新结果通过弹窗反馈 -->
        <div
          v-if="latestVersionText"
          class="flex items-center justify-between gap-3"
        >
          <span class="text-(--theme-text-dim)">最新版本</span>
          <span class="font-semibold text-(--theme-text-main)">{{ latestVersionText }}</span>
        </div>
        <div
          v-if="updateStatus.checkedAt"
          class="flex items-center justify-between gap-3"
        >
          <span class="text-(--theme-text-dim)">上次检查</span>
          <span class="text-(--theme-text-main)">{{ formatCheckedAt(updateStatus.checkedAt) }}</span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 h-10 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-sm font-medium text-(--theme-text-main) disabled:opacity-50"
          :disabled="isBusy"
          @click="checkForUpdates"
        >
          <RefreshCw
            :size="16"
            class="shrink-0"
            :class="isChecking || updateStatus.phase === 'checking' ? 'animate-spin' : ''"
          />
          <span>{{ checkButtonLabel }}</span>
        </button>

        <button
          v-if="canDownload"
          type="button"
          class="px-4 h-10 rounded-xl bg-[#00ba88] hover:opacity-90 text-sm font-medium text-white disabled:opacity-50"
          :disabled="isBusy"
          @click="downloadUpdate"
        >
          {{ isDownloading ? '下载中…' : `下载 v${updateStatus.updateInfo?.version ?? ''}` }}
        </button>

        <button
          v-if="updateStatus.phase === 'downloaded'"
          type="button"
          class="px-4 h-10 rounded-xl bg-[#00ba88] hover:opacity-90 text-sm font-medium text-white disabled:opacity-50"
          :disabled="isBusy"
          @click="quitAndInstall"
        >
          重启安装
        </button>

        <button
          type="button"
          class="inline-flex items-center px-4 h-10 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-sm font-medium text-(--theme-text-main)"
          @click="openReleasePage"
        >
          打开 Release
          <ExternalLink class="w-4 h-4 ml-1" />
        </button>
      </div>

      <div
        v-if="updateStatus.phase === 'downloading' && updateStatus.progress"
        class="space-y-2"
      >
        <div class="h-2 rounded-full bg-(--theme-bg-content) overflow-hidden">
          <div
            class="h-full bg-[#00ba88] transition-all duration-200"
            :style="{ width: `${Math.max(0, Math.min(100, updateStatus.progress.percent))}%` }"
          ></div>
        </div>
        <div class="text-xs text-(--theme-text-dim)">
          已下载 {{ Math.floor(updateStatus.progress.percent) }}%
          <span v-if="updateStatus.progress.total > 0">
            · {{ formatBytes(updateStatus.progress.transferred) }} /
            {{ formatBytes(updateStatus.progress.total) }}
          </span>
        </div>
      </div>

      <div
        v-if="resultHint"
        class="text-sm font-medium leading-relaxed"
        :class="resultHintClass"
      >
        {{ resultHint }}
      </div>



      <div
        v-if="updateStatus.updateInfo?.releaseNotes"
        class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) p-3 text-xs text-(--theme-text-dim) whitespace-pre-wrap max-h-36 overflow-y-auto"
      >
        {{ updateStatus.updateInfo.releaseNotes }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ExternalLink, RefreshCw } from 'lucide-vue-next'
import type { AppUpdateStatus } from '@shared/app-update'
import { globalDialog } from '@renderer/utils/dialog'

const updateStatus = reactive<AppUpdateStatus>({
  phase: 'idle',
  currentVersion: '—',
  isPackaged: false,
  supported: false,
  updateInfo: null,
  progress: null,
  error: null,
  releasePageUrl: 'https://github.com/EnjoyWT/PiAgent-GUI/releases',
  checkedAt: null
})

const isChecking = ref(false)
const isDownloading = ref(false)
let stopStatusListener: (() => void) | null = null

const isBusy = computed(
  () => isChecking.value || isDownloading.value || updateStatus.phase === 'downloading'
)

const canDownload = computed(
  () =>
    updateStatus.phase === 'available' ||
    (updateStatus.phase === 'error' && Boolean(updateStatus.updateInfo?.version))
)

const latestVersionText = computed(() => {
  const version = updateStatus.updateInfo?.version
  if (!version) return ''
  if (updateStatus.phase === 'not-available') return `v${version}（已是最新）`
  if (
    updateStatus.phase === 'available' ||
    updateStatus.phase === 'downloading' ||
    updateStatus.phase === 'downloaded'
  ) {
    return `v${version}`
  }
  return `v${version}`
})

const checkButtonLabel = computed(() => {
  if (isChecking.value || updateStatus.phase === 'checking') {
    return '检查中…'
  }
  const current = updateStatus.currentVersion || '—'
  return `检查更新 · v${current}`
})

const resultHint = computed(() => {
  if (updateStatus.phase === 'available' && updateStatus.updateInfo?.version) {
    return `发现最新版本：v${updateStatus.updateInfo.version}`
  }
  if (updateStatus.phase === 'not-available' && updateStatus.updateInfo?.version) {
    return `当前已是最新版本：v${updateStatus.updateInfo.version}`
  }
  if (updateStatus.phase === 'not-available') {
    return `当前已是最新版本：v${updateStatus.currentVersion}`
  }
  if (updateStatus.phase === 'downloaded' && updateStatus.updateInfo?.version) {
    return `v${updateStatus.updateInfo.version} 已下载完成，点击「重启安装」完成升级`
  }
  return ''
})

const resultHintClass = computed(() => {
  if (updateStatus.phase === 'available') return 'text-amber-500'
  if (updateStatus.phase === 'not-available' || updateStatus.phase === 'downloaded') {
    return 'text-emerald-600'
  }
  return 'text-(--theme-text-main)'
})

const applyUpdateStatus = (status: AppUpdateStatus) => {
  updateStatus.phase = status.phase
  updateStatus.currentVersion = status.currentVersion
  updateStatus.isPackaged = status.isPackaged
  updateStatus.supported = status.supported
  updateStatus.updateInfo = status.updateInfo
  updateStatus.progress = status.progress
  updateStatus.error = status.error
  updateStatus.releasePageUrl = status.releasePageUrl
  updateStatus.checkedAt = status.checkedAt
}

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

const formatCheckedAt = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

const loadUpdateStatus = async () => {
  const status = await window.api.appUpdate.getStatus()
  applyUpdateStatus(status)
}

const checkForUpdates = async () => {
  isChecking.value = true
  try {
    const result = await window.api.appUpdate.check()
    applyUpdateStatus(result.status)

    if (result.status.phase === 'error' && result.status.error) {
      await globalDialog.alert({
        title: '检查更新失败',
        message: result.status.error
      })
      return
    }

    if (result.updateAvailable && result.status.updateInfo?.version) {
      await globalDialog.alert({
        title: '发现新版本',
        message: `发现最新版本：v${result.status.updateInfo.version}`
      })
      return
    }

    const latest =
      result.status.updateInfo?.version || result.status.currentVersion || updateStatus.currentVersion
    await globalDialog.alert({
      title: '已是最新版本',
      message: `当前已是最新版本：v${latest}`
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateStatus.phase = 'error'
    updateStatus.error = message
    await globalDialog.alert({
      title: '检查更新失败',
      message
    })
  } finally {
    isChecking.value = false
  }
}

const downloadUpdate = async () => {
  isDownloading.value = true
  try {
    const status = await window.api.appUpdate.download()
    applyUpdateStatus(status)
  } catch (error) {
    updateStatus.phase = 'error'
    updateStatus.error = error instanceof Error ? error.message : String(error)
  } finally {
    isDownloading.value = false
  }
}

const quitAndInstall = async () => {
  try {
    const status = await window.api.appUpdate.quitAndInstall()
    applyUpdateStatus(status)
  } catch (error) {
    updateStatus.phase = 'error'
    updateStatus.error = error instanceof Error ? error.message : String(error)
  }
}

const openReleasePage = async () => {
  const url =
    (updateStatus.releasePageUrl || '').trim() ||
    'https://github.com/EnjoyWT/PiAgent-GUI/releases'
  try {
    // Main process shell.openExternal → system default browser (not in-app).
    await window.api.appUpdate.openReleasePage()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await window.api.openExternal(url)
    } catch {
      await globalDialog.alert({
        title: '无法打开链接',
        message: message || '请手动访问 GitHub Release 页面。',
        detail: url
      })
    }
  }
}

onMounted(async () => {
  await loadUpdateStatus()
  stopStatusListener = window.api.appUpdate.onStatus((status) => {
    applyUpdateStatus(status)
  })
})

onBeforeUnmount(() => {
  stopStatusListener?.()
  stopStatusListener = null
})
</script>
