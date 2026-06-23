<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  FolderOpen,
  RefreshCw,
  Power,
  Search,
  Download,
  Trash2,
  ChevronDown,
  ChevronUp,
  FileText
} from 'lucide-vue-next'
import { globalDialog } from '../../../utils/dialog'
import BaseDialog from '@renderer/components/common/BaseDialog.vue'
import SkillInstallModal from './SkillInstallModal.vue'
import SkillPathsManagerModal from './SkillPathsManagerModal.vue'

type SkillItem = {
  name: string
  description: string
  path: string
  source: string
  enabled: boolean
  disableModelInvocation: boolean
}

type SkillDoctor = {
  type: 'warning' | 'error' | 'collision'
  message: string
  path?: string
  collision?: {
    resourceType: string
    name: string
    winnerPath: string
    loserPath: string
  }
}

const loading = ref(false)
const rootDir = ref<string>('')
const defaultRootDir = ref<string>('')
const installRootDir = ref<string>('')
const extraDirs = ref<string[]>([])
const skills = ref<SkillItem[]>([])
const doctor = ref<SkillDoctor[]>([])
const justRefreshed = ref(false)
const refreshIconSpinning = ref(false)
const lastRefreshedAt = ref<number | null>(null)
let refreshedTimer: number | null = null
let refreshIconTimer: number | null = null

const query = ref('')
const contentByName = ref<Record<string, string>>({})
const skillContentDialogOpen = ref(false)
const selectedSkill = ref<SkillItem | null>(null)
const skillContentLoading = ref(false)
const skillContentText = ref('')

const isUnderRootDir = (filePath: string, root: string) => {
  const f = String(filePath ?? '').replace(/\\/g, '/')
  const r = String(root ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  if (!r) return false
  return f === r || f.startsWith(r + '/')
}

const normalizePath = (p: string) => String(p ?? '').replace(/\\/g, '/')

const isUnderAnyDir = (filePath: string, roots: string[]) => {
  const f = normalizePath(filePath)
  return roots.some((r) => isUnderRootDir(f, normalizePath(r)))
}

const containsPathSegment = (filePath: string, segment: string) => {
  const f = normalizePath(filePath)
  const seg = normalizePath(segment).replace(/\/+$/, '')
  if (!seg) return false
  return f === seg || f.startsWith(seg + '/') || f.includes(seg + '/')
}

const filteredSkills = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return skills.value
  return skills.value.filter((s) => {
    const hay = `${s.name}\n${s.description}\n${s.path}`.toLowerCase()
    return hay.includes(q)
  })
})

const enabledCount = computed(() => filteredSkills.value.filter((s) => s.enabled).length)
const disabledCount = computed(() => skills.value.filter((s) => !s.enabled).length)
const bulkEnabling = ref(false)
const pathsModalOpen = ref(false)
const installModalOpen = ref(false)
const installing = ref(false)

const claudeSkillsRoot = computed(() => '/.claude/skills')
const agentsSkillsRoot = computed(() => '/.agents/skills')
const storeSkillsRoot = computed(() => '/.claude/plugins/cache/superpowers-marketplace/superpowers')

type SkillGroupKey = 'personal' | 'claude' | 'agents' | 'store' | 'other'
type SkillGroup = { key: SkillGroupKey; title: string; items: SkillItem[] }
const groupExpanded = ref<Record<string, boolean>>({
  personal: true,
  claude: true,
  agents: true,
  store: true,
  other: true
})

