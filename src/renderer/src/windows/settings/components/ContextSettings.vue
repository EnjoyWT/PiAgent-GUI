<template>
  <div class="flex-1 overflow-y-auto pr-1 text-(--theme-text-main)">
    <div class="space-y-5 pb-2">
      <section class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm">
        <div class="space-y-5">
          <div class="space-y-2">
            <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">上下文引擎</h3>
            <p class="max-w-220 text-xs leading-5 text-(--theme-text-dim)">
              独立管理模型真实看到的工作上下文。聊天记录仍保留在 transcript，压缩和重建都由
              ContextEngine 控制。
            </p>
          </div>

          <div class="grid gap-3 md:grid-cols-3">
            <button
              v-for="option in modeOptions"
              :key="option.value"
              type="button"
              class="rounded-xl border px-4 py-3 text-left transition"
              :class="
                draft.mode === option.value
                  ? 'border-(--theme-accent) bg-(--theme-bg-active-item) text-(--theme-accent) shadow-sm'
                  : 'border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:border-(--theme-text-dim) hover:bg-(--theme-bg-hover-btn)'
              "
              @click="draft.mode = option.value"
            >
              <div class="text-sm font-semibold tracking-tight text-(--theme-text-bright)">
                {{ option.label }}
              </div>
              <p class="mt-1 text-xs leading-5 text-(--theme-text-dim)">{{ option.description }}</p>
            </button>
          </div>

          <div class="rounded-xl border border-dashed border-(--theme-border-base) bg-(--theme-bg-content) p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--theme-text-dim)">
                  Config File
                </div>
                <div class="mt-1 break-all text-sm font-medium text-(--theme-text-main)">
                  {{ configPath || '未加载' }}
                </div>
              </div>

              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 py-2 text-xs font-semibold text-(--theme-text-main) transition hover:bg-(--theme-bg-hover-btn)"
                  :disabled="!configPath || saving"
                  @click="openConfigDir"
                >
                  打开配置文件夹
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 py-2 text-xs font-semibold text-(--theme-text-main) transition hover:bg-(--theme-bg-hover-btn)"
                  :disabled="saving"
                  @click="openInspector"
                >
                  打开 Inspector
                </button>
              </div>
            </div>
          </div>

          <div
            v-if="status.text"
            class="rounded-xl px-4 py-3 text-sm"
            :class="
              status.tone === 'success'
                ? 'bg-[#00ba88]/10 text-[#00ba88]'
                : status.tone === 'error'
                  ? 'bg-rose-500/10 text-rose-500'
                  : 'bg-(--theme-bg-content) text-(--theme-text-main)'
            "
          >
            {{ status.text }}
          </div>
        </div>
      </section>

      <section class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm">
        <div class="space-y-5">
          <div class="space-y-2">
            <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">压缩引擎</h3>
            <p class="text-xs leading-5 text-(--theme-text-dim)">
              `noop` 只维持上下文语义层；`summary-compressor` 会生成结构化摘要并在阈值到达时重建
              session。
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <label class="space-y-2">
              <span
                class="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-(--theme-text-main)"
              >
                Engine
                <Tooltip :text="helpText.engine" multiline :max-width="280">
                  <CircleHelp :size="14" class="text-(--theme-accent)/70 hover:text-(--theme-accent) transition-colors" />
                </Tooltip>
              </span>
              <select
                v-model="draft.engine"
                class="h-11 w-full rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 text-sm text-(--theme-text-main) outline-none transition focus:border-(--theme-accent) focus:ring-1 focus:ring-(--theme-accent)"
              >
                <option value="noop">noop</option>
                <option value="summary-compressor">summary-compressor</option>
              </select>
            </label>

            <label class="space-y-2">
              <span
                class="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-(--theme-text-main)"
              >
                摘要超时
                <Tooltip :text="helpText.summaryTimeoutMs" multiline :max-width="280">
                  <CircleHelp :size="14" class="text-(--theme-accent)/70 hover:text-(--theme-accent) transition-colors" />
                </Tooltip>
              </span>
              <input
                v-model.number="draft.summaryTimeoutMs"
                type="number"
                min="1000"
                max="300000"
                step="1000"
                class="h-11 w-full rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 text-sm text-(--theme-text-main) outline-none transition focus:border-(--theme-accent) focus:ring-1 focus:ring-(--theme-accent)"
              />
            </label>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <label class="space-y-2">
              <span
                class="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-(--theme-text-main)"
              >
                摘要模型
                <Tooltip :text="helpText.summaryModel" multiline :max-width="280">
                  <CircleHelp :size="14" class="text-(--theme-accent)/70 hover:text-(--theme-accent) transition-colors" />
                </Tooltip>
              </span>
              <select
                v-model="draft.summaryModel"
                class="h-11 w-full rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 text-sm text-(--theme-text-main) outline-none transition focus:border-(--theme-accent) focus:ring-1 focus:ring-(--theme-accent)"
              >
                <option value="">未选择</option>
                <optgroup
                  v-for="group in groupedModelOptions"
                  :key="group.providerName"
                  :label="group.providerName"
                >
                  <option v-for="item in group.items" :key="item.key" :value="item.key">
                    {{ item.label }}
                  </option>
                </optgroup>
              </select>
            </label>

            <label class="space-y-2">
              <span
                class="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-(--theme-text-main)"
              >
                Fallback 模型
                <Tooltip :text="helpText.summaryFallbackModel" multiline :max-width="280">
                  <CircleHelp :size="14" class="text-(--theme-accent)/70 hover:text-(--theme-accent) transition-colors" />
                </Tooltip>
              </span>
              <select
                v-model="draft.summaryFallbackModel"
                class="h-11 w-full rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 text-sm text-(--theme-text-main) outline-none transition focus:border-(--theme-accent) focus:ring-1 focus:ring-(--theme-accent)"
              >
                <option value="">不设置</option>
                <optgroup
                  v-for="group in groupedModelOptions"
                  :key="`fallback-${group.providerName}`"
                  :label="group.providerName"
                >
                  <option v-for="item in group.items" :key="item.key" :value="item.key">
                    {{ item.label }}
                  </option>
                </optgroup>
              </select>
            </label>
          </div>

          <p
            v-if="
              draft.engine === 'summary-compressor' && draft.mode !== 'off' && !draft.summaryModel
            "
            class="text-xs leading-5 text-amber-500"
          >
            当前启用了 `summary-compressor`，但还没有选择摘要模型。manual / auto 压缩不会真正执行。
          </p>
        </div>
      </section>

      <section class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm">
        <div class="space-y-5">
          <div class="space-y-2">
            <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">触发阈值</h3>
            <p class="text-xs leading-5 text-(--theme-text-dim)">
              `usage_backed` 和 `heuristic_only` 分开控制。自定义 provider 或 fresh thread
              会走更宽松的估算阈值。
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-3">
            <label class="space-y-2">
              <span
                class="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-(--theme-text-main)"
              >
                精确阈值
                <Tooltip :text="helpText.thresholdPercent" multiline :max-width="280">
                  <CircleHelp :size="14" class="text-(--theme-accent)/70 hover:text-(--theme-accent) transition-colors" />
                </Tooltip>
              </span>
              <input
                v-model.number="draft.trigger.thresholdPercent"
                type="number"
                min="0.1"
                max="0.95"
                step="0.01"
                class="h-11 w-full rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 text-sm text-(--theme-text-main) outline-none transition focus:border-(--theme-accent) focus:ring-1 focus:ring-(--theme-accent)"
              />
            </label>

            <label class="space-y-2">
              <span
                class="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-(--theme-text-main)"
              >
                估算阈值
                <Tooltip :text="helpText.estimatedThresholdPercent" multiline :max-width="280">
                  <CircleHelp :size="14" class="text-(--theme-accent)/70 hover:text-(--theme-accent) transition-colors" />
                </Tooltip>
              </span>
              <input
                v-model.number="draft.trigger.estimatedThresholdPercent"
                type="number"
                min="0.1"
                max="0.99"
                step="0.01"
                class="h-11 w-full rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 text-sm text-(--theme-text-main) outline-none transition focus:border-(--theme-accent) focus:ring-1 focus:ring-(--theme-accent)"
              />
            </label>

            <label class="space-y-2">
              <span
                class="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-(--theme-text-main)"
              >
                保留输出 tokens
                <Tooltip :text="helpText.reserveOutputTokens" multiline :max-width="280">
                  <CircleHelp :size="14" class="text-(--theme-accent)/70 hover:text-(--theme-accent) transition-colors" />
                </Tooltip>
              </span>
              <input
                v-model.number="draft.trigger.reserveOutputTokens"
                type="number"
                min="256"
                max="200000"
                step="256"
                class="h-11 w-full rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 text-sm text-(--theme-text-main) outline-none transition focus:border-(--theme-accent) focus:ring-1 focus:ring-(--theme-accent)"
              />
            </label>
          </div>
        </div>
      </section>

      <section class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm">
        <div class="space-y-5">
          <div class="space-y-2">
            <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">保留策略</h3>
            <p class="text-xs leading-5 text-(--theme-text-dim)">
              头部保留最早的关键条目，尾部保留最近的活跃条目，中间段才会进入结构化摘要。
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-3">
            <label class="space-y-2">
              <span
                class="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-(--theme-text-main)"
              >
                保护头部条目
                <Tooltip :text="helpText.protectFirstEntries" multiline :max-width="280">
                  <CircleHelp :size="14" class="text-(--theme-accent)/70 hover:text-(--theme-accent) transition-colors" />
                </Tooltip>
              </span>
              <input
                v-model.number="draft.limits.protectFirstEntries"
                type="number"
                min="0"
                max="500"
                step="1"
                class="h-11 w-full rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 text-sm text-(--theme-text-main) outline-none transition focus:border-(--theme-accent) focus:ring-1 focus:ring-(--theme-accent)"
              />
            </label>

            <label class="space-y-2">
              <span
                class="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-(--theme-text-main)"
              >
                保护尾部条目
                <Tooltip :text="helpText.protectLastEntries" multiline :max-width="280">
                  <CircleHelp :size="14" class="text-(--theme-accent)/70 hover:text-(--theme-accent) transition-colors" />
                </Tooltip>
              </span>
              <input
                v-model.number="draft.limits.protectLastEntries"
                type="number"
                min="1"
                max="1000"
                step="1"
                class="h-11 w-full rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 text-sm text-(--theme-text-main) outline-none transition focus:border-(--theme-accent) focus:ring-1 focus:ring-(--theme-accent)"
              />
            </label>

            <label class="space-y-2">
              <span
                class="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-(--theme-text-main)"
              >
                摘要预算上限
                <Tooltip :text="helpText.summaryBudgetCap" multiline :max-width="280">
                  <CircleHelp :size="14" class="text-(--theme-accent)/70 hover:text-(--theme-accent) transition-colors" />
                </Tooltip>
              </span>
              <input
                v-model.number="draft.limits.summaryBudgetCap"
                type="number"
                min="256"
                max="200000"
                step="256"
                class="h-11 w-full rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 text-sm text-(--theme-text-main) outline-none transition focus:border-(--theme-accent) focus:ring-1 focus:ring-(--theme-accent)"
              />
            </label>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { CircleHelp } from 'lucide-vue-next'
