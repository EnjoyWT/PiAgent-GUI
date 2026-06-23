<template>
  <div class="flex h-full w-full min-w-0 flex-col gap-3">
    <div class="flex items-center justify-between gap-3">
      <div class="relative w-72">
        <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          v-model="query"
          type="text"
          placeholder="搜索插件..."
          class="w-full rounded-lg border border-gray-200 bg-white py-2 pr-3 pl-9 text-xs outline-none focus:ring-1 focus:ring-[#86a5ae]"
        />
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          @click="showSpecModal = true"
        >
          <BookOpen :size="14" />
          规格/模板
        </button>
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
          :disabled="loading"
          title="刷新"
          @click="refreshAgentPlugins()"
        >
          <RefreshCw :size="15" :class="refreshIconSpinning || loading ? 'animate-spin' : ''" />
        </button>
      </div>
    </div>

    <div
      v-if="errorMessage"
      class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
    >
      {{ errorMessage }}
    </div>

    <div
      v-if="diagnostics.length"
      class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"
    >
      <div v-for="diagnostic in diagnostics" :key="diagnostic.manifestPath + diagnostic.code">
        {{ diagnostic.message }}
      </div>
    </div>

    <section
      class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
    >
      <div class="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div class="text-sm font-semibold text-gray-900">插件</div>
        <div class="text-xs text-gray-500">{{ filteredPlugins.length }} / {{ plugins.length }}</div>
      </div>

      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div
          v-for="plugin in filteredPlugins"
          :key="plugin.pluginId"
          class="rounded-xl border border-gray-200 bg-white px-4 py-4"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <Puzzle :size="16" class="shrink-0 text-gray-500" />
                <div class="truncate text-sm font-semibold text-gray-900">
                  {{ plugin.displayName }}
                </div>
                <span
                  class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600"
                >
                  {{ plugin.compatibilitySource }}
                </span>
              </div>
              <div v-if="plugin.description" class="mt-1 truncate text-xs text-gray-500">
                {{ plugin.description }}
              </div>
              <div class="mt-1 text-[11px] text-gray-400">
                {{ plugin.pluginId }} · {{ plugin.version }}
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-3">
              <button
                v-if="pluginViewerUrl(plugin)"
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                @click="openPluginViewer(plugin)"
              >
                <ExternalLink :size="13" />
                打开可视化界面
              </button>

              <button
                type="button"
                class="relative inline-flex h-6 w-12 shrink-0 items-center rounded-full transition"
                :class="plugin.enabled ? 'bg-[#10b981]' : 'bg-gray-300'"
                :aria-checked="plugin.enabled"
                :disabled="busy[plugin.pluginId]"
                :title="plugin.enabled ? '禁用' : '启用'"
                @click="togglePlugin(plugin)"
              >
                <span
                  class="h-5 w-5 rounded-full bg-white shadow-sm transition"
                  :class="plugin.enabled ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>
            </div>
          </div>

          <div class="mt-4 grid gap-2">
            <div
              v-for="component in plugin.components"
              :key="component.type + component.id"
              class="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2 text-xs font-semibold text-gray-800">
                  <span>{{ componentLabel(component.type) }}</span>
                  <Tooltip
                    :text="componentHelpText(component.type)"
                    placement="top"
                    multiline
                    :max-width="280"
                  >
                    <button
                      type="button"
                      class="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-white hover:text-gray-600"
                      aria-label="组件说明"
                    >
                      <CircleHelp :size="13" />
                    </button>
                  </Tooltip>
                  <span
                    v-if="!component.supported"
                    class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800"
                  >
                    暂未支持
                  </span>
                </div>
                <div class="mt-0.5 truncate text-[11px] text-gray-500">{{ component.id }}</div>
              </div>
              <button
                type="button"
                class="relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition"
                :class="component.enabled ? 'bg-[#10b981]' : 'bg-gray-300'"
                :disabled="busy[plugin.pluginId] || !component.supported"
                :aria-checked="component.enabled"
                @click="toggleComponent(plugin, component)"
              >
                <span
                  class="h-4 w-4 rounded-full bg-white shadow-sm transition"
                  :class="component.enabled ? 'translate-x-5' : 'translate-x-1'"
                ></span>
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="!loading && filteredPlugins.length === 0"
          class="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-xs text-gray-500"
        >
          未发现已安装的能力插件。
        </div>
      </div>
    </section>

    <Teleport to="body">
      <Transition name="agent-plugin-spec-modal-fade">
        <div
          v-if="showSpecModal"
          class="fixed inset-0 z-95 flex items-center justify-center bg-black/40 px-4"
          @mousedown.self="showSpecModal = false"
        >
          <div
            class="flex max-h-[86vh] w-full max-w-220 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_30px_80px_rgba(0,0,0,0.25)]"
            role="dialog"
            aria-modal="true"
            aria-label="PiAgent 插件规格和模板"
          >
            <div class="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <div class="min-w-0">
                <div class="text-[15px] font-semibold text-gray-900">
                  PiAgent 插件规格和模板
                </div>
                <div class="mt-1 text-xs text-gray-500">
                  当前项目原生能力插件应使用
                  <span class="font-mono text-gray-700">.piagent-agent-plugin/plugin.json</span>
                  声明，安装后由这里统一启用组件。
                </div>
              </div>
              <button
                type="button"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                aria-label="关闭"
                @click="showSpecModal = false"
              >
                <X :size="16" />
              </button>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div class="grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
                <section class="min-w-0">
                  <div class="text-xs font-semibold text-gray-800">最小目录结构</div>
                  <pre
                    class="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-gray-950 p-3 font-mono text-[11px] leading-5 text-gray-100"
                  >{{ piAgentPluginDirectoryTemplate }}</pre>

                  <div class="mt-4 text-xs font-semibold text-gray-800">
                    plugin.json 模板
                  </div>
                  <pre
                    class="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-gray-950 p-3 font-mono text-[11px] leading-5 text-gray-100"
                  >{{ piAgentPluginManifestTemplate }}</pre>
                </section>

                <section class="min-w-0 space-y-3">
                  <div class="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                    <div class="text-xs font-semibold text-emerald-900">当前支持</div>
                    <div class="mt-2 grid gap-2 text-xs text-emerald-900">
                      <div>
                        <span class="font-mono">skills</span>
                        <span class="text-emerald-800">：技能目录，默认可参与 Agent 运行。</span>
                      </div>
                      <div>
                        <span class="font-mono">mcpServers</span>
                        <span class="text-emerald-800">：插件自带 MCP 配置文件。</span>
                      </div>
                      <div>
                        <span class="font-mono">extensions</span>
                        <span class="text-emerald-800">：PiAgent 运行扩展入口。</span>
                      </div>
                      <div>
                        <span class="font-mono">tools</span>
                        <span class="text-emerald-800">：插件工具定义入口。</span>
                      </div>
                    </div>
                  </div>

                  <div class="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                    <div class="text-xs font-semibold text-amber-900">暂未支持</div>
                    <div class="mt-2 text-xs leading-5 text-amber-900">
                      <span class="font-mono">commands</span>、
                      <span class="font-mono">agents</span>、
                      <span class="font-mono">hooks</span>
                      可以被 manifest 识别并展示，但当前设置页会标记为暂未支持，不能启用。
                    </div>
                  </div>

                  <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <div class="text-xs font-semibold text-gray-800">兼容来源</div>
                    <div class="mt-2 text-xs leading-5 text-gray-600">
                      PiAgent 也会识别 Claude、Codex 和 pi-mono 插件包形态；新插件优先使用
                      <span class="font-mono text-gray-800">domain: "agent-plugin"</span>
                      的 PiAgent 原生规格，避免字段语义不一致。
                    </div>
                  </div>
                </section>
              </div>
            </div>

            <div class="flex justify-end border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                class="h-9 rounded-lg bg-gray-900 px-4 text-xs font-semibold text-white hover:bg-gray-800"
                @click="showSpecModal = false"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { BookOpen, CircleHelp, ExternalLink, Puzzle, RefreshCw, Search, X } from 'lucide-vue-next'
