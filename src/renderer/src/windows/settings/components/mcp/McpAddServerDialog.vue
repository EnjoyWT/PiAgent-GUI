<script setup lang="ts">
import { ref, watch } from 'vue'
import { X, Terminal, Globe, Plus, Clipboard } from 'lucide-vue-next'

interface Props {
  show: boolean
  initialData?: {
    id?: string
    name: string
    transport_type?: 'stdio' | 'sse' | 'http'
    command?: string
    description?: string
    args?: string
    env?: string
    url?: string
    headers?: string
  }
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', data: any): void
}>()

const name = ref('')
const description = ref('')
const transportType = ref<'stdio' | 'remote'>('stdio')
const command = ref('')
const args = ref('')
const env = ref('')

const remoteUrl = ref('')
const remoteProtocol = ref<'sse' | 'http'>('sse')
const remoteHeaders = ref('')

const resetForm = (data?: any) => {
  name.value = data?.name || ''
  description.value = data?.description || ''

  const dbTransport = data?.transport_type || 'stdio'
  if (dbTransport === 'sse' || dbTransport === 'http') {
    transportType.value = 'remote'
    remoteProtocol.value = dbTransport
  } else {
    transportType.value = 'stdio'
  }

  command.value = data?.command || ''
  args.value = data?.args || ''
  env.value =
    data?.env && typeof data.env === 'object' ? JSON.stringify(data.env, null, 2) : data?.env || ''
  if (env.value === 'null') env.value = ''

  remoteUrl.value = data?.url || ''
  remoteHeaders.value = data?.headers || ''
}

watch(
  () => props.show,
  (val) => {
    if (val) {
      resetForm(props.initialData)
    }
  }
)

const handleConfirm = () => {
  if (!name.value) return
  if (transportType.value === 'stdio' && !command.value) return
  if (transportType.value === 'remote' && !remoteUrl.value) return

  emit('confirm', {
    id:
      props.initialData?.id ||
      name.value
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-_]/g, ''),
    name: name.value.trim(),
    description: description.value.trim(),
    transport_type: transportType.value === 'remote' ? remoteProtocol.value : 'stdio',
    command: transportType.value === 'stdio' ? command.value.trim() : null,
    args: transportType.value === 'stdio' ? args.value.trim() || null : null,
    env: transportType.value === 'stdio' ? env.value.trim() || null : null,
    url: transportType.value === 'remote' ? remoteUrl.value.trim() : null,
    headers: transportType.value === 'remote' ? remoteHeaders.value.trim() || null : null,
    enabled: true
  })
}

