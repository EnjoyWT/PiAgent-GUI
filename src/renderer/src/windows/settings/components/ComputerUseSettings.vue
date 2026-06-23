<template>
  <div class="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto text-(--theme-text-main)">
    <section class="bg-(--theme-bg-main) border border-(--theme-border-base) rounded-2xl p-6 shadow-sm space-y-5 min-w-0">
      <div class="flex items-start justify-between gap-4 min-w-0">
        <div class="space-y-2 min-w-0">
          <div class="flex items-center gap-2 min-w-0">
            <MousePointerClick :size="18" class="text-(--theme-accent) shrink-0" />
            <h3 class="text-lg font-bold text-(--theme-text-bright) truncate">computer use</h3>
          </div>
          <p class="text-sm text-(--theme-text-dim) leading-relaxed">
            管理 Computer Use 的原生 Helper、系统权限和静默点击验证状态。
          </p>
        </div>
        <div
          class="shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold"
          :class="overallBadgeClass"
        >
          <span class="h-2 w-2 rounded-full" :class="overallDotClass"></span>
          {{ overallStatusText }}
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-4 py-3 min-w-0">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <ShieldCheck :size="16" class="text-(--theme-text-dim) shrink-0" />
              <span class="text-sm font-semibold text-(--theme-text-bright) truncate">辅助功能</span>
            </div>
            <CheckCircle2
              v-if="accessibilityGranted"
              :size="17"
              class="text-[#00ba88] shrink-0"
            />
            <CircleX v-else :size="17" class="text-rose-500 shrink-0" />
          </div>
          <div class="mt-2 text-xs font-medium text-(--theme-text-dim)">
            {{ permissionText(doctor?.permissions.accessibility) }}
          </div>
        </div>

        <div class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-4 py-3 min-w-0">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <MonitorCog :size="16" class="text-(--theme-text-dim) shrink-0" />
              <span class="text-sm font-semibold text-(--theme-text-bright) truncate">屏幕录制</span>
            </div>
            <CheckCircle2
              v-if="screenRecordingGranted"
              :size="17"
              class="text-[#00ba88] shrink-0"
            />
            <CircleX v-else :size="17" class="text-rose-500 shrink-0" />
          </div>
          <div class="mt-2 text-xs font-medium text-(--theme-text-dim)">
            {{ permissionText(doctor?.permissions.screenRecording) }}
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="h-10 px-4 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-[13px] font-semibold text-(--theme-text-main) shadow-sm inline-flex items-center gap-2 transition-colors disabled:opacity-60"
          :disabled="isBusy"
          @click="requestPermissions"
        >
          <ShieldCheck :size="15" class="text-(--theme-text-dim)" />
          请求权限
        </button>
        <button
          type="button"
          class="h-10 px-4 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-[13px] font-semibold text-(--theme-text-main) shadow-sm inline-flex items-center gap-2 transition-colors disabled:opacity-60"
          :disabled="isBusy"
          @click="refreshStatus"
        >
          <RefreshCcw
            :size="15"
            class="text-(--theme-text-dim)"
            :class="isRefreshing ? 'animate-spin' : ''"
          />
          刷新状态
        </button>
        <button
          type="button"
          class="h-10 px-4 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-[13px] font-semibold text-(--theme-text-main) shadow-sm inline-flex items-center gap-2 transition-colors disabled:opacity-60"
          :disabled="isBusy"
          @click="testSetup"
        >
          <TestTube2 :size="15" class="text-(--theme-text-dim)" />
          验证配置
        </button>
      </div>

      <div
        v-if="actionMessage"
        class="rounded-xl border px-4 py-3 text-sm font-medium"
        :class="
          actionTone === 'bad'
            ? 'border-rose-500/20 bg-rose-500/5 text-rose-500'
            : 'border-[#00ba88]/20 bg-[#00ba88]/5 text-[#00ba88]'
        "
      >
        {{ actionMessage }}
      </div>

      <div class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) p-4 min-w-0">
        <div class="flex items-center justify-between gap-3 mb-3">
          <div class="text-sm font-bold text-(--theme-text-bright)">验证结果</div>
          <div v-if="lastUpdatedLabel" class="text-xs font-medium text-(--theme-text-dim) shrink-0">
            {{ lastUpdatedLabel }}
          </div>
        </div>

        <div v-if="report" class="space-y-2">
          <div
            v-for="check in report.checks"
            :key="check.id"
            class="flex items-center justify-between gap-3 rounded-lg bg-(--theme-bg-content) border border-(--theme-border-base) px-3 py-2 min-w-0"
          >
            <div class="flex items-center gap-2 min-w-0">
              <CheckCircle2 v-if="check.ok" :size="17" class="text-[#00ba88] shrink-0" />
              <CircleX v-else :size="17" class="text-rose-500 shrink-0" />
              <span class="text-[13px] font-semibold text-(--theme-text-main) truncate">
                {{ check.label }}
              </span>
            </div>
            <span
              class="text-xs font-semibold shrink-0"
              :class="check.ok ? 'text-[#00ba88]' : 'text-rose-500'"
            >
              {{ check.detail }}
            </span>
          </div>

          <div
            class="mt-3 rounded-lg px-3 py-2 text-[13px] font-semibold"
            :class="report.ready ? 'bg-[#00ba88]/10 text-[#00ba88]' : 'bg-amber-500/10 text-amber-500'"
          >
            {{ report.summary }}
          </div>
        </div>

        <div v-else class="text-sm text-(--theme-text-dim)">尚未读取 Computer Use 状态。</div>
      </div>
    </section>

    <section class="bg-(--theme-bg-main) border border-(--theme-border-base) rounded-2xl p-6 shadow-sm space-y-4 min-w-0">
      <div class="flex items-center gap-2">
        <Info :size="17" class="text-(--theme-accent) shrink-0" />
        <h3 class="text-lg font-bold text-(--theme-text-bright)">Helper 信息</h3>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div
          v-for="item in helperInfoRows"
          :key="item.label"
          class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-4 py-3 min-w-0"
        >
          <div class="text-xs font-semibold text-(--theme-text-dim) mb-1">{{ item.label }}</div>
          <div class="text-sm font-semibold text-(--theme-text-main) truncate">{{ item.value }}</div>
        </div>
      </div>

      <div class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-4 py-3 min-w-0">
        <div class="text-xs font-semibold text-(--theme-text-dim) mb-1">Helper 路径</div>
        <div class="flex items-center gap-3 min-w-0">
          <code class="text-xs text-(--theme-text-main) truncate min-w-0 flex-1">
            {{ doctor?.helper.path ?? '未找到' }}
          </code>
          <button
            v-if="doctor?.helper.path"
            type="button"
            class="h-8 w-8 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) flex items-center justify-center shrink-0 text-(--theme-text-main)"
            title="在 Finder 中显示"
            aria-label="在 Finder 中显示"
            @click="showHelperInFinder"
          >
            <FolderOpen :size="15" class="text-(--theme-text-dim)" />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CheckCircle2,
  CircleX,
  FolderOpen,
  Info,
  MonitorCog,
  MousePointerClick,
  RefreshCcw,
  ShieldCheck,
  TestTube2
} from 'lucide-vue-next'
import {
  buildComputerUseSetupReport,
  type ComputerUseSetupReport
} from '@shared/computer-use-settings'