import type { ContextEngineConfig, ContextEngineMode } from '@shared/context-engine'
import Tooltip from '@renderer/components/common/Tooltip.vue'

type ModelOption = {
  key: string
  providerName: string
  label: string
}

const modeOptions: Array<{ value: ContextEngineMode; label: string; description: string }> = [
  {
    value: 'off',
    label: 'Off',
    description: '保留 ContextStore，但不做手动或自动压缩。'
  },
  {
    value: 'manual',
    label: 'Manual',
    description: '允许手动 compact，默认不在 prompt 前自动介入。'
  },
  {
    value: 'auto',
    label: 'Auto',
    description: '在本地 runtime 执行前自动评估并按需重建 session。'
  }
]

const helpText = {
  engine:
    '选择上下文引擎。`noop` 只维护语义层，不执行摘要压缩；`summary-compressor` 会把中间历史压缩成结构化摘要。',
  summaryTimeoutMs:
    '单次摘要请求允许等待的最长时间，单位毫秒。超时后这次压缩会失败，不会写入新的摘要记录。',
  summaryModel: '优先用于生成压缩摘要的模型。手动压缩和自动压缩都会优先走这里配置的模型。',
  summaryFallbackModel:
    '当摘要模型不可用或调用失败时，按顺序尝试的备用模型。留空表示只使用主摘要模型。',
  thresholdPercent:
    '精确阈值用于 `usage_backed` 场景，也就是线程已经拿到了相对可信的上下文占用数据。达到这个比例后，auto 模式会在发 prompt 前尝试压缩。',
  estimatedThresholdPercent:
    '估算阈值用于 `heuristic_only` 场景，也就是只能靠估算 token 压力时使用。通常会设得比精确阈值更保守一些。',
  reserveOutputTokens:
    '为模型本轮输出预留的 token 空间。它会从上下文窗口里先扣掉，避免 prompt 塞得太满，导致回答没有足够输出空间。',
  protectFirstEntries:
    '始终保护最前面的若干条上下文，不参与摘要压缩。适合保留长期有效的目标、约束、初始化说明。',
  protectLastEntries:
    '始终保护最近的若干条活动上下文，不参与摘要压缩。这个值越大，越不容易压缩到最新对话，但也越容易出现“手动压缩会跳过”。',
  summaryBudgetCap:
    '限制摘要模型单次最多输出多少 token。值越大，摘要可写得更完整，但成本和延迟也更高。当前执行层实际还会再做一层上限裁剪。'
} as const

