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
          <span class="font-semibold text-(--theme-text-main)"
            >v{{ updateStatus.currentVersion }}</span
          >
        </div>
        <!-- 状态行已移除，更新结果通过弹窗反馈 -->
        <div v-if="latestVersionText" class="flex items-center justify-between gap-3">
          <span class="text-(--theme-text-dim)">最新版本</span>
          <span class="font-semibold text-(--theme-text-main)">{{ latestVersionText }}</span>
        </div>
        <div v-if="updateStatus.checkedAt" class="flex items-center justify-between gap-3">
          <span class="text-(--theme-text-dim)">上次检查</span>
          <span class="text-(--theme-text-main)">{{
            formatCheckedAt(updateStatus.checkedAt)
          }}</span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="relative inline-flex h-10 min-w-42 items-center justify-center gap-2 overflow-hidden rounded-xl px-4 text-sm font-medium disabled:cursor-default disabled:opacity-75"
          :class="primaryButtonClass"
          :disabled="primaryControl.disabled"
          @click="handlePrimaryUpdateAction"
        >
          <component
            :is="primaryIcon"
            :size="16"
            class="shrink-0"
            :class="updateStatus.phase === 'checking' ? 'animate-spin' : ''"
          />
          <span class="relative z-1">{{ primaryControl.label }}</span>
          <span
            v-if="primaryControl.progressPercent !== null"
            class="pointer-events-none absolute inset-x-3 bottom-1 h-0.5 overflow-hidden rounded-full bg-white/30"
          >
            <span
              class="block h-full rounded-full bg-white transition-[width] duration-200"
              :style="{ width: `${primaryControl.progressPercent}%` }"
            ></span>
          </span>
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

      <div v-if="downloadDetailText" class="text-xs text-(--theme-text-dim)">
        {{ downloadDetailText }}
      </div>

      <div v-if="resultHint" class="text-sm font-medium leading-relaxed" :class="resultHintClass">
        {{ resultHint }}
      </div>

      <div
        v-if="updateStatus.updateInfo?.releaseNotes"
        class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) p-3 text-xs text-(--theme-text-dim) whitespace-pre-wrap max-h-36 overflow-y-auto"
      >
        {{ updateStatus.updateInfo.releaseNotes }}
      </div>
    </div>

    <BaseDialog
      :open="updatePromptOpen"
      aria-label="应用更新"
      width="sm"
      @close="closeUpdatePrompt"
    >
      <template #header>
        <div class="space-y-1">
          <h3 class="text-base font-semibold text-(--theme-text-bright)">
            {{ updatePromptTitle }}
          </h3>
          <p class="text-xs text-(--theme-text-dim)">
            当前 v{{ updateStatus.currentVersion }}，最新 v{{ updatePromptVersion }}
          </p>
        </div>
      </template>

      <div class="space-y-3 text-sm text-(--theme-text-main)">
        <p>{{ updatePromptMessage }}</p>
        <div
          v-if="updatePromptReleaseNotes"
          class="max-h-34 overflow-y-auto rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) p-3 text-xs leading-relaxed text-(--theme-text-dim) whitespace-pre-wrap"
        >
          {{ updatePromptReleaseNotes }}
        </div>
      </div>

      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            class="h-9 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) px-4 text-[13px] text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)"
            @click="closeUpdatePrompt"
          >
            稍后
          </button>
          <button
            v-if="updatePromptPrimaryAction === 'download'"
            type="button"
            class="inline-flex h-9 items-center gap-1.5 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) px-4 text-[13px] text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)"
            @click="handlePromptRelease"
          >
            打开 Release
            <ExternalLink :size="14" />
          </button>
          <button
            type="button"
            class="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#00ba88] px-4 text-[13px] font-semibold text-white hover:opacity-90"
            @click="handlePromptPrimaryAction"
          >
            <component :is="updatePromptPrimaryIcon" :size="14" />
            {{ updatePromptPrimaryLabel }}
          </button>
        </div>
      </template>
    </BaseDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { CircleArrowUp, Download, ExternalLink, RefreshCw } from 'lucide-vue-next'
import BaseDialog from '@renderer/components/common/BaseDialog.vue'
import {
  buildAppUpdatePrimaryControl,
  type AppUpdatePrimaryAction,
  type AppUpdateStatus
} from '@shared/app-update'
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

const updatePromptOpen = ref(false)
const promptedUpdateStatus = ref<AppUpdateStatus | null>(null)
let stopStatusListener: (() => void) | null = null

const primaryControl = computed(() => buildAppUpdatePrimaryControl(updateStatus))

const primaryIcon = computed(() => {
  if (primaryControl.value.action === 'download') return Download
  if (primaryControl.value.action === 'install') return CircleArrowUp
  if (primaryControl.value.action === 'open-release') return ExternalLink
  return RefreshCw
})

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

const primaryButtonClass = computed(() => {
  if (
    primaryControl.value.action === 'download' ||
    primaryControl.value.action === 'install' ||
    updateStatus.phase === 'downloading'
  ) {
    return 'bg-[#00ba88] text-white hover:opacity-90'
  }
  return 'border border-(--theme-border-base) bg-(--theme-bg-sidebar) text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)'
})