const skillGroups = computed<SkillGroup[]>(() => {
  const list = filteredSkills.value

  const personalRoots = [rootDir.value, ...extraDirs.value].filter(Boolean)

  const isStore = (s: SkillItem) => containsPathSegment(s.path, storeSkillsRoot.value)
  const isClaude = (s: SkillItem) => containsPathSegment(s.path, claudeSkillsRoot.value)
  const isAgents = (s: SkillItem) => containsPathSegment(s.path, agentsSkillsRoot.value)
  const isPersonal = (s: SkillItem) =>
    isUnderAnyDir(s.path, personalRoots) || (!isStore(s) && !isClaude(s) && !isAgents(s))

  const personal = list.filter((s) => isPersonal(s) && !isStore(s) && !isClaude(s) && !isAgents(s))
  const claude = list.filter((s) => isClaude(s))
  const agents = list.filter((s) => isAgents(s))
  const store = list.filter((s) => isStore(s))
  const knownNames = new Set([
    ...personal.map((s) => s.name),
    ...claude.map((s) => s.name),
    ...agents.map((s) => s.name),
    ...store.map((s) => s.name)
  ])
  const other = list.filter((s) => !knownNames.has(s.name))

  const groups: SkillGroup[] = [
    { key: 'personal', title: '个人技能', items: personal },
    { key: 'agents', title: '公共技能', items: agents },
    { key: 'claude', title: 'Claude Code 技能', items: claude },
    { key: 'store', title: '商店技能', items: store },
    { key: 'other', title: '其他', items: other }
  ]
  return groups.filter((g) => g.key === 'personal' || g.items.length > 0)
})

const refresh = async () => {
  if (refreshIconTimer) window.clearTimeout(refreshIconTimer)
  refreshIconSpinning.value = true
  justRefreshed.value = false
  loading.value = true
  try {
    const res = await window.api.skills.list()
    rootDir.value = res.rootDir
    defaultRootDir.value = res.defaultRootDir ?? res.rootDir
    installRootDir.value = res.installRootDir ?? ''
    extraDirs.value = Array.isArray(res.extraDirs) ? res.extraDirs : []
    skills.value = res.skills
    doctor.value = Array.isArray(res.doctor) ? res.doctor : []
    lastRefreshedAt.value = Date.now()
    justRefreshed.value = true
    if (refreshedTimer) window.clearTimeout(refreshedTimer)
    refreshedTimer = window.setTimeout(() => {
      justRefreshed.value = false
      refreshedTimer = null
    }, 3200)
  } finally {
    loading.value = false
    refreshIconTimer = window.setTimeout(() => {
      refreshIconSpinning.value = false
      refreshIconTimer = null
    }, 500)
  }
}

const addSkillDir = async () => {
  const dir = await window.api.dialog.openFolder()
  if (!dir) return
  const res = await window.api.skills.addExtraDir(dir)
  if (!res.success) {
    await globalDialog.alert({
      title: '设置失败',
      message: res.error ? `设置失败：${res.error}` : '设置失败'
    })
    return
  }
  await refresh()
}

const installSkills = async (payload: { source: string; force: boolean }) => {
  if (installing.value) return

  installing.value = true
  try {
    const res = await window.api.skills.install(payload.source, { force: payload.force })
    if (!res.success) {
      await globalDialog.alert({
        title: '安装失败',
        message: res.error ? `安装失败：${res.error}` : '安装失败'
      })
      return
    }

    installModalOpen.value = false
    await refresh()
    const reloadRes = await window.api.runtime.reload()

    const detailLines = [
      `来源：${res.result.repoUrl}#${res.result.ref}`,
      `目录：${res.result.targetDir}`,
      `安装项：${res.result.installedEntries.join(', ') || '无'}`
    ]

    let reloadMessage = '当前没有活跃线程；新技能会在下次线程初始化时加载。'
    if (reloadRes.success) {
      if (reloadRes.reloaded) {
        reloadMessage = '已自动重新加载当前线程；下一条消息即可使用新技能。'
      } else if (reloadRes.deferred) {
        reloadMessage = '当前线程正在运行；会在本轮结束后自动重新加载。'
      } else if (reloadRes.reason === 'not-initialized') {
        reloadMessage = '当前活跃线程尚未初始化 agent；下次发消息时会自动加载新技能。'
      } else if (reloadRes.reason === 'no-target') {
        reloadMessage = '当前没有活跃线程；新技能会在下次线程初始化时加载。'
      }
    } else {
      reloadMessage = reloadRes.error
        ? `自动重新加载失败：${reloadRes.error}`
        : '自动重新加载失败。'
    }

    detailLines.push(`线程：${reloadMessage}`)

    await globalDialog.alert({
      title: '安装完成',
      message: `已安装 ${res.result.installedEntries.length} 个技能项，共 ${res.result.fileCount} 个文件。${reloadRes.success && reloadRes.reloaded ? '当前线程已自动刷新。' : reloadRes.success && reloadRes.deferred ? '当前线程会在本轮结束后自动刷新。' : ''}`,
      detail: detailLines.join('\n')
    })
  } finally {
    installing.value = false
  }
}