const handleImportFromClipboard = async () => {
  try {
    const text = await navigator.clipboard.readText()
    if (text.startsWith('npx') || text.startsWith('node') || text.startsWith('python')) {
      command.value = text
    }
  } catch (err) {
    console.error('Failed to read clipboard', err)
  }
}
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
  >
    <div
      class="bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-2xl w-[500px] max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
    >
      <!-- Header -->
      <div class="p-6 flex items-start justify-between border-b border-(--theme-border-base)">
        <div class="flex gap-4">
          <div
            class="w-12 h-12 rounded-xl bg-(--theme-bg-content) flex items-center justify-center border border-(--theme-border-base)"
          >
            <Terminal :size="24" class="text-(--theme-text-dim)" />
          </div>
          <div>
            <h3 class="text-lg font-semibold text-(--theme-text-bright)">添加服务器</h3>
            <p class="text-xs text-(--theme-text-dim) mt-0.5">添加自定义 MCP 服务器配置</p>
            <button
              class="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-content) hover:bg-(--theme-bg-hover-btn) text-xs text-(--theme-text-main) transition-colors"
              @click="handleImportFromClipboard"
            >
              <Clipboard :size="14" />
              <span>从剪贴板导入</span>
            </button>
          </div>
        </div>
        <button class="text-(--theme-text-dim) hover:text-(--theme-text-main)" @click="emit('close')">
          <X :size="20" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-6 space-y-6">
        <!-- Basic Info -->
        <div class="space-y-4">
          <div
            class="flex items-center gap-2 text-[11px] font-bold text-(--theme-accent) uppercase tracking-widest opacity-80"
          >
            <Terminal :size="14" stroke-width="2.5" />
            <span>Basic Information</span>
          </div>

          <div class="space-y-1.5">
            <label class="text-[13px] font-medium text-(--theme-text-main)"
              >服务器名称 <span class="text-rose-500">*</span></label
            >
            <input
              v-model="name"
              type="text"
              placeholder="我的 MCP 服务器"
              class="w-full px-4 py-2.5 bg-(--theme-bg-content) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none transition-all"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-[13px] font-medium text-(--theme-text-main)">描述</label>
            <input
              v-model="description"
              type="text"
              placeholder="可选描述"
              class="w-full px-4 py-2.5 bg-(--theme-bg-content) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none transition-all"
            />
          </div>
        </div>

        <!-- Transport Type -->
        <div class="space-y-3">
          <label class="text-[13px] font-medium text-(--theme-text-main)">传输类型</label>
          <div class="flex p-1 bg-(--theme-bg-content) rounded-lg border border-(--theme-border-base)">
            <button
              class="flex-1 py-2 flex items-center justify-center gap-2 rounded-lg text-[13px] transition-all border border-transparent"
              :class="
                transportType === 'stdio'
                  ? 'bg-(--theme-bg-sidebar) text-(--theme-accent) border-(--theme-border-base) shadow-sm'
                  : 'text-(--theme-text-dim) hover:text-(--theme-text-main)'
              "
              @click="transportType = 'stdio'"
            >
              <Terminal :size="16" />
              <span>Stdio</span>
            </button>
            <button
              class="flex-1 py-2 flex items-center justify-center gap-2 rounded-lg text-[13px] transition-all border border-transparent"
              :class="
                transportType === 'remote'
                  ? 'bg-(--theme-bg-sidebar) text-(--theme-accent) border-(--theme-border-base) shadow-sm'
                  : 'text-(--theme-text-dim) hover:text-(--theme-text-main)'
              "
              @click="transportType = 'remote'"
            >
              <Globe :size="16" />
              <span>Remote</span>
            </button>
          </div>
        </div>

        <!-- Configuration Section -->
        <div
          v-if="transportType === 'stdio'"
          class="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div
            class="flex items-center gap-2 text-[11px] font-bold text-(--theme-accent) uppercase tracking-widest opacity-80"
          >
            <Terminal :size="14" stroke-width="2.5" />
            <span>Command Configuration</span>
          </div>

          <div class="space-y-1.5">
            <label class="text-[13px] font-medium text-(--theme-text-main)"
              >命令 <span class="text-rose-500">*</span></label
            >
            <input
              v-model="command"
              type="text"
              placeholder="npx -y @modelcontextprotocol/server-..."
              class="w-full px-4 py-2.5 bg-(--theme-bg-content) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) font-mono focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none transition-all"
            />
            <p class="text-[11px] text-(--theme-text-dim)">启动 MCP 服务器的命令</p>
          </div>

          <div class="space-y-1.5">
            <label class="text-[13px] font-medium text-(--theme-text-main)">参数</label>
            <textarea
              v-model="args"
              placeholder="--arg1 val1 --arg2 val2"
              class="w-full px-4 py-2.5 bg-(--theme-bg-content) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) font-mono h-20 resize-none focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none transition-all"
            ></textarea>
          </div>

          <div class="space-y-1.5">
            <label class="text-[13px] font-medium text-(--theme-text-main)">环境变量 (JSON)</label>
            <textarea
              v-model="env"
              placeholder='{ "API_KEY": "..." }'
              class="w-full px-4 py-2.5 bg-(--theme-bg-content) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) font-mono h-24 resize-none focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none transition-all"
            ></textarea>
            <p class="text-[11px] text-(--theme-text-dim)">
              输入用于身份验证的环境变量，例如 Figma API Key。
            </p>
          </div>
        </div>

        <!-- Remote Configuration Section -->
        <div v-else class="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div
            class="flex items-center gap-2 text-[11px] font-bold text-(--theme-accent) uppercase tracking-widest opacity-80"
          >
            <Globe :size="14" stroke-width="2.5" />
            <span>Remote Configuration</span>
          </div>

          <div class="space-y-1.5">
            <label class="text-[13px] font-medium text-(--theme-text-main)"
              >URL <span class="text-rose-500">*</span></label
            >
            <input
              v-model="remoteUrl"
              type="text"
              placeholder="https://api.example.com/mcp/"
              class="w-full px-4 py-2.5 bg-(--theme-bg-content) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) font-mono focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none transition-all"
            />
            <p class="text-[11px] text-(--theme-text-dim)">MCP 服务器的 HTTP 端点 URL</p>
          </div>

          <div class="space-y-2">
            <label class="text-[13px] font-medium text-(--theme-text-main)">传输协议</label>
            <div class="flex p-1 bg-(--theme-bg-content) rounded-lg border border-(--theme-border-base) w-fit">
              <button
                class="px-4 py-1.5 flex items-center justify-center gap-2 rounded-lg text-[13px] transition-all border border-transparent"
                :class="
                  remoteProtocol === 'http'
                    ? 'bg-(--theme-bg-sidebar) text-(--theme-accent) border-(--theme-border-base) shadow-sm'
                    : 'text-(--theme-text-dim) hover:text-(--theme-text-main)'
                "
                @click="remoteProtocol = 'http'"
              >
                <span>Streamable HTTP</span>
              </button>
              <button
                class="px-4 py-1.5 flex items-center justify-center gap-2 rounded-lg text-[13px] transition-all border border-transparent"
                :class="
                  remoteProtocol === 'sse'
                    ? 'bg-(--theme-bg-sidebar) text-(--theme-accent) border-(--theme-border-base) shadow-sm'
                    : 'text-(--theme-text-dim) hover:text-(--theme-text-main)'
                "
                @click="remoteProtocol = 'sse'"
              >
                <span>SSE</span>
              </button>
            </div>
            <p class="text-[11px] text-(--theme-text-dim)">
              推荐使用 Streamable HTTP。对于不支持 Streamable HTTP 的服务器，请选择 SSE。
            </p>
          </div>

          <div class="space-y-1.5">
            <label class="text-[13px] font-medium text-(--theme-text-main)">请求头</label>
            <textarea
              v-model="remoteHeaders"
              placeholder="Authorization: Bearer your-token&#10;Content-Type: application/json"
              class="w-full px-4 py-2.5 bg-(--theme-bg-content) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) font-mono h-32 resize-none focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none transition-all"
            ></textarea>
            <p class="text-[11px] text-(--theme-text-dim) text-pretty leading-relaxed">
              HTTP 请求头，格式为 "Key: Value"，每行一个。
            </p>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="p-6 border-t border-(--theme-border-base) flex justify-end gap-3 bg-(--theme-bg-content)">
        <button
          class="px-6 py-2 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) text-sm font-medium text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn) transition-colors"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          :disabled="!name || !command"
          class="px-6 py-2 rounded-lg bg-(--theme-accent) hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white flex items-center gap-2 shadow-sm transition-all"
          @click="handleConfirm"
        >
          <Plus :size="16" />
          <span>保存</span>
        </button>
      </div>
    </div>
  </div>
</template>
