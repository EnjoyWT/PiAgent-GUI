<script setup lang="ts">
import { Trash2, Settings as Cog } from 'lucide-vue-next'

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

const props = defineProps<{
  servers: InstalledMcpServer[]
}>()

const emit = defineEmits<{
  (e: 'edit', server: InstalledMcpServer): void
  (e: 'delete', server: InstalledMcpServer): void
}>()
</script>

<template>
  <div class="space-y-4">
    <div class="text-[11px] text-(--theme-text-dim)">已安装 {{ servers.length }} 个服务器</div>

    <div
      v-if="servers.length === 0"
      class="h-40 flex items-center justify-center text-(--theme-text-dim) text-sm"
    >
      还没有安装任何 MCP 服务器
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="item in servers"
        :key="item.id"
        class="border border-(--theme-border-base) rounded-2xl px-4 py-3 bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-item) transition-colors flex items-center justify-between gap-4"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <div class="text-sm font-semibold text-(--theme-text-bright)">
              {{ item.name }}
            </div>
            <span
              v-if="item.connected"
              class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#00ba88]/10 text-[#00ba88] border border-[#00ba88]/20"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-[#00ba88]" />
              已连接
            </span>
          </div>
          <div
            class="mt-2 inline-flex items-center gap-2 rounded-lg bg-(--theme-bg-content) border border-(--theme-border-base) px-2.5 py-1 text-[11px] font-mono text-(--theme-text-main)"
          >
            <span class="text-(--theme-text-dim) select-none">
              {{ item.transport_type === 'stdio' ? '$' : '@' }}
            </span>
            <span class="truncate">
              {{
                item.command ||
                item.url ||
                (item.transport_type === 'http' ? 'HTTP Remote Server' : 'SSE Remote Server')
              }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            class="w-9 h-9 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-(--theme-text-main) flex items-center justify-center"
            aria-label="配置 MCP 服务器"
            @click="emit('edit', item)"
          >
            <Cog :size="16" />
          </button>
          <button
            type="button"
            class="w-9 h-9 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-rose-500/10 hover:border-rose-500/20 text-(--theme-text-dim) hover:text-rose-500 flex items-center justify-center"
            aria-label="删除 MCP 服务器"
            @click="emit('delete', item)"
          >
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