const createDraft = (): ContextEngineConfig => ({
  version: 1,
  mode: 'manual',
  engine: 'noop',
  summaryModel: '',
  summaryFallbackModel: '',
  summaryTimeoutMs: 20_000,
  trigger: {
    thresholdPercent: 0.5,
    estimatedThresholdPercent: 0.65,
    reserveOutputTokens: 13_000
  },
  limits: {
    protectFirstEntries: 3,
    protectLastEntries: 20,
    summaryBudgetCap: 12_000
  },
  engineConfig: {}
})

const draft = ref<ContextEngineConfig>(createDraft())
const configPath = ref('')
const modelOptions = ref<ModelOption[]>([])
const loading = ref(false)
const saving = ref(false)

const status = reactive<{
  text: string
  tone: 'idle' | 'success' | 'error'
}>({
  text: '',
  tone: 'idle'
})

const cloneConfig = (config: ContextEngineConfig): ContextEngineConfig => ({
  version: 1,
  mode: config.mode,
  engine: config.engine,
  summaryModel: config.summaryModel,
  summaryFallbackModel: config.summaryFallbackModel,
  summaryTimeoutMs: config.summaryTimeoutMs,
  trigger: { ...config.trigger },
  limits: { ...config.limits },
  engineConfig: { ...config.engineConfig }
})