const openCurrentFolder = async () => {
  if (!rootDir.value) return
  await window.api.openPath(rootDir.value)
}

const openExtraDir = async (dir: string) => {
  await window.api.openPath(dir)
}

const removeExtraDir = async (dir: string) => {
  await window.api.skills.removeExtraDir(dir)
  await refresh()
}

const toggleEnabled = async (item: SkillItem) => {
  const next = !item.enabled
  item.enabled = next
  try {
    await window.api.skills.setEnabled(item.name, next)
  } catch {
    item.enabled = !next
  }
}

const closeSkillContentDialog = (): void => {
  skillContentDialogOpen.value = false
  selectedSkill.value = null
  skillContentLoading.value = false
  skillContentText.value = ''
}

const openSkillContentDialog = async (item: SkillItem): Promise<void> => {
  selectedSkill.value = item
  skillContentDialogOpen.value = true

  if (contentByName.value[item.name]) {
    skillContentText.value = contentByName.value[item.name]
    return
  }

  skillContentLoading.value = true
  skillContentText.value = ''
  try {
    const res = await window.api.skills.read(item.name)
    if (res.success && typeof res.content === 'string') {
      contentByName.value = { ...contentByName.value, [item.name]: res.content }
      skillContentText.value = res.content
    } else {
      skillContentText.value = res.error ? `读取失败：${res.error}` : '读取失败'
    }
  } finally {
    skillContentLoading.value = false
  }
}

const deleteSkill = async (item: SkillItem) => {
  const ok = await globalDialog.confirm({
    title: '删除技能',
    message: `确定删除技能 "${item.name}" 吗？此操作会删除对应文件/目录。`,
    detail: item.path,
    confirmText: '删除',
    cancelText: '取消',
    danger: true
  })
  if (!ok) return
  const res = await window.api.skills.delete(item.name)
  if (!res.success) {
    await globalDialog.alert({
      title: '删除失败',
      message: res.error ? `删除失败：${res.error}` : '删除失败'
    })
    return
  }
  await refresh()
}

const enableAllSkills = async () => {
  const toEnable = skills.value.filter((s) => !s.enabled)
  if (toEnable.length === 0) return

  const ok = await globalDialog.confirm({
    title: '一键启用技能',
    message: `将启用当前已禁用的 ${toEnable.length} 个技能，允许它们被自动调用。`,
    confirmText: '一键启用',
    cancelText: '取消'
  })
  if (!ok) return

  bulkEnabling.value = true
  try {
    await Promise.all(
      toEnable.map(async (s) => {
        s.enabled = true
        try {
          await window.api.skills.setEnabled(s.name, true)
        } catch {
          s.enabled = false
        }
      })
    )
  } finally {
    bulkEnabling.value = false
  }

  await refresh()
}

onMounted(async () => {
  await refresh()
})

onUnmounted(() => {
  if (refreshedTimer) window.clearTimeout(refreshedTimer)
  refreshedTimer = null
  if (refreshIconTimer) window.clearTimeout(refreshIconTimer)
  refreshIconTimer = null
})
</script>

