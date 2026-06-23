<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plug, Search, RefreshCw, Store, Server } from 'lucide-vue-next'
import McpMarketplace from './mcp/McpMarketplace.vue'
import McpInstalledList from './mcp/McpInstalledList.vue'
import McpAddServerDialog from './mcp/McpAddServerDialog.vue'
import { globalDialog } from '../../../utils/dialog'

type McpMarketplaceItem = {
  id: string
  name: string
  author: string
  tags: string[]
  description: string
  detailUrl: string
  installed: boolean
  github?: string
}

type InstalledMcpServer = {
  id: string
  name: string
  description: string | null
  transport_type: 'stdio' | 'sse' | 'http'
  command: string | null
  args: string | null
  env: string | null
  url: string | null
  headers: string | null
  connected: boolean
}

type DbMcpServerRow = {
  id: string
  name: string
  description: string | null
  transport_type: 'stdio' | 'sse' | 'http'
  command: string | null
  args: string | null
  env: string | null
  url: string | null
  headers: string | null
  enabled: number
  created_at: string
}

const activeTab = ref<'marketplace' | 'installed'>('marketplace')
const query = ref('')
const marketplaceServers = ref<McpMarketplaceItem[]>([])
const marketplaceLoading = ref(false)
const marketplacePage = ref(1)
const marketplaceHasMore = ref(false)
const marketplaceNextCursor = ref<string | undefined>(undefined)
const marketplaceError = ref('')
const installedServers = ref<InstalledMcpServer[]>([])
const installedLoading = ref(false)

const showAddServerDialog = ref(false)
const initialDialogData = ref<any>(null)
const installedCount = computed(() => installedServers.value.length)
const installedIdSet = computed(() => new Set(installedServers.value.map((server) => server.id)))
const filteredInstalledServers = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return installedServers.value
  return installedServers.value.filter((item) =>
    `${item.name} ${item.command ?? ''} ${item.url ?? ''} ${item.description ?? ''}`
      .toLowerCase()
      .includes(q)
  )
})

const fromDbRow = (row: DbMcpServerRow): InstalledMcpServer => ({
  id: row.id,
  name: row.name,
  description: row.description,
  transport_type: row.transport_type,
  command: row.command,
  args: row.args,
  env: row.env,
  url: row.url,
  headers: row.headers,
  connected: row.enabled === 1
})

const loadInstalledServers = async (): Promise<void> => {
  installedLoading.value = true
  try {
    const rows = await window.api.db.mcpServers.list()
    installedServers.value = rows.map(fromDbRow)
  } finally {
    installedLoading.value = false
  }
}

const loadMarketplace = async (page: number, append: boolean): Promise<void> => {
  marketplaceLoading.value = true
  try {
    marketplaceError.value = ''
    const result = await window.api.mcp.marketplace.list({
      query: query.value.trim(),
      page,
      limit: 20,
      cursor: append ? marketplaceNextCursor.value : undefined
    })
    const nextItems = result.items.map((item: any) => ({
      ...item,
      installed: installedIdSet.value.has(item.id)
    }))
    marketplaceServers.value = append ? [...marketplaceServers.value, ...nextItems] : nextItems
    marketplacePage.value = result.page
    marketplaceHasMore.value = result.hasMore
    marketplaceNextCursor.value = result.nextCursor
  } catch (error) {
    marketplaceError.value = error instanceof Error ? error.message : 'Marketplace 加载失败'
    if (!append) marketplaceServers.value = []
    marketplaceHasMore.value = false
    marketplaceNextCursor.value = undefined
  } finally {
    marketplaceLoading.value = false
  }
}

const handleRefresh = async (): Promise<void> => {
  await loadInstalledServers()
  if (activeTab.value === 'marketplace') {
    await loadMarketplace(1, false)
  }
}

const handleAddServer = (): void => {
  initialDialogData.value = null
  showAddServerDialog.value = true
}

const handleInstallMarketplaceItem = async (item: McpMarketplaceItem): Promise<void> => {
  const name = item.name.trim()
  const id =
    item.id ||
    name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '')

  await window.api.db.mcpServers.upsert({
    id,
    name,
    description: item.description,
    transport_type: 'stdio',
    command: item.github ? `npx -y github:${item.github}` : '',
    enabled: true
  })

  await loadInstalledServers()
}

const handleConfirmAddServer = async (data: any): Promise<void> => {
  await window.api.db.mcpServers.upsert(data)
  showAddServerDialog.value = false
  await loadInstalledServers()
}

const handleDeleteServer = async (server: InstalledMcpServer): Promise<void> => {
  const ok = await globalDialog.confirm({
    title: '删除 MCP 服务器',
    message: `确定删除 MCP 服务器 "${server.name}" 吗？`,
    confirmText: '删除',
    cancelText: '取消',
    danger: true
  })
  if (!ok) return
  await window.api.db.mcpServers.delete(server.id)
  await loadInstalledServers()
}

const handleEditServer = (server: InstalledMcpServer): void => {
  initialDialogData.value = {
    ...server
  }
  showAddServerDialog.value = true
}

const handleOpenMarketplaceItem = (server: McpMarketplaceItem): void => {
  void window.api.openExternal(server.detailUrl)
}

const handleLoadMore = async (): Promise<void> => {
  if (marketplaceLoading.value || !marketplaceHasMore.value) return
  await loadMarketplace(marketplacePage.value + 1, true)
}

watch(
  () => activeTab.value,
  async (tab) => {
    if (tab === 'marketplace' && marketplaceServers.value.length === 0) {
      await loadMarketplace(1, false)
    }
  },
  { immediate: true }
)