type ComputerUseDoctor = Awaited<ReturnType<Window['api']['computerUse']['doctor']>>
type PermissionState = ComputerUseDoctor['permissions']['accessibility'] | undefined

const doctor = ref<ComputerUseDoctor | null>(null)
const report = ref<ComputerUseSetupReport | null>(null)
const actionMessage = ref('')
const actionTone = ref<'good' | 'bad'>('good')
const isRefreshing = ref(false)
const isRequestingPermissions = ref(false)
const isTesting = ref(false)
const lastUpdatedAt = ref<Date | null>(null)

const isBusy = computed(
  () => isRefreshing.value || isRequestingPermissions.value || isTesting.value
)
const accessibilityGranted = computed(() => doctor.value?.permissions.accessibility === 'granted')
const screenRecordingGranted = computed(
  () => doctor.value?.permissions.screenRecording === 'granted'
)
const overallReady = computed(() => report.value?.ready === true)
const overallStatusText = computed(() => {
  if (!doctor.value) return '未检测'
  return overallReady.value ? '已就绪' : '需要处理'
})
const overallBadgeClass = computed(() =>
  overallReady.value
    ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
    : 'border-amber-100 bg-amber-50 text-amber-700'
)
const overallDotClass = computed(() => (overallReady.value ? 'bg-emerald-500' : 'bg-amber-500'))
const lastUpdatedLabel = computed(() =>
  lastUpdatedAt.value ? `更新于 ${lastUpdatedAt.value.toLocaleTimeString('zh-CN')}` : ''
)
const helperInfoRows = computed(() => [
  {
    label: '运行阶段',
    value: doctor.value?.stage ?? '未知'
  },
  {
    label: '当前平台',
    value: doctor.value?.platform ?? '未知'
  },
  {
    label: 'CGEventPostToPid',
    value: privateSymbolText(doctor.value?.capabilities.privateSymbols?.cgEventPostToPid)
  },
  {
    label: 'CGEventSetWindowLocation',
    value: privateSymbolText(doctor.value?.capabilities.privateSymbols?.cgEventSetWindowLocation)
  }
])