import Tooltip from '@renderer/components/common/Tooltip.vue'
import type {
  AgentPluginComponentSummary,
  InstalledAgentPlugin
} from '../../../../../shared/agent-plugins.ts'

const loading = ref(false)
const refreshIconSpinning = ref(false)
const errorMessage = ref('')
const query = ref('')
const plugins = ref<InstalledAgentPlugin[]>([])
const showSpecModal = ref(false)
const diagnostics = ref<
  Awaited<ReturnType<typeof window.api.agentPlugins.listInstalled>>['diagnostics']
>([])
const busy = reactive<Record<string, boolean>>({})

let refreshIconTimer: ReturnType<typeof setTimeout> | null = null

const filteredPlugins = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  if (!normalized) return plugins.value
  return plugins.value.filter(
    (plugin) =>
      plugin.displayName.toLowerCase().includes(normalized) ||
      plugin.pluginId.toLowerCase().includes(normalized)
  )
})

const piAgentPluginDirectoryTemplate = `my-agent-plugin/
  .piagent-agent-plugin/
    plugin.json
  skills/
    my-skill/
      SKILL.md
  .mcp.json
  tools/
    index.mjs
  extensions/
    index.mjs`

const piAgentPluginManifestTemplate = `{
  "id": "my-agent-plugin",
  "domain": "agent-plugin",
  "apiVersion": "1",
  "version": "0.1.0",
  "displayName": "My Agent Plugin",
  "description": "Add project-specific skills, MCP servers, extensions, and tools.",
  "components": {
    "skills": "./skills",
    "mcpServers": "./.mcp.json",
    "extensions": "./extensions/index.mjs",
    "tools": "./tools/index.mjs"
  },
  "interface": {
    "category": "Development",
    "viewerUrl": "https://example.com/plugin"
  },
  "permissions": {
    "network": [],
    "fs": []
  }
}`