watch(
  () => query.value,
  async () => {
    if (activeTab.value === 'marketplace') {
      await loadMarketplace(1, false)
    }
  }
)

watch(
  () => installedServers.value.map((item) => item.id).join('|'),
  () => {
    marketplaceServers.value = marketplaceServers.value.map((item) => ({
      ...item,
      installed: installedIdSet.value.has(item.id)
    }))
  }
)

void loadInstalledServers()
</script>

<template>
  <div class="flex w-full h-full flex-col gap-3">
    <div class="flex-1 min-h-0 p-6 flex flex-col overflow-hidden w-full">
      <!-- 顶部标题区 -->
      <div class="shrink-0">
        <div class="flex items-center gap-2">
          <Plug :size="18" class="text-(--theme-text-dim)" />
          <h2 class="text-sm font-semibold text-(--theme-text-bright)">MCP 服务器</h2>
        </div>
        <p class="mt-1 text-xs text-(--theme-text-dim)">
          管理模型上下文协议（MCP）服务器，以扩展 Agent 的外部工具和数据源能力。
        </p>
      </div>

      <!-- 顶部 Tab（应用市场 / 已安装） -->
      <div class="mt-5 flex items-center shrink-0">
        <div
          class="flex items-center gap-1 p-1 bg-(--theme-bg-content) rounded-xl border border-(--theme-border-base)"
        >
          <button
            type="button"
            class="group relative h-9 px-6 rounded-lg flex items-center justify-center gap-2 transition-all duration-200 text-sm font-medium border border-transparent"
            :class="
              activeTab === 'marketplace'
                ? 'bg-(--theme-bg-sidebar) text-(--theme-accent) border-(--theme-border-base) shadow-sm'
                : 'text-(--theme-text-dim) hover:text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)'
            "
            @click="activeTab = 'marketplace'"
          >
            <Store
              :size="16"
              :class="
                activeTab === 'marketplace'
                  ? 'text-(--theme-accent)'
                  : 'text-(--theme-text-dim) group-hover:text-(--theme-text-main)'
              "
            />
            <span>应用市场</span>
          </button>

          <button
            type="button"
            class="group relative h-9 px-6 rounded-lg flex items-center justify-center gap-2 transition-all duration-200 text-sm font-medium border border-transparent"
            :class="
              activeTab === 'installed'
                ? 'bg-(--theme-bg-sidebar) text-(--theme-accent) border-(--theme-border-base) shadow-sm'
                : 'text-(--theme-text-dim) hover:text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)'
            "
            @click="activeTab = 'installed'"
          >
            <Server
              :size="16"
              :class="
                activeTab === 'installed'
                  ? 'text-(--theme-accent)'
                  : 'text-(--theme-text-dim) group-hover:text-(--theme-text-main)'
              "
            />
            <span>已安装</span>
            <span
              class="ml-1 inline-flex items-center justify-center rounded-full text-[10px] px-1.5 py-0.5 transition-colors"
              :class="
                activeTab === 'installed'
                  ? 'bg-(--theme-accent)/10 text-(--theme-accent)'
                  : 'bg-(--theme-bg-hover-item) text-(--theme-text-dim) group-hover:bg-(--theme-bg-active-item)'
              "
            >
              {{ installedCount }}
            </span>
          </button>
        </div>
      </div>

      <!-- 搜索 + 操作按钮 -->
      <div class="mt-4 shrink-0 flex items-center gap-3 h-10">
        <div class="relative flex-1">
          <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)" />
          <input
            v-model="query"
            type="text"
            :placeholder="
              activeTab === 'marketplace'
                ? '搜索 Marketplace 中的 MCP 服务器…'
                : '搜索已安装的 MCP 服务器…'
            "
            class="w-full pl-9 pr-3 py-2.5 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-xs text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none"
          />
        </div>

        <button
          type="button"
          class="h-9 w-9 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) flex items-center justify-center text-(--theme-text-main)"
          @click="handleRefresh"
        >
          <RefreshCw :size="14" />
        </button>
        <button
          type="button"
          class="h-9 px-3 rounded-lg border border-(--theme-accent) bg-(--theme-accent) hover:opacity-90 text-[13px] text-white flex items-center gap-2 shadow-sm"
          @click="handleAddServer"
        >
          <span class="text-lg leading-none">+</span>
          添加服务器
        </button>
      </div>

      <!-- 主内容区：根据 Tab 切换内容 -->
      <div class="mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
        <div v-if="activeTab === 'marketplace'" class="space-y-4">
          <div
            v-if="marketplaceError"
            class="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-500"
          >
            {{ marketplaceError }}
          </div>
          <McpMarketplace
            :servers="marketplaceServers"
            :loading="marketplaceLoading"
            @open="handleOpenMarketplaceItem"
            @install="handleInstallMarketplaceItem"
          />
          <div class="flex items-center justify-center">
            <button
              v-if="marketplaceHasMore"
              type="button"
              class="h-9 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-4 text-[12px] text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)"
              :disabled="marketplaceLoading"
              @click="handleLoadMore"
            >
              {{ marketplaceLoading ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </div>
        <McpInstalledList
          v-else
          :servers="filteredInstalledServers"
          @delete="handleDeleteServer"
          @edit="handleEditServer"
        />
      </div>
    </div>
    <McpAddServerDialog
      :show="showAddServerDialog"
      :initial-data="initialDialogData"
      @close="showAddServerDialog = false"
      @confirm="handleConfirmAddServer"
    />
  </div>
</template>