const resultHint = computed(() => {
  if (updateStatus.phase === 'error' && updateStatus.error) {
    return updateStatus.error
  }
  if (updateStatus.phase === 'available' && updateStatus.updateInfo?.version) {
    return `发现最新版本：v${updateStatus.updateInfo.version}`
  }
  if (updateStatus.phase === 'downloading') {
    return '正在后台下载更新，关闭这个页面不会中断。'
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
  if (updateStatus.phase === 'error') return 'text-rose-500'
  if (updateStatus.phase === 'available') return 'text-amber-500'
  if (updateStatus.phase === 'not-available' || updateStatus.phase === 'downloaded') {
    return 'text-emerald-600'
  }
  return 'text-(--theme-text-main)'
})

const downloadDetailText = computed(() => {
  if (updateStatus.phase !== 'downloading' || !updateStatus.progress) return ''
  const percent = Math.floor(Math.max(0, Math.min(100, updateStatus.progress.percent)))
  if (updateStatus.progress.total <= 0) return `已下载 ${percent}%`
  return `已下载 ${percent}% · ${formatBytes(updateStatus.progress.transferred)} / ${formatBytes(updateStatus.progress.total)}`
})

const updatePromptControl = computed(() =>
  promptedUpdateStatus.value ? buildAppUpdatePrimaryControl(promptedUpdateStatus.value) : null
)

const updatePromptPrimaryAction = computed<AppUpdatePrimaryAction>(
  () => updatePromptControl.value?.action ?? 'none'
)

const updatePromptVersion = computed(
  () => promptedUpdateStatus.value?.updateInfo?.version ?? updateStatus.updateInfo?.version ?? '—'
)

const updatePromptReleaseNotes = computed(
  () => promptedUpdateStatus.value?.updateInfo?.releaseNotes ?? ''
)

const updatePromptTitle = computed(() =>
  updatePromptPrimaryAction.value === 'install' ? '更新已下载' : '发现新版本'
)

const updatePromptMessage = computed(() => {
  if (updatePromptPrimaryAction.value === 'install') {
    return '更新已下载完成，重启应用即可完成安装。'
  }
  if (updatePromptPrimaryAction.value === 'open-release') {
    return '当前环境不支持应用内下载，请打开 Release 页面手动下载。'
  }
  return '可以现在开始下载。下载会在后台继续，关闭关于页面不会中断。'
})

const updatePromptPrimaryLabel = computed(() => {
  if (updatePromptPrimaryAction.value === 'download') return '立即下载'
  return updatePromptControl.value?.label ?? '确定'
})

const updatePromptPrimaryIcon = computed(() => {
  if (updatePromptPrimaryAction.value === 'download') return Download
  if (updatePromptPrimaryAction.value === 'install') return CircleArrowUp
  if (updatePromptPrimaryAction.value === 'open-release') return ExternalLink
  return RefreshCw
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
  updateStatus.phase = 'checking'
  updateStatus.error = null
  updateStatus.progress = null
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
      openUpdatePrompt(result.status)
      return
    }

    const latest =
      result.status.updateInfo?.version ||
      result.status.currentVersion ||
      updateStatus.currentVersion
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
  }
}

const downloadUpdate = (): void => {
  updateStatus.phase = 'downloading'
  updateStatus.error = null
  updateStatus.progress = updateStatus.progress ?? {
    percent: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0
  }
  void runDownloadUpdate()
}

const runDownloadUpdate = async (): Promise<void> => {
  try {
    const status = await window.api.appUpdate.download()
    applyUpdateStatus(status)
  } catch (error) {
    updateStatus.phase = 'error'
    updateStatus.error = error instanceof Error ? error.message : String(error)
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

const handlePrimaryUpdateAction = async (): Promise<void> => {
  if (primaryControl.value.disabled || primaryControl.value.action === 'none') return
  if (primaryControl.value.action === 'check') {
    await checkForUpdates()
    return
  }
  if (primaryControl.value.action === 'download') {
    downloadUpdate()
    return
  }
  if (primaryControl.value.action === 'install') {
    await quitAndInstall()
    return
  }
  await openReleasePage()
}

const openReleasePage = async () => {
  const url =
    (updateStatus.releasePageUrl || '').trim() || 'https://github.com/EnjoyWT/PiAgent-GUI/releases'
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

const openUpdatePrompt = (status: AppUpdateStatus): void => {
  promptedUpdateStatus.value = status
  updatePromptOpen.value = true
}

const closeUpdatePrompt = (): void => {
  updatePromptOpen.value = false
  promptedUpdateStatus.value = null
}

const handlePromptPrimaryAction = async (): Promise<void> => {
  const action = updatePromptPrimaryAction.value
  closeUpdatePrompt()
  if (action === 'download') {
    downloadUpdate()
    return
  }
  if (action === 'install') {
    await quitAndInstall()
    return
  }
  if (action === 'open-release') {
    await openReleasePage()
  }
}

const handlePromptRelease = async (): Promise<void> => {
  closeUpdatePrompt()
  await openReleasePage()
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