const permissionText = (state: PermissionState): string => {
  switch (state) {
    case 'granted':
      return '已授权'
    case 'denied':
      return '未授权'
    case 'restricted':
      return '受系统限制'
    case 'not-determined':
      return '尚未请求'
    case 'unknown':
      return '状态未知'
    default:
      return '未检测'
  }
}

const privateSymbolText = (value: boolean | undefined): string => {
  if (value === true) return '已解析'
  if (value === false) return '不可用'
  return '未知'
}

const applyDoctor = (value: ComputerUseDoctor): void => {
  doctor.value = value
  report.value = buildComputerUseSetupReport(value)
  lastUpdatedAt.value = new Date()
}

const refreshStatus = async (): Promise<void> => {
  isRefreshing.value = true
  actionMessage.value = ''
  try {
    applyDoctor(await window.api.computerUse.doctor())
  } catch (error) {
    actionTone.value = 'bad'
    actionMessage.value = error instanceof Error ? error.message : '刷新 Computer Use 状态失败'
  } finally {
    isRefreshing.value = false
  }
}

const requestPermissions = async (): Promise<void> => {
  isRequestingPermissions.value = true
  actionMessage.value = ''
  try {
    const result = await window.api.computerUse.requestPermissions(30_000)
    const nextDoctor = result.doctor as ComputerUseDoctor | undefined
    if (nextDoctor) {
      applyDoctor(nextDoctor)
    } else {
      await refreshStatus()
    }
    actionTone.value = 'good'
    actionMessage.value = '已触发权限请求，请在系统设置中授权 PiAgent Computer Use。'
  } catch (error) {
    actionTone.value = 'bad'
    actionMessage.value = error instanceof Error ? error.message : '请求权限失败'
  } finally {
    isRequestingPermissions.value = false
  }
}

const testSetup = async (): Promise<void> => {
  isTesting.value = true
  actionMessage.value = ''
  try {
    report.value = await window.api.computerUse.testSetup()
    doctor.value = await window.api.computerUse.doctor()
    lastUpdatedAt.value = new Date()
    actionTone.value = report.value.ready ? 'good' : 'bad'
    actionMessage.value = report.value.ready
      ? '验证通过，Computer Use 已可用。'
      : report.value.summary
  } catch (error) {
    actionTone.value = 'bad'
    actionMessage.value = error instanceof Error ? error.message : '验证配置失败'
  } finally {
    isTesting.value = false
  }
}

const showHelperInFinder = (): void => {
  if (!doctor.value?.helper.path) return
  window.api.showItemInFolder(doctor.value.helper.path)
}

onMounted(refreshStatus)
</script>