const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

const normalizeDraft = (): ContextEngineConfig => {
  const next = cloneConfig(draft.value)
  next.mode = next.mode === 'off' || next.mode === 'auto' ? next.mode : 'manual'
  next.engine = next.engine === 'summary-compressor' ? next.engine : 'noop'
  next.summaryModel = String(next.summaryModel ?? '').trim()
  next.summaryFallbackModel = String(next.summaryFallbackModel ?? '').trim()
  next.summaryTimeoutMs = clamp(next.summaryTimeoutMs, 20_000, 1000, 300_000)
  next.trigger.thresholdPercent = clamp(next.trigger.thresholdPercent, 0.5, 0.1, 0.95)
  next.trigger.estimatedThresholdPercent = clamp(
    next.trigger.estimatedThresholdPercent,
    0.65,
    0.1,
    0.99
  )
  next.trigger.reserveOutputTokens = clamp(next.trigger.reserveOutputTokens, 13_000, 256, 200_000)
  next.limits.protectFirstEntries = clamp(next.limits.protectFirstEntries, 3, 0, 500)
  next.limits.protectLastEntries = clamp(next.limits.protectLastEntries, 20, 1, 1000)
  next.limits.summaryBudgetCap = clamp(next.limits.summaryBudgetCap, 12_000, 256, 200_000)
  return next
}