<template>
  <div class="flex w-full h-full flex-col gap-3">
    <SkillInstallModal
      :open="installModalOpen"
      :loading="installing"
      :target-dir="installRootDir"
      @close="installModalOpen = false"
      @submit="installSkills"
    />
    <SkillPathsManagerModal
      :open="pathsModalOpen"
      :extra-dirs="extraDirs"
      @close="pathsModalOpen = false"
      @add="addSkillDir"
      @open-dir="openExtraDir"
      @remove="removeExtraDir"
    />
    <BaseDialog
      :open="skillContentDialogOpen && Boolean(selectedSkill)"
      aria-label="技能内容详情"
      @close="closeSkillContentDialog"
    >
      <template v-if="selectedSkill" #header>
        <h3 class="text-base font-bold text-(--theme-text-bright)">
          {{ selectedSkill.name }}
        </h3>
        <p class="mt-2 break-all font-mono text-xs text-(--theme-text-dim)">
          {{ selectedSkill.path }}
        </p>
      </template>

      <div
        v-if="skillContentLoading"
        class="max-h-[60vh] overflow-auto rounded-lg border border-(--theme-border-base) bg-(--theme-bg-content) p-3 text-xs leading-5 text-(--theme-text-dim)"
      >
        正在读取…
      </div>
      <pre
        v-else
        class="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-(--theme-border-base) bg-(--theme-bg-content) p-3 font-mono text-xs leading-5 text-(--theme-text-main)"
        >{{ skillContentText || '（空）' }}</pre
      >

      <template #footer>
        <button
          type="button"
          class="rounded-lg bg-(--theme-accent) px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
          @click="closeSkillContentDialog"
        >
          关闭
        </button>
      </template>
    </BaseDialog>

    <div class="flex-1 min-h-0 p-6 flex flex-col overflow-hidden">
      <div class="flex items-start justify-between gap-4 shrink-0">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[14px] text-gray-500">
              {{ filteredSkills.length }} 个技能（已启用 {{ enabledCount }}）
            </span>
          </div>
          <p class="text-xs text-gray-500 mt-1 truncate">
            <button
              v-if="rootDir"
              type="button"
              class="font-mono text-left truncate hover:underline text-gray-700"
              :title="'在 Finder 中打开：' + rootDir"
              @click="openCurrentFolder"
            >
              {{ rootDir }}
              <span class="ml-1 text-[11px] text-gray-400"> （默认） </span>
            </button>
            <span v-else class="text-gray-400">未加载</span>
          </p>
          <div class="mt-3 flex items-center gap-2">
            <div class="text-[11px] text-(--theme-text-dim)">
              <span class="font-semibold text-(--theme-text-main)">自定义技能路径</span>
              <span class="ml-1 text-(--theme-text-dim)">·</span>
              <span class="ml-1">{{ extraDirs.length }} 个</span>
            </div>
            <button
              type="button"
              class="h-7 px-2.5 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-[12px] text-(--theme-text-main) flex items-center gap-1"
              @click="pathsModalOpen = true"
            >
              <FolderOpen :size="14" />
              管理
            </button>
          </div>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <button
            class="inline-flex items-center gap-2 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 py-2 text-xs text-(--theme-text-main) transition hover:bg-(--theme-bg-hover-btn) disabled:cursor-not-allowed disabled:opacity-70"
            type="button"
            :disabled="loading || !rootDir"
            @click="installModalOpen = true"
          >
            <Download :size="14" />
            安装技能
          </button>
          <button
            class="inline-flex w-21 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-70"
            type="button"
            :disabled="loading"
            :class="
              loading
                ? 'border-(--theme-border-base) bg-(--theme-bg-content) text-(--theme-text-dim) cursor-not-allowed'
                : justRefreshed
                  ? 'border-(--theme-accent)/40 bg-(--theme-bg-active-item) text-(--theme-accent)'
                  : 'border-(--theme-border-base) bg-(--theme-bg-sidebar) text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)'
            "
            :title="lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleString() : ''"
            @click="refresh"
          >
            <RefreshCw :size="14" :class="refreshIconSpinning || loading ? 'animate-spin' : ''" />
            <span>{{ loading ? '刷新中…' : justRefreshed ? '已刷新' : '刷新' }}</span>
          </button>
          <button
            v-if="disabledCount > 0"
            class="inline-flex items-center gap-2 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 py-2 text-xs text-(--theme-text-main) transition hover:bg-(--theme-bg-hover-btn) disabled:cursor-not-allowed disabled:opacity-70"
            type="button"
            :disabled="bulkEnabling || loading"
            :title="'启用当前已禁用的 ' + disabledCount + ' 个技能'"
            @click="enableAllSkills"
          >
            <Power :size="14" />
            {{ bulkEnabling ? '启用中…' : '一键启用' }}
          </button>
        </div>
      </div>

      <div class="mt-4 shrink-0">
        <div class="relative">
          <Search
            :size="14"
            class="absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)"
          />
          <input
            v-model="query"
            type="text"
            placeholder="搜索技能名称、描述或路径…（/ 或 ⌘F）"
            class="w-full pl-9 pr-3 py-2 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-xs text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none"
          />
        </div>
      </div>

      <div class="mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
        <div
          v-if="filteredSkills.length === 0"
          class="h-full flex items-center justify-center text-(--theme-text-dim) text-sm"
        >
          没有匹配技能
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="group in skillGroups"
            :key="group.key"
            class="rounded-2xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) overflow-hidden"
          >
            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-(--theme-bg-hover-item)"
              @click="
                groupExpanded = {
                  ...groupExpanded,
                  [group.key]: !groupExpanded[group.key]
                }
              "
            >
              <div class="flex items-center gap-2 min-w-0">
                <div class="text-[13px] font-semibold text-(--theme-text-bright) truncate">
                  {{ group.title }}
                </div>
                <span
                  class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-(--theme-bg-content) text-(--theme-text-main) border border-(--theme-border-base)"
                >
                  {{ group.items.length }}
                </span>
              </div>
              <ChevronUp
                v-if="groupExpanded[group.key]"
                :size="16"
                class="text-(--theme-text-dim)"
              />
              <ChevronDown v-else :size="16" class="text-(--theme-text-dim)" />
            </button>

            <div v-if="groupExpanded[group.key]" class="p-3 pt-0 space-y-3">
              <div
                v-if="group.items.length === 0"
                class="rounded-2xl border border-dashed border-(--theme-border-base) bg-(--theme-bg-content) px-4 py-6 text-center text-[12px] text-(--theme-text-dim)"
              >
                暂无技能
              </div>
              <div
                v-for="item in group.items"
                :key="item.name"
                class="border border-(--theme-border-base) rounded-2xl p-4 bg-(--theme-bg-sidebar) transition-colors"
              >
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <div class="text-sm font-bold text-(--theme-text-bright)">
                        {{ item.name }}
                      </div>
                      <span
                        v-if="item.disableModelInvocation"
                        class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-(--theme-bg-content) text-(--theme-text-main) border border-(--theme-border-base)"
                      >
                        手动调用
                      </span>
                    </div>
                    <div class="text-xs text-(--theme-text-dim) mt-1 line-clamp-2">
                      {{ item.description || '（无描述）' }}
                    </div>
                    <div class="mt-2">
                      <span
                        class="inline-flex items-center gap-2 text-[11px] text-(--theme-text-dim)"
                      >
                        <FileText :size="12" class="text-(--theme-text-dim)" />
                        <span
                          class="font-mono break-all bg-(--theme-bg-content) text-(--theme-text-main) px-2 py-1 rounded-lg"
                          >{{ item.path }}</span
                        >
                      </span>
                    </div>
                  </div>

                  <div class="flex items-center gap-3 shrink-0">
                    <button
                      class="rounded-md border border-(--theme-border-base) px-2 py-1 text-[11px] text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)"
                      type="button"
                      @click="openSkillContentDialog(item)"
                    >
                      详情
                    </button>

                    <!-- Switch -->
                    <button
                      class="relative inline-flex h-6 w-11 items-center rounded-full border transition-colors cursor-pointer"
                      type="button"
                      :class="
                        item.enabled
                          ? 'bg-[#00ba88] border-[#00ba88]'
                          : 'bg-(--theme-bg-hover-item) border-(--theme-border-base)'
                      "
                      :aria-pressed="item.enabled ? 'true' : 'false'"
                      @click="toggleEnabled(item)"
                    >
                      <span
                        class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition"
                        :class="item.enabled ? 'translate-x-5' : 'translate-x-1'"
                      ></span>
                    </button>

                    <button
                      v-if="
                        isUnderRootDir(item.path, rootDir) ||
                        isUnderRootDir(item.path, installRootDir)
                      "
                      class="w-9 h-9 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-rose-500/10 hover:border-rose-500/20 text-(--theme-text-dim) hover:text-rose-500 flex items-center justify-center"
                      type="button"
                      aria-label="Delete skill"
                      @click="deleteSkill(item)"
                    >
                      <Trash2 :size="16" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
