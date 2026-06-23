<template>
  <div class="flex w-full h-full min-w-0 flex-col gap-3">
    <div class="flex items-center gap-2">
      <div class="relative w-72">
        <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索插件..."
          class="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-[#86a5ae] outline-none"
        />
      </div>

      <button
        type="button"
        class="h-9 w-9 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 flex items-center justify-center"
        :disabled="loading"
        title="刷新"
        @click="refreshPluginList()"
      >
        <RefreshCw :size="15" :class="refreshIconSpinning || loading ? 'animate-spin' : ''" />
      </button>
    </div>

    <div class="grid grid-cols-4 gap-3 shrink-0">
      <div
        v-for="metric in metrics"
        :key="metric.label"
        class="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
      >
        <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {{ metric.label }}
        </div>
        <div class="mt-2 text-2xl font-bold tracking-tight text-gray-900">
          {{ metric.value }}
        </div>
      </div>
    </div>

    <div
      v-if="pageErrorMessage"
      class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
    >
      {{ pageErrorMessage }}
    </div>

    <div
      v-if="pageWarningMessage"
      class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700"
    >
      {{ pageWarningMessage }}
    </div>

    <section
      class="flex-1 min-h-0 min-w-0 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col"
    >
      <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-semibold text-gray-900">插件</div>
        </div>
        <div class="text-xs text-gray-500">
          {{ filteredPlugins.length }} / {{ plugins.length }} 个插件
        </div>
      </div>

      <div class="flex-1 min-h-0 min-w-0 overflow-y-auto p-3 space-y-3">
        <div
          v-for="plugin in filteredPlugins"
          :key="plugin.pluginId"
          class="min-w-0 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 transition"
        >
          <div class="flex min-w-0 items-center gap-3 px-4 py-4">
            <button
              type="button"
              class="flex-1 min-w-0 text-left"
              @click="openPluginModal(plugin.pluginId)"
            >
              <div class="flex min-w-0 items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-gray-900">
                    {{ plugin.displayName }}
                  </div>
                  <div v-if="plugin.description" class="mt-1 truncate text-[11px] text-gray-500">
                    {{ plugin.description }}
                  </div>
                </div>

                <div class="shrink-0 flex items-center gap-2">
                  <span
                    class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    :class="sourceBadgeClass(plugin.sourceKind)"
                  >
                    {{ sourceLabel(plugin.sourceKind) }}
                  </span>
                  <span
                    class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    :class="pluginStatusBadgeClass(plugin)"
                  >
                    {{ pluginStatusLabel(plugin) }}
                  </span>
                </div>
              </div>
            </button>

            <div class="shrink-0 flex items-center gap-3">
              <button
                type="button"
                class="relative inline-flex items-center w-12 h-6 rounded-full transition"
                :class="plugin.enabled ? 'bg-[#10b981]' : 'bg-gray-300'"
                :disabled="pluginBusy[plugin.pluginId]"
                :aria-checked="plugin.enabled"
                :title="plugin.enabled ? '禁用' : '启用'"
                @click.stop="togglePluginEnabled(plugin)"
              >
                <span
                  class="w-5 h-5 bg-white rounded-full shadow-sm transition"
                  :class="plugin.enabled ? 'translate-x-6' : 'translate-x-1'"
                ></span>
              </button>

              <button
                type="button"
                class="h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700"
                @click.stop="openPluginModal(plugin.pluginId)"
              >
                设置
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="filteredPlugins.length === 0"
          class="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-xs text-gray-500"
        >
          未发现已安装的插件。
        </div>
      </div>
    </section>
  </div>

  <div
    v-if="showPluginModal && currentPlugin"
    class="fixed inset-0 z-60 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
    @mousedown.self="closePluginModal"
  >
    <div
      class="bg-white rounded-2xl shadow-2xl w-215 max-w-[94%] max-h-[86vh] overflow-hidden flex flex-col"
    >
      <div
        class="px-6 pt-6 pb-4 border-b border-gray-100 shrink-0 flex items-start justify-between gap-4"
      >
        <div>
          <div class="flex items-center gap-2">
            <Puzzle :size="18" class="text-gray-500" />
            <div class="text-xl font-bold text-gray-900">
              {{ currentPlugin.displayName }}
            </div>
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              :class="sourceBadgeClass(currentPlugin.sourceKind)"
            >
              {{ sourceLabel(currentPlugin.sourceKind) }}
            </span>
          </div>
        </div>

        <button
          type="button"
          class="h-8 w-8 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 flex items-center justify-center"
          @click="closePluginModal"
        >
          <X :size="16" />
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <div class="space-y-4">
          <div
            v-if="modalErrorMessage"
            class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {{ modalErrorMessage }}
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] font-bold uppercase text-gray-500">Plugin ID</div>
              <div class="mt-1 text-sm font-semibold text-gray-900 break-all">
                {{ currentPlugin.pluginId }}
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] font-bold uppercase text-gray-500">版本</div>
              <div class="mt-1 text-sm font-semibold text-gray-900">
                {{ currentPlugin.version }}
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] font-bold uppercase text-gray-500">配置状态</div>
              <div class="mt-1 text-sm font-semibold text-gray-900">
                {{ pluginStatusLabel(currentPlugin) }}
              </div>
            </div>
          </div>

          <div
            v-if="modalActionMessage && modalActionKind === 'error'"
            class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {{ modalActionMessage }}
          </div>

          <section
            v-if="isCurrentPluginConfigurable"
            class="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
          >
            <div class="px-4 py-3 border-b border-gray-100">
              <div class="text-sm font-semibold text-gray-900">
                账号配置<span
                  v-if="hasConfiguredAccount"
                  class="ml-1 text-xs font-normal text-gray-500"
                  >（已配置。如需更换账号，可重新接入。）</span
                >
              </div>
            </div>

            <div class="px-4 py-6 space-y-8">
              <div v-if="currentSetupMethods.length > 1" class="space-y-2">
                <div class="text-[11px] font-bold uppercase text-gray-500 tracking-wider">
                  接入方式
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="method in currentSetupMethods"
                    :key="method.id"
                    type="button"
                    class="h-9 rounded-lg border px-3 text-xs font-semibold transition"
                    :class="
                      selectedSetupMethodId === method.id
                        ? 'border-[#8aaeb7] bg-[#edf5f7] text-[#34515a]'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    "
                    @click="selectSetupMethod(method.id)"
                  >
                    {{ method.label }}{{ method.recommended ? ' · 推荐' : '' }}
                  </button>
                </div>
              </div>

              <div
                v-if="selectedSetupMethod && selectedSetupMethod.kind === 'qr'"
                class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4"
              >
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-semibold text-gray-900">
                      {{ selectedSetupMethod.label }}
                    </div>
                    <div v-if="selectedSetupMethod.description" class="mt-1 text-xs text-gray-500">
                      {{ selectedSetupMethod.description }}
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      v-if="setupSession"
                      type="button"
                      class="h-9 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 disabled:opacity-60"
                      :disabled="setupBusy"
                      @click="cancelAccountSetup"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      class="h-9 px-3 rounded-lg bg-[#8aaeb7] text-white text-xs font-semibold disabled:opacity-60 inline-flex items-center gap-2"
                      :disabled="setupBusy"
                      @click="startAccountSetup"
                    >
                      <RefreshCw :size="14" :class="setupBusy ? 'animate-spin' : ''" />
                      {{ setupSession ? '重新生成' : '生成二维码' }}
                    </button>
                  </div>
                </div>

                <div v-if="setupQrProjection" class="mt-4">
                  <TransportSetupQrBlock :qr="setupQrProjection" :show-regenerate="false" />
                </div>
              </div>

              <!-- 配置表单网格 -->
              <div
                v-if="showManualSettingsForm"
                class="grid grid-cols-2 gap-x-10 gap-y-7 items-start"
              >
                <div v-if="domainField" class="space-y-2.5">
                  <label class="text-[11px] font-bold uppercase text-gray-500 tracking-wider"
                    >域名</label
                  >
                  <select
                    :value="getSelectFieldValue(domainField.key)"
                    class="w-full px-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-[#86a5ae]/20 focus:border-[#86a5ae] outline-none transition h-10.5"
                    @change="onSelectFieldChange(domainField.key, $event)"
                  >
                    <option value="">请选择域名</option>
                    <option
                      v-for="option in domainField.options ?? []"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </div>

                <!-- 动态配置项映射 (排除已经单独显示的域名) -->
                <template v-for="field in otherSettingsFields" :key="field.key">
                  <!-- 开关类型 -->
                  <div
                    v-if="field.type === 'boolean'"
                    class="flex items-center justify-between group cursor-pointer pt-6"
                    @click="toggleBooleanField(field.key)"
                  >
                    <div class="text-[11px] font-bold uppercase text-gray-500 tracking-wider">
                      {{ field.label }}
                    </div>
                    <button
                      type="button"
                      class="relative inline-flex items-center w-9 h-5 rounded-full transition shrink-0"
                      :class="getBooleanFieldValue(field.key) ? 'bg-[#10b981]' : 'bg-gray-200'"
                    >
                      <span
                        class="w-3.5 h-3.5 bg-white rounded-full shadow-sm transition"
                        :class="
                          getBooleanFieldValue(field.key) ? 'translate-x-4.5' : 'translate-x-1'
                        "
                      ></span>
                    </button>
                  </div>

                  <!-- 其他输入类型 -->
                  <div v-else class="space-y-2.5">
                    <label class="text-[11px] font-bold uppercase text-gray-500 tracking-wider">
                      {{ field.label }}
                    </label>

                    <input
                      v-if="field.type === 'text'"
                      :value="getTextFieldValue(field.key)"
                      type="text"
                      :placeholder="field.placeholder || ''"
                      class="w-full px-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-[#86a5ae]/20 focus:border-[#86a5ae] outline-none transition"
                      @input="onTextFieldInput(field.key, $event)"
                    />

                    <div v-else-if="field.type === 'secret'" class="relative">
                      <input
                        :value="getSecretFieldValue(field.key)"
                        :type="isSecretVisible(field.key) ? 'text' : 'password'"
                        class="w-full pr-11 px-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-[#86a5ae]/20 focus:border-[#86a5ae] outline-none transition"
                        @input="onSecretFieldInput(field.key, $event)"
                      />
                      <button
                        type="button"
                        class="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                        :title="isSecretVisible(field.key) ? '隐藏' : '显示'"
                        @click="toggleSecretVisibility(field.key)"
                      >
                        <EyeOff v-if="isSecretVisible(field.key)" :size="16" />
                        <Eye v-else :size="16" />
                      </button>
                    </div>

                    <select
                      v-else-if="field.type === 'select'"
                      :value="getSelectFieldValue(field.key)"
                      class="w-full px-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-[#86a5ae]/20 focus:border-[#86a5ae] outline-none transition h-10.5"
                      @change="onSelectFieldChange(field.key, $event)"
                    >
                      <option value="">请选择</option>
                      <option
                        v-for="option in field.options ?? []"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>

                    <input
                      v-else-if="field.type === 'number'"
                      :value="getNumberFieldValue(field.key)"
                      type="number"
                      class="w-full px-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-[#86a5ae]/20 focus:border-[#86a5ae] outline-none transition"
                      @input="onNumberFieldInput(field.key, $event)"
                    />
                  </div>
                </template>
              </div>
            </div>
          </section>

          <section
            v-else
            class="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
          >
            <div class="px-4 py-3 border-b border-gray-100">
              <div class="text-sm font-semibold text-gray-900">插件详情</div>
            </div>

            <div class="px-4 py-4 space-y-3">
              <div
                v-if="currentPlugin.accountStatuses.length === 0"
                class="rounded-xl border border-dashed border-gray-200 px-4 py-3 text-xs text-gray-500"
              >
                暂无运行记录。
              </div>

              <div
                v-for="status in currentPlugin.accountStatuses"
                :key="status.accountId"
                class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[11px] text-gray-500"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-gray-800">{{ status.accountId }}</span>
                  <span
                    class="rounded-full px-2 py-0.5 font-semibold"
                    :class="accountStateBadgeClass(status.state)"
                  >
                    {{ accountStateLabel(status.state) }}
                  </span>
                  <span v-if="status.lastSuccessAt">
                    最近成功: {{ formatDateTime(status.lastSuccessAt) }}
                  </span>
                  <span v-if="status.lastFailureAt">
                    最近失败: {{ formatDateTime(status.lastFailureAt) }}
                  </span>
                </div>
                <div v-if="status.error" class="mt-2 text-rose-700">
                  {{ status.error }}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class="shrink-0 px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
        <button
          type="button"
          class="h-10 px-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-semibold"
          @click="closePluginModal"
        >
          取消
        </button>
        <button
          type="button"
          class="h-10 px-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-semibold disabled:opacity-60"
          :disabled="
            connectionTesting ||
            modalSaving ||
            isModalDirty ||
            !selectedStoredAccount ||
            !showManualSettingsForm
          "
          @click="testPluginConnection"
        >
          {{ connectionTesting ? '验证中...' : '验证配置' }}
        </button>
        <button
          type="button"
          class="h-10 px-4 rounded-lg bg-[#8aaeb7] text-white font-semibold disabled:opacity-60"
          :disabled="modalSaving || !showManualSettingsForm"
          @click="submitPluginModal"
        >
          {{ modalSaving ? '保存中...' : '保存配置' }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="toastMessage" class="fixed right-6 top-6 z-80 pointer-events-none">
    <div
      class="min-w-[16rem] max-w-[24rem] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-lg"
    >
      {{ toastMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Eye, EyeOff, Puzzle, RefreshCw, Search, X } from 'lucide-vue-next'
import type {
  InstalledTransportPlugin,
  TransportPluginAccount,
  TransportPluginAccountSetupEvent,
  TransportPluginAccountSetupMethod,
  TransportPluginAccountSetupStartResult,
  TransportPluginValidationStatus
} from '../../../../../shared/transport-plugins.ts'
import TransportSetupQrBlock from '../../../components/chat/TransportSetupQrBlock.vue'
import { resolveTransportPluginSetupQrProjection } from '../../../utils/transport-setup-qr'

const DEFAULT_TRANSPORT_ACCOUNT_ID = 'default'

type DoctorStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown'

type TransportAccountStatus = {
  transportId: string
  accountId: string
  state: 'connecting' | 'connected' | 'retrying' | 'fatal' | 'disconnected'
  error?: string | null
  errorCode?: string | null
  lastAttemptAt?: string | null
  lastSuccessAt?: string | null
  lastFailureAt?: string | null
  updatedAt?: string | null
}

type PluginDoctorView = {
  doctorStatus: DoctorStatus
  doctorStage: string | null
  doctorSummary: string
  doctorError: string | null
  doctorLastCheckedAt: string | null
  accountStatuses: TransportAccountStatus[]
}

type PluginListItem = InstalledTransportPlugin & PluginDoctorView

const emit = defineEmits<{
  (e: 'dirty-change', dirty: boolean): void
}>()

const plugins = ref<PluginListItem[]>([])
const loading = ref(false)
const refreshIconSpinning = ref(false)
const searchQuery = ref('')

const pageErrorMessage = ref('')
const pageWarningMessage = ref('')

const showPluginModal = ref(false)
const editingPluginId = ref('')
const accounts = ref<TransportPluginAccount[]>([])
const modalSaving = ref(false)
const connectionTesting = ref(false)
const modalErrorMessage = ref('')
const modalActionMessage = ref('')
const modalActionKind = ref<'success' | 'error'>('success')
const modalBaseSnapshot = ref('')
const toastMessage = ref('')
const selectedSetupMethodId = ref('')
const setupBusy = ref(false)
const setupSession = ref<TransportPluginAccountSetupStartResult | null>(null)
const setupEvents = ref<TransportPluginAccountSetupEvent[]>([])

let toastTimer: ReturnType<typeof setTimeout> | null = null
let refreshIconTimer: ReturnType<typeof setTimeout> | null = null
let offTransportAccountSetupEvent: (() => void) | null = null

const pluginBusy = reactive<Record<string, boolean>>({})
const formConfig = reactive<Record<string, string | number | boolean | ''>>({})
const formSecrets = reactive<Record<string, string>>({})
const secretVisibility = reactive<Record<string, boolean>>({})
const accountEnabled = ref(true)

const currentPlugin = computed(
  () => plugins.value.find((plugin) => plugin.pluginId === editingPluginId.value) ?? null
)

const selectedStoredAccount = computed(
  () =>
    accounts.value.find((account) => account.accountId === DEFAULT_TRANSPORT_ACCOUNT_ID) ??
    accounts.value[0] ??
    null
)

const activeAccountId = computed(
  () => selectedStoredAccount.value?.accountId ?? DEFAULT_TRANSPORT_ACCOUNT_ID
)

const isCurrentPluginConfigurable = computed(() =>
  Boolean(currentPlugin.value?.configurable && currentPlugin.value?.settingsSchema)
)

const hasConfiguredAccount = computed(() => Boolean(selectedStoredAccount.value))

const currentSettingsFields = computed(() => currentPlugin.value?.settingsSchema?.fields ?? [])

const currentSetupMethods = computed<TransportPluginAccountSetupMethod[]>(() => {
  const plugin = currentPlugin.value
  const schema = plugin?.settingsSchema
  if (!schema) return []
  if (schema.setupMethods?.length) return schema.setupMethods
  return [
    {
      id: 'manual_config',
      kind: 'form',
      label: '手动填写配置',
      fields: schema.fields.map((field) => field.key)
    }
  ]
})

const selectedSetupMethod = computed(
  () =>
    currentSetupMethods.value.find((method) => method.id === selectedSetupMethodId.value) ??
    currentSetupMethods.value[0] ??
    null
)

const showManualSettingsForm = computed(
  () => !selectedSetupMethod.value || selectedSetupMethod.value.kind === 'form'
)

const setupQrEvent = computed(() =>
  [...setupEvents.value].reverse().find((event) => event.type === 'qr')
)

const setupLatestEvent = computed(() => setupEvents.value[setupEvents.value.length - 1] ?? null)

const setupQrProjection = computed(() =>
  resolveTransportPluginSetupQrProjection(
    setupSession.value,
    setupQrEvent.value,
    setupLatestEvent.value
  )
)

// 提取域名（Domain）字段以便单独布局
const domainField = computed(() =>
  currentSettingsFields.value.find((f) => f.key.toLowerCase() === 'domain')
)

// 剩余的其他字段
const otherSettingsFields = computed(() =>
  currentSettingsFields.value.filter((f) => f.key.toLowerCase() !== 'domain')
)

const filteredPlugins = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return plugins.value

  return plugins.value.filter((plugin) =>
    [plugin.displayName, plugin.pluginId, plugin.description, plugin.sourceKind]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query)
  )
})