const ensureMissingModelOption = (key: string): void => {
  const normalizedKey = String(key ?? '').trim()
  if (!normalizedKey) return
  if (modelOptions.value.some((item) => item.key === normalizedKey)) return
  modelOptions.value = [
    ...modelOptions.value,
    {
      key: normalizedKey,
      providerName: 'Unavailable',
      label: `${normalizedKey} (当前配置)`
    }
  ]
}

const groupedModelOptions = computed(() => {
  const groups = new Map<string, ModelOption[]>()
  for (const item of modelOptions.value) {
    const list = groups.get(item.providerName) ?? []
    list.push(item)
    groups.set(item.providerName, list)
  }
  return Array.from(groups.entries()).map(([providerName, items]) => ({
    providerName,
    items
  }))
})

const loadModelOptions = async (): Promise<void> => {
  const providers = await window.api.db.providers.list()
  const options: ModelOption[] = []
  for (const provider of providers.filter((item) => item.enabled)) {
    const rows = await window.api.db.providers.models.list(provider.id)
    for (const model of rows.filter((item) => item.enabled)) {
      options.push({
        key: `${provider.id}::${model.modelId}`,
        providerName: provider.displayName,
        label: model.label || model.modelId
      })
    }
  }
  modelOptions.value = options
}

const loadConfig = async (): Promise<void> => {
  const response = await window.api.context.getConfig()
  configPath.value = response.path
  draft.value = cloneConfig(response.config)
  ensureMissingModelOption(response.config.summaryModel)
  ensureMissingModelOption(response.config.summaryFallbackModel)
}

const load = async (): Promise<void> => {
  loading.value = true
  status.text = ''
  try {
    await loadModelOptions()
    await loadConfig()
  } catch (error) {
    console.error('Load context settings failed', error)
    status.text = error instanceof Error ? error.message : '加载上下文设置失败'
    status.tone = 'error'
  } finally {
    loading.value = false
  }
}

const saveSettings = async (): Promise<void> => {
  saving.value = true
  status.text = ''
  try {
    const payload = normalizeDraft()
    const response = await window.api.context.setConfig(payload)
    configPath.value = response.path
    draft.value = cloneConfig(response.config)
    ensureMissingModelOption(response.config.summaryModel)
    ensureMissingModelOption(response.config.summaryFallbackModel)
    status.text = loading.value ? '上下文设置已刷新' : '上下文设置已保存'
    status.tone = 'success'
  } catch (error) {
    console.error('Save context settings failed', error)
    status.text = error instanceof Error ? error.message : '保存上下文设置失败'
    status.tone = 'error'
  } finally {
    saving.value = false
  }
}

const openConfigDir = async (): Promise<void> => {
  if (!configPath.value) return
  try {
    await window.api.showItemInFolder(configPath.value)
  } catch (error) {
    console.error('Open context config dir failed', error)
  }
}

const openInspector = (): void => {
  window.api.openRuntimeInspector(null)
}

defineExpose({
  saveSettings
})

onMounted(() => {
  void load()
})
</script>
