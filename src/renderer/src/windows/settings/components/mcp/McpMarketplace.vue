<script setup lang="ts">
import { ExternalLink, ShieldCheck, Download, CircleCheckBig } from 'lucide-vue-next'

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

defineProps<{
  servers: McpMarketplaceItem[]
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', server: McpMarketplaceItem): void
  (e: 'install', server: McpMarketplaceItem): void
}>()
</script>

<template>
  <div class="space-y-3">
    <div class="text-[11px] text-(--theme-text-dim)">共 {{ servers.length }} 个服务器</div>

    <div v-if="loading && servers.length === 0" class="space-y-3">
      <div
        v-for="index in 3"
        :key="index"
        class="border border-(--theme-border-base) rounded-2xl p-4 bg-(--theme-bg-sidebar) animate-pulse"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="h-4 w-40 rounded bg-(--theme-bg-hover-item)" />
            <div class="mt-2 h-3 w-24 rounded bg-(--theme-bg-content)" />
            <div class="mt-4 space-y-2">
              <div class="h-3 w-full rounded bg-(--theme-bg-content)" />
              <div class="h-3 w-5/6 rounded bg-(--theme-bg-content)" />
            </div>
            <div class="mt-4 flex gap-2">
              <div class="h-5 w-14 rounded-full bg-(--theme-bg-content)" />
              <div class="h-5 w-16 rounded-full bg-(--theme-bg-content)" />
              <div class="h-5 w-12 rounded-full bg-(--theme-bg-content)" />
            </div>
          </div>
          <div class="flex flex-col items-end gap-2 shrink-0">
            <div class="w-8 h-8 rounded-full bg-(--theme-bg-content)" />
            <div class="mt-2 h-8 w-14 rounded-lg bg-(--theme-bg-content)" />
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="servers.length === 0"
      class="h-40 flex items-center justify-center text-(--theme-text-dim) text-sm"
    >
      暂无可用的 MCP 服务器
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="item in servers"
        :key="item.id"
        class="border border-(--theme-border-base) rounded-2xl p-4 bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-item) transition-colors"
      >
        <div class="flex flex-col gap-3">
          <!-- Title Row: Name + Badges + Install Button -->
          <div class="flex items-center justify-between gap-4">
            <div class="flex items-center gap-2 min-w-0">
              <div class="text-sm font-semibold text-(--theme-text-bright) truncate">
                {{ item.name }}
              </div>
              <span
                class="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-(--theme-bg-content) text-(--theme-text-main) border border-(--theme-border-base)"
              >
                <ShieldCheck :size="11" class="text-(--theme-accent)" />
                已验证
              </span>
              <span
                class="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20"
              >
                精选
              </span>
            </div>

            <div class="flex items-center gap-3 shrink-0">
              <button
                type="button"
                class="group w-8 h-8 rounded-lg flex items-center justify-center text-(--theme-accent) hover:bg-(--theme-bg-hover-btn) transition-all"
                title="查看 GitHub 仓库"
                @click="emit('open', item)"
              >
                <ExternalLink :size="18" class="transition-transform group-hover:scale-110" />
              </button>

              <button
                v-if="!item.installed"
                type="button"
                class="h-7.5 px-3 rounded-lg bg-(--theme-accent) hover:opacity-90 text-[11px] text-white flex items-center gap-1.5 transition-all active:scale-95 shadow-sm"
                @click="emit('install', item)"
              >
                <Download :size="14" />
                <span>安装</span>
              </button>
              <div
                v-else
                class="h-7.5 px-3 rounded-lg bg-[#00ba88]/10 text-[11px] text-[#00ba88] border border-[#00ba88]/20 flex items-center gap-1.5 justify-center cursor-default transition-all"
              >
                <CircleCheckBig :size="14" />
                <span class="font-medium">已安装</span>
              </div>
            </div>
          </div>

          <!-- Info Row: Author + Description + Tags -->
          <div class="min-w-0">
            <div class="text-[11px] text-(--theme-text-dim)">
              {{ item.author }}
            </div>
            <p class="mt-1.5 text-xs text-(--theme-text-main) leading-relaxed">
              {{ item.description }}
            </p>

            <div class="mt-3 flex flex-wrap gap-1.5">
              <span
                v-for="tag in item.tags"
                :key="tag"
                class="inline-flex items-center px-2 py-0.5 rounded-full border border-(--theme-border-base) bg-(--theme-bg-content) text-[10px] text-(--theme-text-dim)"
              >
                {{ tag }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