const metrics = computed(() => [
  { label: '已安装', value: plugins.value.length },
  { label: '已启用', value: plugins.value.filter((plugin) => plugin.enabled).length },
  {
    label: '可用',
    value: plugins.value.filter((plugin) => resolvePluginStatus(plugin) === 'validated').length
  },
  {
    label: '不可用',
    value: plugins.value.filter((plugin) => resolvePluginStatus(plugin) === 'invalid').length
  }
])

const isModalDirty = computed(
  () => showPluginModal.value && buildModalSnapshot() !== modalBaseSnapshot.value
)

watch(
  () => isModalDirty.value,
  (dirty) => emit('dirty-change', dirty),
  { immediate: true }
)

const clearRecord = (record: Record<string, unknown>) => {
  for (const key of Object.keys(record)) {
    delete record[key]
  }
}

const showToast = (message: string, durationMs = 2400) => {
  toastMessage.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMessage.value = ''
    toastTimer = null
  }, durationMs)
}

onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer)
  if (refreshIconTimer) clearTimeout(refreshIconTimer)
  offTransportAccountSetupEvent?.()
  offTransportAccountSetupEvent = null
})

const initializeAccountForm = (
  plugin: PluginListItem,
  account: TransportPluginAccount | null,
  options: { preserveSetupState?: boolean } = {}
) => {
  clearRecord(formConfig)
  clearRecord(formSecrets)
  clearRecord(secretVisibility)
  if (!options.preserveSetupState) {
    setupSession.value = null
    setupEvents.value = []
  }

  const methods = plugin.settingsSchema?.setupMethods?.length
    ? plugin.settingsSchema.setupMethods
    : [
        {
          id: 'manual_config',
          kind: 'form' as const,
          label: '手动填写配置',
          fields: plugin.settingsSchema?.fields.map((field) => field.key) ?? []
        }
      ]
  selectedSetupMethodId.value =
    methods.find((method) => method.recommended)?.id ?? methods[0]?.id ?? 'manual_config'

  accountEnabled.value = account?.enabled ?? true

  for (const field of plugin.settingsSchema?.fields ?? []) {
    if (field.type === 'secret') {
      formSecrets[field.key] = account?.secrets[field.key] ?? ''
      secretVisibility[field.key] = false
      continue
    }

    const storedValue = account?.config[field.key]
    if (storedValue !== undefined && storedValue !== null) {
      formConfig[field.key] = storedValue
      continue
    }

    if (field.defaultValue !== undefined) {
      formConfig[field.key] = field.defaultValue ?? ''
      continue
    }

    if (field.type === 'boolean') {
      formConfig[field.key] = false
      continue
    }

    formConfig[field.key] = ''
  }

  modalBaseSnapshot.value = buildModalSnapshot()
  modalErrorMessage.value = ''
}