const componentLabel = (type: AgentPluginComponentSummary['type']): string => {
  switch (type) {
    case 'skills':
      return 'Skills'
    case 'mcpServers':
      return 'MCP'
    case 'tools':
      return 'Tools'
    case 'extensions':
      return '运行扩展'
    case 'commands':
      return 'Commands'
    case 'agents':
      return 'Agents'
    case 'hooks':
      return 'Hooks'
    default:
      return type
  }
}

const componentHelpText = (type: AgentPluginComponentSummary['type']): string => {
  switch (type) {
    case 'skills':
      return '加载插件提供的技能目录，让 Agent 可以在任务中使用这些技能。'
    case 'mcpServers':
      return '加载插件提供的 MCP 服务配置，让 Agent 可以连接外部工具服务。'
    case 'tools':
      return '加载插件提供的工具定义，让 Agent 可以直接调用插件工具。'
    case 'extensions':
      return '加载 PiAgent extension。启用后会监听对话事件流并注册插件工具，例如在对话开始前注入上下文、在对话结束后记录结果。'
    case 'commands':
      return '加载插件提供的命令入口。'
    case 'agents':
      return '加载插件提供的子 Agent 或专用 Agent 定义。'
    case 'hooks':
      return '加载插件提供的 hook 配置，在指定运行阶段触发插件逻辑。'
    default:
      return '插件声明的能力组件。启用后，该组件会参与 Agent 运行。'
  }
}

const pluginViewerUrl = (plugin: InstalledAgentPlugin): string => {
  const iface = plugin.manifest.interface
  if (!iface || typeof iface !== 'object' || Array.isArray(iface)) return ''
  const url = (iface as Record<string, unknown>).viewerUrl
  if (typeof url !== 'string') return ''
  const trimmed = url.trim()
  return /^https?:\/\//.test(trimmed) ? trimmed : ''
}

const openPluginViewer = (plugin: InstalledAgentPlugin): void => {
  const url = pluginViewerUrl(plugin)
  if (!url) return
  window.api.openExternal(url)
}

const refresh = async (): Promise<void> => {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await window.api.agentPlugins.listInstalled()
    plugins.value = result.plugins
    diagnostics.value = result.diagnostics
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

const refreshAgentPlugins = async (): Promise<void> => {
  if (refreshIconTimer) clearTimeout(refreshIconTimer)
  refreshIconSpinning.value = true

  try {
    await refresh()
  } finally {
    refreshIconTimer = setTimeout(() => {
      refreshIconSpinning.value = false
      refreshIconTimer = null
    }, 500)
  }
}

onBeforeUnmount(() => {
  if (refreshIconTimer) clearTimeout(refreshIconTimer)
})

const togglePlugin = async (plugin: InstalledAgentPlugin): Promise<void> => {
  busy[plugin.pluginId] = true
  try {
    await window.api.agentPlugins.setEnabled({
      pluginId: plugin.pluginId,
      enabled: !plugin.enabled
    })
    await refresh()
  } finally {
    busy[plugin.pluginId] = false
  }
}

const toggleComponent = async (
  plugin: InstalledAgentPlugin,
  component: AgentPluginComponentSummary
): Promise<void> => {
  busy[plugin.pluginId] = true
  try {
    await window.api.agentPlugins.setComponentEnabled({
      pluginId: plugin.pluginId,
      componentType: component.type,
      componentId: component.id,
      enabled: !component.enabled
    })
    await refresh()
  } finally {
    busy[plugin.pluginId] = false
  }
}

onMounted(() => {
  void refresh()
})
</script>