const buildModalSnapshot = (): string => {
  const plugin = currentPlugin.value
  if (!plugin) return ''
  if (!plugin.settingsSchema) return ''

  const config = Object.fromEntries(
    plugin.settingsSchema.fields
      .filter((field) => field.type !== 'secret')
      .map((field) => [field.key, formConfig[field.key] ?? ''])
  )
  const secrets = Object.fromEntries(
    plugin.settingsSchema.fields
      .filter((field) => field.type === 'secret')
      .map((field) => [field.key, formSecrets[field.key] ?? ''])
  )

  return JSON.stringify({
    accountId: activeAccountId.value,
    accountEnabled: accountEnabled.value,
    config,
    secrets
  })
}

const resolvePluginStatus = (plugin: PluginListItem): TransportPluginValidationStatus =>
  plugin.validationStatus ?? 'unknown'

const pluginStatusLabel = (plugin: PluginListItem): string => {
  switch (resolvePluginStatus(plugin)) {
    case 'validated':
      return '可用'
    case 'invalid':
      return '不可用'
    default:
      return '未验证'
  }
}

const pluginStatusBadgeClass = (plugin: PluginListItem): string => {
  switch (resolvePluginStatus(plugin)) {
    case 'validated':
      return 'bg-emerald-100 text-emerald-700'
    case 'invalid':
      return 'bg-rose-100 text-rose-700'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

const sourceLabel = (value: InstalledTransportPlugin['sourceKind']): string => {
  switch (value) {
    case 'builtin':
      return '内置'
    case 'workspace':
      return '工作区'
    default:
      return '本地插件'
  }
}

const sourceBadgeClass = (value: InstalledTransportPlugin['sourceKind']): string => {
  switch (value) {
    case 'builtin':
      return 'bg-slate-100 text-slate-700'
    case 'workspace':
      return 'bg-violet-100 text-violet-700'
    default:
      return 'bg-blue-100 text-blue-700'
  }
}

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '未设置'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

const getTextFieldValue = (key: string): string => String(formConfig[key] ?? '')

const getSelectFieldValue = (key: string): string => String(formConfig[key] ?? '')

const getSecretFieldValue = (key: string): string => String(formSecrets[key] ?? '')

const isSecretVisible = (key: string): boolean => secretVisibility[key] !== false

const getBooleanFieldValue = (key: string): boolean => Boolean(formConfig[key] ?? false)

const getNumberFieldValue = (key: string): string | number => {
  const value = formConfig[key]
  if (value === '' || value === undefined || value === null) return ''
  return typeof value === 'number' ? value : String(value)
}

const hasStoredSecret = (key: string): boolean =>
  Boolean(selectedStoredAccount.value?.hasSecrets[key])

const accountStateLabel = (state: TransportAccountStatus['state'] | 'unknown'): string => {
  switch (state) {
    case 'connecting':
      return '连接中'
    case 'connected':
      return '已连接'
    case 'retrying':
      return '重试中'
    case 'fatal':
      return '致命错误'
    case 'disconnected':
      return '已断开'
    default:
      return '未连接'
  }
}

const accountStateBadgeClass = (state: TransportAccountStatus['state'] | 'unknown'): string => {
  switch (state) {
    case 'connecting':
      return 'bg-sky-100 text-sky-700'
    case 'connected':
      return 'bg-emerald-100 text-emerald-700'
    case 'retrying':
      return 'bg-amber-100 text-amber-700'
    case 'fatal':
      return 'bg-rose-100 text-rose-700'
    case 'disconnected':
      return 'bg-gray-100 text-gray-700'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

const onTextFieldInput = (key: string, event: Event) => {
  formConfig[key] = (event.target as HTMLInputElement).value
}

const onSecretFieldInput = (key: string, event: Event) => {
  formSecrets[key] = (event.target as HTMLInputElement).value
}

const onSelectFieldChange = (key: string, event: Event) => {
  formConfig[key] = (event.target as HTMLSelectElement).value
}

const onNumberFieldInput = (key: string, event: Event) => {
  const raw = (event.target as HTMLInputElement).value
  formConfig[key] = raw.trim() ? Number(raw) : ''
}

const toggleBooleanField = (key: string) => {
  formConfig[key] = !getBooleanFieldValue(key)
}

const toggleSecretVisibility = (key: string) => {
  secretVisibility[key] = !isSecretVisible(key)
}

const selectSetupMethod = (methodId: string) => {
  selectedSetupMethodId.value = methodId
  setupSession.value = null
  setupEvents.value = []
  modalActionMessage.value = ''
}

const buildSetupInitialValues = (): Record<string, unknown> => {
  const plugin = currentPlugin.value
  const values: Record<string, unknown> = {}
  for (const field of plugin?.settingsSchema?.fields ?? []) {
    if (field.type === 'secret') continue
    const value = formConfig[field.key]
    if (value !== undefined && value !== '') values[field.key] = value
  }
  return values
}

const startAccountSetup = async (): Promise<void> => {
  const plugin = currentPlugin.value
  const method = selectedSetupMethod.value
  if (!plugin || !method || setupBusy.value) return
  if (method.kind === 'form') return

  setupBusy.value = true
  modalErrorMessage.value = ''
  modalActionMessage.value = ''

  try {
    const result = await window.api.plugins.startTransportAccountSetup({
      pluginId: plugin.pluginId,
      accountId: activeAccountId.value,
      methodId: method.id,
      initialValues: buildSetupInitialValues(),
      validateAfterSave: true
    })
    setupSession.value = result
    setupEvents.value = result.events ?? []
    if (setupEvents.value.some((event) => event.type === 'completed')) {
      await refreshPlugins(plugin.pluginId, { preserveSetupState: true })
      await loadPluginAccounts(plugin, activeAccountId.value, { preserveSetupState: true })
      showToast('账号接入完成。')
    }
  } catch (error) {
    modalActionKind.value = 'error'
    modalActionMessage.value = error instanceof Error ? error.message : '启动账号接入失败。'
  } finally {
    setupBusy.value = false
  }
}

const cancelAccountSetup = async (): Promise<void> => {
  const plugin = currentPlugin.value
  const session = setupSession.value
  if (!plugin || !session || setupBusy.value) return
  setupBusy.value = true
  try {
    await window.api.plugins.cancelTransportAccountSetup(plugin.pluginId, session.sessionId)
    setupEvents.value = [
      ...setupEvents.value,
      {
        type: 'status',
        pluginId: plugin.pluginId,
        accountId: activeAccountId.value,
        methodId: session.methodId,
        sessionId: session.sessionId,
        state: 'cancelled',
        message: '已取消。'
      }
    ]
  } catch (error) {
    modalActionKind.value = 'error'
    modalActionMessage.value = error instanceof Error ? error.message : '取消账号接入失败。'
  } finally {
    setupBusy.value = false
  }
}

const refreshPlugins = async (
  preferredPluginId?: string | null,
  options: { preserveSetupState?: boolean } = {}
): Promise<void> => {
  void preferredPluginId
  void options
  loading.value = true
  pageWarningMessage.value = ''
  pageErrorMessage.value = ''
  try {
    plugins.value = []
    if (showPluginModal.value) {
      closePluginModal()
    }
  } catch (error) {
    pageErrorMessage.value = error instanceof Error ? error.message : '加载插件列表失败。'
  } finally {
    loading.value = false
  }
}

const refreshPluginList = async (): Promise<void> => {
  if (refreshIconTimer) clearTimeout(refreshIconTimer)
  refreshIconSpinning.value = true

  try {
    await refreshPlugins()
  } finally {
    refreshIconTimer = setTimeout(() => {
      refreshIconSpinning.value = false
      refreshIconTimer = null
    }, 500)
  }
}

const loadPluginAccounts = async (
  plugin: PluginListItem,
  preferredKey?: string | null,
  options: { preserveSetupState?: boolean } = {}
) => {
  if (!plugin.configurable || !plugin.settingsSchema) {
    accounts.value = []
    modalBaseSnapshot.value = ''
    modalErrorMessage.value = ''
    modalActionMessage.value = ''
    return
  }

  const nextAccounts = await window.api.plugins.listTransportAccounts(plugin.pluginId)
  accounts.value = nextAccounts

  const targetAccount =
    (preferredKey && nextAccounts.find((account) => account.accountId === preferredKey)) ||
    nextAccounts.find((account) => account.accountId === DEFAULT_TRANSPORT_ACCOUNT_ID) ||
    nextAccounts[0] ||
    null

  initializeAccountForm(plugin, targetAccount, {
    preserveSetupState: options.preserveSetupState
  })
}

const openPluginModal = async (pluginId: string) => {
  const plugin = plugins.value.find((item) => item.pluginId === pluginId)
  if (!plugin) return

  editingPluginId.value = pluginId
  showPluginModal.value = true
  modalErrorMessage.value = ''
  modalActionMessage.value = ''

  try {
    await loadPluginAccounts(plugin)
  } catch (error) {
    modalErrorMessage.value = error instanceof Error ? error.message : '加载插件账号失败。'
  }
}

const closePluginModal = () => {
  showPluginModal.value = false
  modalErrorMessage.value = ''
  modalActionMessage.value = ''
  setupSession.value = null
  setupEvents.value = []
}

const togglePluginEnabled = async (plugin: InstalledTransportPlugin) => {
  pluginBusy[plugin.pluginId] = true
  pageErrorMessage.value = ''

  try {
    const nextEnabled = !plugin.enabled
    await window.api.plugins.setEnabled({
      pluginId: plugin.pluginId,
      enabled: nextEnabled
    })
    await refreshPlugins(plugin.pluginId)
  } catch (error) {
    pageErrorMessage.value = error instanceof Error ? error.message : '更新插件状态失败。'
  } finally {
    delete pluginBusy[plugin.pluginId]
  }
}

const submitPluginModal = async (): Promise<void> => {
  const plugin = currentPlugin.value
  if (!plugin || modalSaving.value) return
  if (!plugin.configurable || !plugin.settingsSchema) {
    modalErrorMessage.value = '这个插件没有声明可编辑 settings，不能在这里保存账号配置。'
    return
  }

  modalSaving.value = true
  modalErrorMessage.value = ''
  modalActionMessage.value = ''

  try {
    const saved = await window.api.plugins.saveTransportAccount(buildAccountSaveInput(plugin))

    await refreshPlugins(plugin.pluginId)
    await loadPluginAccounts(plugin, saved.accountId)
    showToast('配置已保存。')
  } catch (error) {
    modalErrorMessage.value = error instanceof Error ? error.message : '保存插件配置失败。'
  } finally {
    modalSaving.value = false
  }
}

const buildAccountSaveInput = (plugin: PluginListItem) => {
  const config: Record<string, unknown> = {}
  const secrets: Record<string, string> = {}

  for (const field of plugin.settingsSchema?.fields ?? []) {
    if (field.type === 'secret') {
      const value = getSecretFieldValue(field.key).trim()
      if (value) {
        secrets[field.key] = value
      } else if (field.required && !hasStoredSecret(field.key)) {
        throw new Error(`${field.label} 不能为空。`)
      }
      continue
    }

    if (field.type === 'boolean') {
      config[field.key] = getBooleanFieldValue(field.key)
      continue
    }

    if (field.type === 'number') {
      const value = getNumberFieldValue(field.key)
      if (value === '' && field.required) {
        throw new Error(`${field.label} 不能为空。`)
      }
      config[field.key] = value
      continue
    }

    const value = getTextFieldValue(field.key)
    if (!value.trim() && field.required) {
      throw new Error(`${field.label} 不能为空。`)
    }
    config[field.key] = value
  }

  return {
    pluginId: plugin.pluginId,
    accountId: activeAccountId.value,
    enabled: accountEnabled.value,
    config,
    secrets
  }
}

const testPluginConnection = async (): Promise<void> => {
  const plugin = currentPlugin.value
  if (!plugin || connectionTesting.value) return

  if (isModalDirty.value) {
    modalActionKind.value = 'error'
    modalActionMessage.value = '当前配置有未保存改动，请先保存后再验证配置。'
    return
  }

  if (!selectedStoredAccount.value) {
    modalActionKind.value = 'error'
    modalActionMessage.value = '请先保存配置，再验证配置。'
    return
  }

  connectionTesting.value = true
  modalErrorMessage.value = ''
  modalActionMessage.value = ''

  try {
    await window.api.plugins.testTransportAccount({
      pluginId: plugin.pluginId,
      accountId: activeAccountId.value
    })
    await refreshPlugins(plugin.pluginId)
    showToast('配置验证通过。')
  } catch (error) {
    await refreshPlugins(plugin.pluginId)
    modalActionKind.value = 'error'
    modalActionMessage.value = error instanceof Error ? error.message : '配置验证失败。'
  } finally {
    connectionTesting.value = false
  }
}

const saveSettings = async (): Promise<void> => {
  if (showPluginModal.value) {
    await submitPluginModal()
  }
}

defineExpose({
  saveSettings
})

onMounted(async () => {
  await refreshPlugins()
})
</script>
