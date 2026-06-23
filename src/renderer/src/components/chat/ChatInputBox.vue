<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import { YLAnimatedCaret } from 'yl-animated-caret'
import {
  Loader2,
  Paperclip,
  Search,
  Sparkles,
  Wand2,
  Plug,
  Lightbulb,
  Ban,
  ChevronDown,
  Image as ImageIcon,
  Send,
  Square,
  X,
  Gauge,
  RefreshCw,
  Settings2,
  Check,
  Eye,
  EyeOff
} from 'lucide-vue-next'
import FloatingTooltip from '../common/FloatingTooltip.vue'
import Tooltip from '../common/Tooltip.vue'
import { getProviderIconUrl } from '@renderer/utils/providerIcons'
import type { QueueRuntimeState } from './types'

const props = withDefaults(
  defineProps<{
    modelValue: string
    historyEntries?: string[]
    isStreaming: boolean
    threadId?: string | null
    workspacePath?: string
    editMode?: boolean
    editHint?: string
    placeholder?: string
    modelLabel?: string
    modelOptions?: {
      id: string
      label: string
      providerName?: string
      contextWindow?: string
      supports?: { imageInput?: boolean; tools?: boolean; reasoning?: boolean }
    }[]
    selectedModelId?: string
    thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
    thinkingLevels?: ('off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh')[]
    thinkingSupported?: boolean
    supportsImageInput?: boolean
    attachments?: File[]
    minLines?: number
    maxLines?: number
    contextUsedTokens?: number
    contextTotalTokens?: number
    canAbort?: boolean
    queueRuntimeState?: QueueRuntimeState
  }>(),
  {
    placeholder: '输入消息...',
    modelLabel: 'Claude 3.5 Sonnet',
    minLines: 2,
    maxLines: 6,
    editMode: false
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send'): void
  (e: 'drop-images', files: File[]): void
  (e: 'select-model', modelId: string): void
  (e: 'select-thinking-level', level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'): void
  (e: 'update:attachments', files: File[]): void
  (e: 'cancel'): void
  (e: 'cancel-edit'): void
}>()

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

const inputValue = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value)
})

const showAbortButton = computed(
  () =>
    props.queueRuntimeState !== 'aborting' && (props.canAbort ?? props.isStreaming)
)
const isCancelling = computed(() => props.queueRuntimeState === 'aborting')
const composerDisabled = computed(() => isCancelling.value)
const composerRows = computed(() => Math.max(1, Math.floor(props.minLines ?? 1)))
const threadKnowledgeCaptureEnabled = ref(true)
const threadKnowledgeBusy = ref(false)
const threadKnowledgeTooltip = computed(() =>
  threadKnowledgeCaptureEnabled.value ? '关闭后不记录当前对话' : '开启后将记录当前对话'
)

const hasUnsupportedImageSelection = computed(
  () => (attachments.value?.length ?? 0) > 0 && props.supportsImageInput === false
)

const textareaRef = ref<HTMLTextAreaElement | null>(null)
let syncRaf: number | null = null

/**
 * 发送前把 textarea 的 DOM 值写回 v-model。
 * IME 输入期间 Vue 会跳过 input 同步（见 vModelText 的 composing 判断），
 * 父级 `inputText` 可能滞后于 `textarea.value`，导致「框里是全的、发出去缺一段」。
 */
const flushTextareaToModel = () => {
  const el = textareaRef.value
  if (!el) return
  const v = el.value
  if (v !== props.modelValue) {
    emit('update:modelValue', v)
  }
}

const onComposerEnter = (e: KeyboardEvent) => {
  if (e.shiftKey) {
    // Shift+Enter：插入换行，不发送
    return
  }
  // 组字过程中 Enter 常由输入法处理（选词/上屏），勿拦截
  if (e.isComposing) {
    return
  }
  e.preventDefault()
  flushTextareaToModel()
  emit('send')
}

const onSendClick = () => {
  flushTextareaToModel()
  emit('send')
}

const loadThreadKnowledgeCapture = async (): Promise<void> => {
  const threadId = props.threadId?.trim()
  if (!threadId) {
    threadKnowledgeCaptureEnabled.value = true
    return
  }
  try {
    const result = await window.api.knowledge.getThreadCapture(threadId)
    threadKnowledgeCaptureEnabled.value = result.enabled
  } catch {
    threadKnowledgeCaptureEnabled.value = true
  }
}

const toggleThreadKnowledgeCapture = async (): Promise<void> => {
  const threadId = props.threadId?.trim()
  if (!threadId || threadKnowledgeBusy.value) return
  const next = !threadKnowledgeCaptureEnabled.value
  threadKnowledgeBusy.value = true
  threadKnowledgeCaptureEnabled.value = next
  try {
    const result = await window.api.knowledge.setThreadCapture(threadId, next)
    threadKnowledgeCaptureEnabled.value = result.enabled
  } catch {
    threadKnowledgeCaptureEnabled.value = !next
  } finally {
    threadKnowledgeBusy.value = false
  }
}

watch(
  () => props.threadId,
  () => {
    void loadThreadKnowledgeCapture()
  },
  { immediate: true }
)

const historyCursor = ref<number | null>(null)

const moveCaretToEnd = () => {
  const el = textareaRef.value
  if (!el) return
  const len = el.value.length
  try {
    el.setSelectionRange(len, len)
  } catch {
    // ignore
  }
  el.scrollTop = el.scrollHeight
}

const applyHistoryEntry = (value: string, cursor: number | null) => {
  historyCursor.value = cursor
  emit('update:modelValue', value)
  void nextTick().then(() => {
    syncTextareaHeight()
    moveCaretToEnd()
  })
}

const onComposerInput = () => {
  historyCursor.value = null
  scheduleSyncTextareaHeight()
}

const onComposerKeyDown = (e: KeyboardEvent) => {
  if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

  const entries = props.historyEntries ?? []
  if (!entries.length) return

  const currentValue = textareaRef.value?.value ?? props.modelValue
  const navigatingHistory = historyCursor.value !== null
  if (!navigatingHistory && currentValue.length > 0) return
  if (e.key === 'ArrowDown' && historyCursor.value === null) return

  e.preventDefault()

  if (e.key === 'ArrowUp') {
    const nextCursor =
      historyCursor.value === null ? entries.length - 1 : Math.max(0, historyCursor.value - 1)
    applyHistoryEntry(entries[nextCursor] ?? '', nextCursor)
    return
  }

  const currentCursor = historyCursor.value
  if (currentCursor === null) return
  const nextCursor = currentCursor + 1
  if (nextCursor >= entries.length) {
    applyHistoryEntry('', null)
    return
  }

  applyHistoryEntry(entries[nextCursor] ?? '', nextCursor)
}

const parsePx = (value: string) => {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

const getLineHeightPx = (el: HTMLElement) => {
  const cs = window.getComputedStyle(el)
  if (cs.lineHeight === 'normal') return parsePx(cs.fontSize) * 1.2
  return parsePx(cs.lineHeight)
}

const syncTextareaHeight = () => {
  const el = textareaRef.value
  if (!el) return

  const cs = window.getComputedStyle(el)
  const paddingY = parsePx(cs.paddingTop) + parsePx(cs.paddingBottom)
  const borderY = parsePx(cs.borderTopWidth) + parsePx(cs.borderBottomWidth)
  const lineHeight = getLineHeightPx(el)

  const minLines = Math.max(1, Math.floor(props.minLines ?? 1))
  const maxLines = Math.max(minLines, Math.floor(props.maxLines ?? minLines))
  const minHeight = lineHeight * minLines + paddingY + borderY
  const maxHeight = lineHeight * maxLines + paddingY + borderY

  el.style.height = 'auto'
  const desired = el.scrollHeight
  const clamped = Math.min(maxHeight, Math.max(minHeight, desired))
  el.style.height = `${clamped}px`
  el.style.overflowY = desired > maxHeight + 1 ? 'auto' : 'hidden'
}

const scheduleSyncTextareaHeight = async () => {
  if (syncRaf != null) cancelAnimationFrame(syncRaf)
  await nextTick()
  syncRaf = requestAnimationFrame(() => {
    syncRaf = null
    syncTextareaHeight()
  })
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const focusToEnd = async () => {
  await nextTick()
  // Ensure the textarea has its final height before placing the caret,
  // otherwise some browsers may scroll/focus to an intermediate visual line end.
  syncTextareaHeight()
  const el = textareaRef.value
  if (!el) return
  el.focus()
  const len = el.value.length
  const applyCaret = () => {
    try {
      el.setSelectionRange(len, len)
    } catch {
      // ignore (e.g. hidden element)
    }
  }

  // Apply twice: focusing + any async caret/scroll adjustments can override the first setSelectionRange.
  applyCaret()
  await nextFrame()
  syncTextareaHeight()
  applyCaret()
  await nextFrame()
  // Make sure caret is visible for long / wrapped content.
  el.scrollTop = el.scrollHeight
}

defineExpose({ focusToEnd })

onMounted(() => {
  scheduleSyncTextareaHeight()
})

watch(
  () => props.modelValue,
  (value) => {
    scheduleSyncTextareaHeight()
    if (!value) historyCursor.value = null
  }
)

watch(
  () => props.historyEntries,
  () => {
    historyCursor.value = null
  }
)

watch(
  () => props.editMode,
  (v) => {
    if (v) focusToEnd()
  }
)

watch(
  () => [props.minLines, props.maxLines],
  () => {
    scheduleSyncTextareaHeight()
  }
)

watch(
  () => props.workspacePath,
  () => {
    showMcpMenu.value = false
    void loadWorkspaceMcpServers()
  }
)

onBeforeUnmount(() => {
  if (syncRaf != null) cancelAnimationFrame(syncRaf)
})

type DragOverlayMode = 'none' | 'accept' | 'unsupported'

const dragOverlayMode = ref<DragOverlayMode>('none')
let dragEnterCounter = 0

const internalAttachments = ref<File[]>([])
const attachments = computed<File[]>({
  get: () => props.attachments ?? internalAttachments.value,
  set: (value: File[]) => {
    if (props.attachments) emit('update:attachments', value)
    else internalAttachments.value = value
  }
})

const objectUrlByFile = new Map<File, string>()
const getThumbUrl = (file: File): string | null => {
  if (!file.type.startsWith('image/')) return null
  const existing = objectUrlByFile.get(file)
  if (existing) return existing
  const url = URL.createObjectURL(file)
  objectUrlByFile.set(file, url)
  return url
}

watch(
  attachments,
  (next) => {
    const nextSet = new Set(next)
    for (const [file, url] of objectUrlByFile.entries()) {
      if (!nextSet.has(file)) {
        URL.revokeObjectURL(url)
        objectUrlByFile.delete(file)
      }
    }
  },
  { deep: false }
)

onBeforeUnmount(() => {
  for (const url of objectUrlByFile.values()) URL.revokeObjectURL(url)
  objectUrlByFile.clear()
})

const getDroppedImages = (dt: DataTransfer | null): File[] => {
  if (!dt) return []
  const files = Array.from(dt.files || [])
  const fromFiles = files.filter((f) => f.type.startsWith('image/'))
  if (fromFiles.length > 0) return fromFiles

  const items = Array.from(dt.items || [])
  const fromItems: File[] = []
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file && file.type.startsWith('image/')) fromItems.push(file)
    }
  }
  return fromItems
}

const canAttachImages = computed(() => props.supportsImageInput !== false)
const isDragOver = computed(() => dragOverlayMode.value !== 'none')
const isUnsupportedDragOver = computed(() => dragOverlayMode.value === 'unsupported')
const dragOverlayContainerClass = computed(() =>
  dragOverlayMode.value === 'accept'
    ? 'ring-1 ring-(--theme-accent)/20'
    : dragOverlayMode.value === 'unsupported'
      ? 'ring-1 ring-rose-300/30'
      : ''
)
const dragOverlayContainerStyle = computed<CSSProperties | undefined>(() => {
  if (dragOverlayMode.value === 'accept') {
    return {
      borderColor: 'var(--theme-accent)'
    }
  }
  if (dragOverlayMode.value === 'unsupported') {
    return {
      borderColor: 'var(--theme-danger, #f43f5e)'
    }
  }
  return undefined
})
const dragOverlayBackdropClass = computed(() =>
  dragOverlayMode.value === 'accept' ? 'bg-blue-50/70' : 'bg-rose-50/78'
)
const dragOverlayFrameClass = computed(() => 'rounded-[inherit]')
const dragOverlayCardClass = computed(() =>
  dragOverlayMode.value === 'accept'
    ? 'relative bg-white/90 border border-blue-200 ring-1 ring-blue-100/90 text-blue-700'
    : 'relative bg-white/95 border border-rose-300 ring-1 ring-rose-200/90 text-rose-700'
)

const resetDragOverlay = () => {
  dragEnterCounter = 0
  dragOverlayMode.value = 'none'
}

const hasPotentialImagePayload = (dt: DataTransfer | null) => {
  if (!dt) return false

  const items = Array.from(dt.items || [])
  if (items.some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return true

  const files = Array.from(dt.files || [])
  if (files.some((file) => file.type.startsWith('image/'))) return true

  const hasUnknownFileItem = items.some((item) => item.kind === 'file' && !item.type)
  const hasFilesType = Array.from(dt.types || []).includes('Files')
  return hasUnknownFileItem && hasFilesType
}

const onDragEnter = (e: DragEvent) => {
  if (!hasPotentialImagePayload(e.dataTransfer)) return
  dragEnterCounter += 1
  dragOverlayMode.value = canAttachImages.value ? 'accept' : 'unsupported'
}

const onDragLeave = () => {
  if (dragOverlayMode.value === 'none') return
  dragEnterCounter = Math.max(0, dragEnterCounter - 1)
  if (dragEnterCounter === 0) dragOverlayMode.value = 'none'
}

const onDragOver = (e: DragEvent) => {
  if (!hasPotentialImagePayload(e.dataTransfer)) return
  e.preventDefault()
  dragOverlayMode.value = canAttachImages.value ? 'accept' : 'unsupported'
  if (e.dataTransfer) e.dataTransfer.dropEffect = canAttachImages.value ? 'copy' : 'none'
}

const onDrop = (e: DragEvent) => {
  if (!hasPotentialImagePayload(e.dataTransfer)) return
  e.preventDefault()
  const images = getDroppedImages(e.dataTransfer)
  if (!canAttachImages.value) {
    resetDragOverlay()
    return
  }
  resetDragOverlay()
  if (images.length > 0) {
    attachments.value = [...attachments.value, ...images]
    emit('drop-images', images)
  }
}

const removeAttachment = (index: number) => {
  const next = attachments.value.slice()
  next.splice(index, 1)
  attachments.value = next
}

const fileInputRef = ref<HTMLInputElement | null>(null)
const openFilePicker = () => {
  if (!canAttachImages.value) return
  fileInputRef.value?.click()
}
const onPickFiles = (e: Event) => {
  if (!canAttachImages.value) return
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || []).filter((f) => f.type.startsWith('image/'))
  if (files.length > 0) {
    attachments.value = [...attachments.value, ...files]
    emit('drop-images', files)
  }
  input.value = ''
}

const showModelMenu = ref(false)
const modelSearchQuery = ref('')
const modelButtonRef = ref<HTMLElement | null>(null)
const modelMenuRef = ref<HTMLElement | null>(null)
const modelMenuStyle = ref<Record<string, string>>({})
const showMcpMenu = ref(false)
const mcpButtonRef = ref<HTMLElement | null>(null)
const mcpMenuRef = ref<HTMLElement | null>(null)
const mcpMenuStyle = ref<Record<string, string>>({})
let mcpMenuTimer: any = null

const clearMcpMenuTimer = () => {
  if (mcpMenuTimer) {
    clearTimeout(mcpMenuTimer)
    mcpMenuTimer = null
  }
}

const handleMcpMouseEnter = () => {
  clearMcpMenuTimer()
  if (!showMcpMenu.value) {
    applyMcpMenuPosition()
    showModelMenu.value = false
    showThinkingMenu.value = false
    showMcpMenu.value = true
    void loadWorkspaceMcpServers()
  }
}

const handleMcpMouseLeave = () => {
  mcpMenuTimer = setTimeout(() => {
    showMcpMenu.value = false
  }, 200)
}
const showThinkingMenu = ref(false)
const thinkingButtonRef = ref<HTMLElement | null>(null)
const thinkingMenuRef = ref<HTMLElement | null>(null)
const thinkingMenuStyle = ref<Record<string, string>>({})
let thinkingMenuTimer: any = null

const clearThinkingMenuTimer = () => {
  if (thinkingMenuTimer) {
    clearTimeout(thinkingMenuTimer)
    thinkingMenuTimer = null
  }
}

const handleThinkingMouseEnter = () => {
  clearThinkingMenuTimer()
  if (!showThinkingMenu.value) {
    applyThinkingMenuPosition()
    showModelMenu.value = false
    showMcpMenu.value = false
    showThinkingMenu.value = true
  }
}

const handleThinkingMouseLeave = () => {
  thinkingMenuTimer = setTimeout(() => {
    showThinkingMenu.value = false
  }, 200)
}
const mcpLoading = ref(false)
const mcpServers = ref<
  Array<{
    id: string
    name: string
    command: string | null
    enabledForWorkspace: boolean
  }>
>([])
const capabilityTooltip = ref<{
  visible: boolean
  text: string
  left: number
  top: number
}>({
  visible: false,
  text: '',
  left: 0,
  top: 0
})

const currentModelLabel = computed(() => {
  const selected = (props.modelOptions ?? []).find((m) => m.id === props.selectedModelId)
  return selected?.label || props.modelLabel
})

const thinkingOptionMeta: Record<
  ThinkingLevel,
  { title: string; short: string; description: string }
> = {
  off: { title: '关闭', short: 'O', description: '禁用扩展思考' },
  minimal: { title: '极低', short: 'Mi', description: '非常简短的推理，优先速度' },
  low: { title: '低', short: 'L', description: '快速响应，最少推理' },
  medium: { title: '中', short: 'M', description: '平衡速度与推理深度' },
  high: { title: '高', short: 'H', description: '深度推理，适合复杂任务' },
  xhigh: { title: '超高', short: 'XH', description: '最强推理强度，适合最复杂任务' }
}

const orderedThinkingLevels: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh']

const availableThinkingLevels = computed<ThinkingLevel[]>(() => {
  const provided = (props.thinkingLevels ?? []).filter(
    (level): level is ThinkingLevel => orderedThinkingLevels.includes(level) && level !== 'minimal'
  )
  if (provided.length > 0) return provided
  return props.thinkingSupported ? ['off', 'low', 'medium', 'high', 'xhigh'] : ['off']
})

const thinkingOptions = computed(() =>
  orderedThinkingLevels
    .filter((level) => availableThinkingLevels.value.includes(level))
    .map((level) => ({ level, ...thinkingOptionMeta[level] }))
)

const currentThinkingLevel = computed<ThinkingLevel>(() => {
  const selected = props.thinkingLevel
  if (selected && availableThinkingLevels.value.includes(selected)) return selected
  return availableThinkingLevels.value.at(0) ?? 'off'
})

const currentThinkingBadge = computed(() => thinkingOptionMeta[currentThinkingLevel.value].short)

const isThinkingBadgeWide = computed(() => currentThinkingBadge.value.length > 1)

const formatTokens = (value: number) => {
  if (!Number.isFinite(value) || value < 0) return '0'
  return new Intl.NumberFormat('en-US').format(Math.floor(value))
}

// 当前模型的最大上下文 token 数（切换模型时由父组件更新）
const contextTotalTokens = computed(() =>
  Number.isFinite(props.contextTotalTokens)
    ? Math.max(0, Math.floor(props.contextTotalTokens as number))
    : 0
)

const contextUsedTokens = computed(() =>
  Number.isFinite(props.contextUsedTokens)
    ? Math.max(0, Math.floor(props.contextUsedTokens as number))
    : 0
)

const contextUsagePercent = computed(() => {
  void props.selectedModelId

  const total = contextTotalTokens.value
  const used = contextUsedTokens.value

  if (total <= 0 || used <= 0) return 0

  return Math.min(999, Math.floor((used * 100) / total))
})

const contextUsageTooltipText = computed(() => {
  void props.selectedModelId
  if (contextTotalTokens.value <= 0) return ''
  return `上下文使用量\n${formatTokens(contextUsedTokens.value)} / ${formatTokens(
    contextTotalTokens.value
  )} tokens`
})

const filteredModelOptions = computed(() => {
  const q = modelSearchQuery.value.trim().toLowerCase()
  if (!q) return props.modelOptions ?? []
  return (props.modelOptions ?? []).filter((m) => {
    return (
      m.label.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      (m.providerName ?? '').toLowerCase().includes(q)
    )
  })
})

const groupedFilteredModelOptions = computed(() => {
  const groups = new Map<string, (typeof filteredModelOptions.value)[number][]>()
  for (const item of filteredModelOptions.value) {
    const key = item.providerName || 'Other'
    const list = groups.get(key)
    if (list) list.push(item)
    else groups.set(key, [item])
  }
  return Array.from(groups.entries()).map(([providerName, items]) => ({
    providerName,
    items
  }))
})

const enabledMcpCount = computed(
  () => mcpServers.value.filter((item) => item.enabledForWorkspace).length
)

const applyThinkingMenuPosition = () => {
  const rect = thinkingButtonRef.value?.getBoundingClientRect()
  if (!rect) return
  const width = 240
  const margin = 12
  const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin)
  const top = rect.top - 8
  thinkingMenuStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    transform: 'translateY(-100%)'
  }
}

const applyMcpMenuPosition = () => {
  const rect = mcpButtonRef.value?.getBoundingClientRect()
  if (!rect) return
  const width = 240
  const margin = 12
  const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin)
  const top = rect.top - 8
  mcpMenuStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    transform: 'translateY(-100%)'
  }
}

const loadWorkspaceMcpServers = async () => {
  const workspacePath = String(props.workspacePath ?? '').trim()
  if (!workspacePath || mcpLoading.value) {
    if (!workspacePath) mcpServers.value = []
    return
  }

  mcpLoading.value = true
  const startTime = Date.now()
  try {
    const [installed, bindings] = await Promise.all([
      window.api.db.mcpServers.list(),
      window.api.db.workspaceMcpServers.list(workspacePath)
    ])
    const enabledById = new Map(bindings.map((row) => [row.server_id, row.enabled === 1] as const))
    mcpServers.value = installed
      .filter((row) => row.enabled === 1)
      .map((row) => ({
        id: row.id,
        name: row.name,
        command: row.command,
        enabledForWorkspace: enabledById.get(row.id) === true
      }))

    // Add minimal delay to make refresh animation visible
    const elapsed = Date.now() - startTime
    if (elapsed < 400) {
      await new Promise((resolve) => setTimeout(resolve, 400 - elapsed))
    }
  } finally {
    mcpLoading.value = false
  }
}

const toggleThinkingMenu = () => {
  if (!showThinkingMenu.value) {
    applyThinkingMenuPosition()
    showModelMenu.value = false
    showMcpMenu.value = false
    capabilityTooltip.value.visible = false
  }
  showThinkingMenu.value = !showThinkingMenu.value
}

const selectThinkingLevel = (level: ThinkingLevel) => {
  emit('select-thinking-level', level)
}

const toggleMcpMenu = async () => {
  if (!showMcpMenu.value) {
    applyMcpMenuPosition()
    showThinkingMenu.value = false
    showMcpMenu.value = true
    void loadWorkspaceMcpServers()
  }
}

const setWorkspaceMcpEnabled = async (serverId: string, enabled: boolean) => {
  const workspacePath = String(props.workspacePath ?? '').trim()
  if (!workspacePath) return
  await window.api.db.workspaceMcpServers.setEnabled(workspacePath, serverId, enabled)
  mcpServers.value = mcpServers.value.map((item) =>
    item.id === serverId ? { ...item, enabledForWorkspace: enabled } : item
  )
}

const selectAllMcpServers = async () => {
  const workspacePath = String(props.workspacePath ?? '').trim()
  if (!workspacePath) return
  const updates = mcpServers.value.map((item) =>
    window.api.db.workspaceMcpServers.setEnabled(workspacePath, item.id, true)
  )
  await Promise.all(updates)
  mcpServers.value = mcpServers.value.map((item) => ({ ...item, enabledForWorkspace: true }))
}

const clearAllMcpServers = async () => {
  const workspacePath = String(props.workspacePath ?? '').trim()
  if (!workspacePath) return
  await window.api.db.workspaceMcpServers.clear(workspacePath)
  mcpServers.value = mcpServers.value.map((item) => ({ ...item, enabledForWorkspace: false }))
}

const openMcpSettings = () => window.api.openSettings('mcp')

const toggleModelMenu = () => {
  if (!props.modelOptions?.length) return
  if (!showModelMenu.value) {
    const rect = modelButtonRef.value?.getBoundingClientRect()
    if (rect) {
      const width = 320
      const margin = 12
      const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin)
      const top = rect.top - 8
      modelMenuStyle.value = {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        transform: 'translateY(-100%)'
      }
    }
    modelSearchQuery.value = ''
    showThinkingMenu.value = false
    showMcpMenu.value = false
  }
  showModelMenu.value = !showModelMenu.value
  if (!showModelMenu.value) capabilityTooltip.value.visible = false
}

const selectModel = (id: string) => {
  emit('select-model', id)
  showModelMenu.value = false
  capabilityTooltip.value.visible = false
}

const handleClickOutside = (e: MouseEvent) => {
  const target = e.target as Node
  if (showModelMenu.value) {
    if (!modelButtonRef.value?.contains(target) && !modelMenuRef.value?.contains(target)) {
      showModelMenu.value = false
      capabilityTooltip.value.visible = false
    }
  }
  if (showMcpMenu.value) {
    if (!mcpButtonRef.value?.contains(target) && !mcpMenuRef.value?.contains(target)) {
      showMcpMenu.value = false
    }
  }
  if (showThinkingMenu.value) {
    if (!thinkingButtonRef.value?.contains(target) && !thinkingMenuRef.value?.contains(target)) {
      showThinkingMenu.value = false
    }
  }
}

const handleViewportChange = () => {
  showModelMenu.value = false
  showMcpMenu.value = false
  showThinkingMenu.value = false
  capabilityTooltip.value.visible = false
}

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && previewUrl.value) {
    previewUrl.value = null
  }
}

onMounted(() => {
  void loadWorkspaceMcpServers()
  document.addEventListener('mousedown', handleClickOutside)
  document.addEventListener('keydown', handleKeyDown)
  window.addEventListener('resize', handleViewportChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  document.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('resize', handleViewportChange)
})

const previewUrl = ref<string | null>(null)
const openPreview = (file: File) => {
  const url = getThumbUrl(file)
  if (url) previewUrl.value = url
}

const showCapabilityTooltip = (event: MouseEvent, text: string) => {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  const rect = target.getBoundingClientRect()
  capabilityTooltip.value = {
    visible: true,
    text,
    left: rect.left + rect.width / 2,
    top: rect.top - 6
  }
}

const hideCapabilityTooltip = () => {
  capabilityTooltip.value.visible = false
}

const showContextUsageTooltip = (event: MouseEvent) => {
  if (!contextUsageTooltipText.value) return
  showCapabilityTooltip(event, contextUsageTooltipText.value)
}
</script>

<template>
  <!-- Input Box -->
  <div class="pb-4 pt-1 bg-transparent flex justify-center shrink-0 text-[12px] flex-col">
    <div v-if="props.editMode" class="w-full mb-1">
      <div
        class="flex items-center justify-between rounded-2xl border border-(--theme-border-sidebar) px-3 py-2 text-[12px] text-gray-600"
      >
        <div class="font-medium text-gray-600">
          {{ props.editHint?.trim() ? props.editHint : '编辑' }}
        </div>
        <button
          type="button"
          class="inline-flex h-7 w-7 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-200/50 hover:text-gray-700"
          aria-label="取消编辑"
          @click="emit('cancel-edit')"
        >
          <X :size="16" />
        </button>
      </div>
    </div>

    <div
      class="chat-input-box-container relative w-full rounded-2xl border border-(--chat-input-border-idle) overflow-hidden outline-none focus-within:outline-none focus-within:ring-0 focus-within:ring-transparent bg-(--theme-bg-main)/90 backdrop-blur-md"
      :class="dragOverlayContainerClass"
      :style="dragOverlayContainerStyle"
      @dragenter="onDragEnter"
      @dragleave="onDragLeave"
      @dragover="onDragOver"
      @drop="onDrop"
    >
      <div
        v-if="isDragOver"
        class="absolute inset-0 z-20 backdrop-blur-sm flex items-center justify-center pointer-events-none border-2 border-solid"
        :class="[
          dragOverlayBackdropClass,
          dragOverlayFrameClass,
          dragOverlayMode === 'accept' ? 'border-(--theme-accent)' : 'border-rose-500'
        ]"
      >
        <div class="px-4 py-2.5 rounded-2xl shadow-sm text-sm" :class="dragOverlayCardClass">
          <div class="flex items-center gap-2">
            <Ban v-if="isUnsupportedDragOver" :size="14" class="shrink-0" />
            <ImageIcon v-else :size="14" class="shrink-0" />
            <span class="font-medium">
              {{ isUnsupportedDragOver ? '当前模型不支持图片' : '松开鼠标以上传图片' }}
            </span>
          </div>
          <div v-if="isUnsupportedDragOver" class="mt-1 text-[12px] text-rose-600">
            请先切换到支持图片的模型。
          </div>
        </div>
      </div>

      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="onPickFiles"
      />

      <div class="px-4 pt-4 pb-1">
        <div v-if="attachments.length > 0" class="mb-4 flex flex-wrap gap-2">
          <div
            v-for="(file, idx) in attachments"
            :key="`${file.name}-${file.size}-${file.lastModified}`"
            class="relative group w-10 h-10 rounded-lg border border-gray-100 bg-gray-50/40 overflow-hidden transition-all duration-200 hover:shadow-sm hover:border-gray-200/80 flex items-center justify-center shrink-0"
          >
            <!-- 缩略图容器（满铺 1:1） -->
            <div
              class="w-full h-full cursor-pointer flex items-center justify-center"
              title="点击放大"
              @click="openPreview(file)"
            >
              <img
                v-if="getThumbUrl(file)"
                :src="getThumbUrl(file)!"
                class="w-full h-full object-cover"
                alt=""
              />
              <ImageIcon v-else :size="14" class="text-gray-400" />
            </div>

            <!-- 右上角悬浮删除按钮（默认隐藏，Hover 时平滑淡入缩放） -->
            <button
              class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-150 shadow-sm backdrop-blur-[1px]"
              type="button"
              aria-label="Remove attachment"
              @click="removeAttachment(idx)"
            >
              <X :size="8" class="stroke-3" />
            </button>
          </div>
        </div>

        <div
          v-if="isCancelling"
          class="mb-3 flex items-center gap-2 rounded-xl border border-rose-200/80 bg-rose-50/90 px-3 py-2 text-[12px] text-rose-700"
        >
          <Loader2 :size="14" class="shrink-0 animate-spin" />
          <span class="font-medium">取消中，请稍候…</span>
        </div>

        <div
          v-if="hasUnsupportedImageSelection"
          class="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800"
        >
          <ImageIcon :size="14" class="mt-0.5 shrink-0" />
          <div class="min-w-0">
            <div class="font-medium">当前模型不支持图片输入</div>
            <div class="mt-0.5 leading-relaxed text-amber-700">
              发送时会提示是否忽略图片，仅发送文字。你也可以先切换到支持图片的模型。
            </div>
          </div>
        </div>

        <YLAnimatedCaret class="block! w-full" :trail-count="2" :breathe-duration="1.6">
          <textarea
            ref="textareaRef"
            v-model="inputValue"
            data-testid="chat-input"
            class="no-theme-form-control w-full bg-transparent border-none focus:ring-0 outline-none focus:outline-none focus-visible:outline-none no-focus-ring text-[14px] leading-snug resize-none placeholder:text-(--theme-text-dim) text-(--theme-text-main)"
            :placeholder="props.placeholder"
            :rows="composerRows"
            :disabled="composerDisabled"
            @input="onComposerInput"
            @keydown="onComposerKeyDown"
            @keydown.enter="onComposerEnter"
          ></textarea>
        </YLAnimatedCaret>
      </div>

      <div class="px-4 pb-2">
        <div class="h-12 bg-transparent flex items-center justify-between px-1">
          <div class="flex items-center gap-1.5 text-(--theme-text-dim)">
            <button
              class="w-8 h-8 rounded-lg hover:bg-(--theme-bg-hover-btn) flex items-center justify-center"
              :class="canAttachImages ? '' : 'opacity-45 cursor-not-allowed hover:bg-transparent'"
              type="button"
              aria-label="Attach images"
              :title="canAttachImages ? '添加图片' : '当前模型不支持图片输入'"
              @click="openFilePicker"
            >
              <Paperclip :size="16" />
            </button>

            <!-- <button
              class="relative w-8 h-8 rounded-lg bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) border border-black/5 flex items-center justify-center"
              type="button"
              aria-label="Magic"
            >
              <Sparkles :size="16" class="text-(--theme-text-main)" />
              <span
                class="absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full text-white text-[8px] font-bold flex items-center justify-center"
                style="background-color: var(--chat-input-badge-bg, #8aa6b3)"
                >A</span
              >
            </button> -->

            <button
              ref="mcpButtonRef"
              class="relative w-8 h-8 rounded-lg bg-(--chat-input-toolbar-btn-bg,#fcfcfd) hover:bg-(--theme-bg-hover-btn) flex items-center justify-center"
              type="button"
              aria-label="MCP servers"
              @mouseenter="handleMcpMouseEnter"
              @mouseleave="handleMcpMouseLeave"
              @click="toggleMcpMenu"
            >
              <Plug :size="16" class="text-(--theme-text-dim)" />
              <span
                v-if="enabledMcpCount > 0"
                class="absolute top-1 right-1 translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full text-white text-[6px] font-bold flex items-center justify-center"
                style="background-color: var(--chat-input-badge-bg, #00ba88)"
                >{{ enabledMcpCount }}</span
              >
            </button>

            <button
              ref="thinkingButtonRef"
              class="relative w-8 h-8 rounded-lg bg-(--chat-input-toolbar-btn-bg,#fcfcfd) hover:bg-(--theme-bg-hover-btn) flex items-center justify-center"
              type="button"
              aria-label="Thinking level"
              :title="`推理强度：${thinkingOptionMeta[currentThinkingLevel].title}`"
              @mouseenter="handleThinkingMouseEnter"
              @mouseleave="handleThinkingMouseLeave"
              @click="toggleThinkingMenu"
            >
              <Lightbulb :size="16" class="text-(--theme-text-dim)" />
              <span
                v-if="currentThinkingLevel !== 'off'"
                class="thinking-level-badge"
                :class="{ 'thinking-level-badge--wide': isThinkingBadgeWide }"
                style="background-color: var(--chat-input-badge-bg, #00ba88)"
              >
                <span class="thinking-level-badge__label">{{ currentThinkingBadge }}</span>
              </span>
            </button>

            <div class="mx-1.5 h-5 w-px bg-(--theme-border-base)"></div>

            <div>
              <div class="flex items-center gap-1.5">
                <button
                  ref="modelButtonRef"
                  class="flex items-center gap-1.5 px-2 py-2 rounded-lg hover:bg-(--theme-bg-hover-btn) text-(--theme-text-main)"
                  type="button"
                  aria-label="Model selector"
                  @click="toggleModelMenu"
                >
                  <div class="flex items-center gap-2">
                    <Sparkles :size="13" class="text-(--theme-text-dim)" />
                    <span
                      class="text-[12px] font-semibold tracking-tight text-(--theme-text-dim) opacity-90 max-w-44 truncate"
                      >{{ currentModelLabel }}</span
                    >
                  </div>
                  <ChevronDown :size="14" class="text-(--theme-text-dim) ml-0.5" />
                </button>
                <button
                  v-if="contextTotalTokens > 0"
                  class="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-gray-500 hover:bg-(--theme-bg-sidebar) cursor-pointer"
                  type="button"
                  aria-label="Context usage"
                  @mouseenter.stop="showContextUsageTooltip($event)"
                  @mouseleave.stop="hideCapabilityTooltip"
                >
                  <Gauge :size="12" class="text-gray-500" />
                  <span class="text-[11px] leading-none tabular-nums"
                    >{{ contextUsagePercent }}%</span
                  >
                </button>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Tooltip
              v-if="!showAbortButton && props.threadId"
              :text="threadKnowledgeTooltip"
              placement="top"
            >
              <button
                class="w-8 h-8 rounded-full flex items-center justify-center transition"
                :class="'bg-(--theme-bg-sidebar) text-(--theme-text-main)/80 hover:bg-(--theme-bg-hover-btn)'"
                type="button"
                :disabled="threadKnowledgeBusy"
                :aria-label="
                  threadKnowledgeCaptureEnabled ? '当前对话进入记忆' : '当前对话不进入记忆'
                "
                @click="toggleThreadKnowledgeCapture"
              >
                <Eye v-if="threadKnowledgeCaptureEnabled" :size="15" />
                <EyeOff v-else :size="15" />
              </button>
            </Tooltip>
            <button
              v-if="isCancelling"
              class="h-8 min-w-8 px-2.5 rounded-full bg-rose-500/10 border border-rose-500/15 flex items-center justify-center gap-1.5 cursor-wait"
              type="button"
              disabled
              aria-label="取消中"
            >
              <Loader2 :size="13" class="text-rose-600 animate-spin" />
              <span class="text-[11px] font-medium text-rose-600">取消中</span>
            </button>
            <button
              v-else-if="showAbortButton"
              class="w-8 h-8 rounded-full bg-(--theme-bg-sidebar) hover:bg-rose-500/20 border border-red-500/5 flex items-center justify-center cursor-pointer"
              type="button"
              aria-label="Abort"
              title="停止处理"
              @click="emit('cancel')"
            >
              <Square :size="13" class="text-rose-600" />
            </button>
            <button
              v-else
              class="w-8 h-8 rounded-full bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) border border-black/3 flex items-center justify-center"
              type="button"
              aria-label="Send"
              @click="onSendClick"
            >
              <Send :size="16" class="text-(--theme-text-main)" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <Transition name="model-menu">
      <div
        v-if="showMcpMenu"
        ref="mcpMenuRef"
        class="fixed z-80 rounded-2xl border border-(--theme-border-base) bg-(--theme-bg-main) shadow-[0_18px_50px_rgba(0,0,0,0.3)]"
        :style="mcpMenuStyle"
        @mouseenter="clearMcpMenuTimer"
        @mouseleave="handleMcpMouseLeave"
      >
        <div class="border-b border-(--theme-border-base) px-4 py-3">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <Plug :size="14" class="text-(--theme-text-dim)" />
              <div class="text-[12px] font-semibold text-(--theme-text-bright)">MCP 服务器</div>
            </div>
            <div class="flex items-center gap-1">
              <Tooltip text="刷新 MCP 列表">
                <button
                  type="button"
                  class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  aria-label="刷新 MCP 列表"
                  @click="loadWorkspaceMcpServers"
                >
                  <RefreshCw :size="14" :class="{ 'animate-spin': mcpLoading }" />
                </button>
              </Tooltip>
              <Tooltip text="打开 MCP 设置">
                <button
                  type="button"
                  class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  aria-label="打开 MCP 设置"
                  @click="openMcpSettings"
                >
                  <Settings2 :size="14" />
                </button>
              </Tooltip>
            </div>
          </div>
          <p class="mt-1.5 text-[11px] leading-relaxed text-gray-400">
            选择要为当前项目路径启用的服务器。
          </p>
          <div class="mt-3 flex items-center gap-2 text-[11px]">
            <button
              type="button"
              class="rounded-lg bg-gray-100 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-200"
              @click="selectAllMcpServers"
            >
              全选
            </button>
            <button
              type="button"
              class="rounded-lg px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-100"
              @click="clearAllMcpServers"
            >
              清除全部
            </button>
          </div>
        </div>

        <div class="max-h-80 overflow-y-auto px-2 py-2">
          <div
            v-if="mcpLoading && mcpServers.length === 0"
            class="flex h-20 items-center justify-center text-[11px] text-gray-400"
          >
            正在加载 MCP 列表...
          </div>
          <div
            v-else-if="!mcpLoading && !props.workspacePath"
            class="flex h-20 items-center justify-center text-[11px] text-gray-400 text-center"
          >
            当前还没有可用的项目路径。
          </div>
          <div
            v-else-if="!mcpLoading && mcpServers.length === 0"
            class="flex flex-col h-20 items-center justify-center text-[11px] text-gray-400 gap-1.5"
          >
            <div>还没有安装任何 MCP 服务器。</div>
            <button class="text-blue-500 hover:underline cursor-pointer" @click="openMcpSettings">
              去设置里添加
            </button>
          </div>
          <div v-else class="space-y-0.5" :class="{ 'opacity-60 pointer-events-none': mcpLoading }">
            <label
              v-for="server in mcpServers"
              :key="server.id"
              class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-gray-100 cursor-pointer"
            >
              <span class="truncate text-[13px] text-gray-700 select-none">
                {{ server.name }}
              </span>
              <button
                type="button"
                class="relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors"
                :class="server.enabledForWorkspace ? 'bg-[#00ba88]' : 'bg-gray-200'"
                @click.prevent="setWorkspaceMcpEnabled(server.id, !server.enabledForWorkspace)"
              >
                <span
                  class="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform"
                  :class="server.enabledForWorkspace ? 'translate-x-3.5' : 'translate-x-0.5'"
                />
              </button>
            </label>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="model-menu">
      <div
        v-if="showThinkingMenu"
        ref="thinkingMenuRef"
        class="fixed z-80 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.18)]"
        :style="thinkingMenuStyle"
        @mouseenter="clearThinkingMenuTimer"
        @mouseleave="handleThinkingMouseLeave"
      >
        <div class="border-b border-black/5 px-4 py-3">
          <div class="flex items-center gap-2 text-(--theme-text-bright)">
            <Lightbulb :size="14" class="text-(--theme-text-dim)" />
            <div class="text-[12px] font-semibold">推理设置</div>
          </div>
        </div>

        <div class="max-h-90 overflow-y-auto px-1 py-1">
          <div class="space-y-0.5">
            <button
              v-for="option in thinkingOptions"
              :key="option.level"
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-(--theme-bg-hover-btn)"
              :class="{ 'bg-(--theme-bg-hover-btn)': currentThinkingLevel === option.level }"
              @click="selectThinkingLevel(option.level)"
            >
              <div class="w-4 shrink-0 flex items-center justify-center">
                <Check
                  v-if="currentThinkingLevel === option.level"
                  :size="12"
                  class="text-emerald-600"
                />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 h-4.5">
                  <span class="shrink-0 flex items-center justify-center text-(--theme-text-dim)">
                    <Ban v-if="option.level === 'off'" :size="13" />
                    <Lightbulb v-else :size="13" />
                  </span>
                  <span
                    class="truncate text-[12px] font-semibold"
                    :class="
                      currentThinkingLevel === option.level
                        ? 'text-(--theme-text-bright)'
                        : 'text-(--theme-text-main)'
                    "
                  >
                    {{ option.title }}
                  </span>
                </div>
                <p class="mt-0.5 text-[10px] leading-snug text-(--theme-text-dim) line-clamp-2">
                  {{ option.description }}
                </p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="model-menu">
      <div
        v-if="showModelMenu && props.modelOptions?.length"
        ref="modelMenuRef"
        class="fixed z-80 max-h-90 overflow-y-auto rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) shadow-[0_18px_50px_rgba(0,0,0,0.3)]"
        :style="modelMenuStyle"
      >
        <div
          class="sticky top-0 z-10 bg-(--theme-bg-main)/95 backdrop-blur px-3 py-2.5 border-b border-(--theme-border-base)"
        >
          <div class="relative">
            <Search
              :size="13"
              class="absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)"
            />
            <input
              v-model="modelSearchQuery"
              type="text"
              placeholder="搜索模型..."
              class="w-full h-9 pl-8 pr-3 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-content) text-[12px] text-(--theme-text-main) outline-none focus:ring-1 focus:ring-(--theme-accent)/50"
            />
          </div>
        </div>
        <template v-for="group in groupedFilteredModelOptions" :key="group.providerName">
          <div
            class="px-4 py-2.5 text-[11px] font-bold tracking-wider text-(--theme-text-dim) bg-(--theme-bg-content)/50 border-y border-(--theme-border-base) flex items-center gap-2"
          >
            <img
              v-if="getProviderIconUrl(group.providerName)"
              :src="getProviderIconUrl(group.providerName)!"
              :alt="`${group.providerName} icon`"
              class="w-3.5 h-3.5 grayscale opacity-70"
              draggable="false"
            />
            <span>{{ group.providerName }}</span>
          </div>
          <button
            v-for="m in group.items"
            :key="m.id"
            class="w-full text-left px-3.5 py-2.5 hover:bg-(--theme-bg-hover-btn) transition-colors border-b border-(--theme-border-base) last:border-b-0 group"
            :class="
              props.selectedModelId === m.id
                ? 'bg-(--theme-bg-hover-btn)'
                : 'text-(--theme-text-main)'
            "
            type="button"
            @click="selectModel(m.id)"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div
                  class="text-[13px] font-medium truncate"
                  :class="
                    props.selectedModelId === m.id
                      ? 'text-(--theme-text-bright)'
                      : 'text-(--theme-text-main)'
                  "
                >
                  {{ m.label }}
                </div>
                <div class="mt-0.5 flex items-center gap-2 text-(--theme-text-dim) shrink-0">
                  <span
                    v-if="m.supports?.imageInput"
                    class="inline-flex cursor-pointer"
                    @mouseenter.stop="showCapabilityTooltip($event, '图片输入 (Vision)')"
                    @mouseleave.stop="hideCapabilityTooltip"
                  >
                    <ImageIcon :size="10" />
                  </span>
                  <span
                    v-if="m.supports?.tools"
                    class="inline-flex cursor-pointer"
                    @mouseenter.stop="showCapabilityTooltip($event, '函数调用 (Tool Calling)')"
                    @mouseleave.stop="hideCapabilityTooltip"
                  >
                    <Wand2 :size="10" />
                  </span>
                  <span
                    v-if="m.supports?.reasoning"
                    class="inline-flex cursor-pointer"
                    @mouseenter.stop="showCapabilityTooltip($event, '思考模式 (Reasoning)')"
                    @mouseleave.stop="hideCapabilityTooltip"
                  >
                    <Sparkles :size="10" />
                  </span>
                  <span
                    v-if="m.contextWindow"
                    class="inline-flex cursor-pointer text-[9px] font-mono opacity-70"
                    @mouseenter.stop="
                      showCapabilityTooltip($event, `上下文窗口: ${m.contextWindow}`)
                    "
                    @mouseleave.stop="hideCapabilityTooltip"
                  >
                    {{ m.contextWindow }}
                  </span>
                </div>
              </div>
              <Check
                v-if="props.selectedModelId === m.id"
                :size="14"
                class="shrink-0 text-[#00ba88]"
              />
            </div>
          </button>
        </template>
        <div
          v-if="filteredModelOptions.length === 0"
          class="px-3 py-6 text-center text-[12px] text-gray-500"
        >
          没有匹配模型
        </div>
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <Transition name="preview-fade">
      <div
        v-if="previewUrl"
        class="fixed inset-0 z-100 flex items-center justify-center bg-transparent p-10"
        @click="previewUrl = null"
      >
        <div class="relative" @click.stop>
          <img
            :src="previewUrl"
            class="block w-auto h-auto max-w-[90vw] max-h-[85vh] min-w-[320px] min-h-60 object-contain rounded-2xl shadow-2xl border border-white/10 bg-white/5"
            alt="Preview"
          />
          <button
            class="absolute -top-4 -right-4 w-9 h-9 rounded-full border border-black/8 bg-white/95 hover:bg-white text-gray-800 flex items-center justify-center transition-all cursor-pointer shadow-xl z-10"
            @click.stop="previewUrl = null"
          >
            <X :size="20" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>

  <FloatingTooltip
    :visible="capabilityTooltip.visible"
    :text="capabilityTooltip.text"
    :left="capabilityTooltip.left"
    :top="capabilityTooltip.top"
    @mouseleave="hideCapabilityTooltip"
  />
</template>

<style scoped>
.chat-input-box-container {
  /* 平滑过渡边框颜色与阴影 */
  transition:
    border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  /* 还原原本底部的拟物深邃投影 */
  box-shadow:
    0 8px 30px rgba(0, 0, 0, 0.04),
    0 20px 40px rgba(0, 0, 0, 0.03),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset,
    0 1px 1px rgba(0, 0, 0, 0.02);
}

.chat-input-box-container:focus-within {
  /* ChatBox 面积大，focus 只保留轻微提示，避免抢视觉中心 */
  border-color: color-mix(in srgb, var(--focus-ring-color) 4%, var(--theme-border-base));
  box-shadow:
    0 9px 28px rgba(0, 0, 0, 0.055),
    0 18px 34px rgba(0, 0, 0, 0.038),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset,
    0 1px 1px rgba(0, 0, 0, 0.02),
    0 0 9px 1px color-mix(in srgb, var(--focus-ring-color) 5%, transparent),
    0 0 16px 3px color-mix(in srgb, var(--focus-ring-color) 2.5%, transparent);
}

.no-focus-ring:focus,
.no-focus-ring:focus-visible {
  outline: none;
  box-shadow: none;
  border-color: transparent;
}

.model-menu-enter-active,
.model-menu-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}

.model-menu-enter-from,
.model-menu-leave-to {
  opacity: 0;
  transform: translateY(-96%);
}

/* Image Preview Transition */
.preview-fade-enter-active,
.preview-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
  filter: blur(4px);
}

.thinking-level-badge {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  transform: translate(50%, -50%);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  height: 10px;
  border-radius: 9999px;
  color: #fff;
  font-size: 6px;
  font-weight: 700;
  line-height: 1;
  padding: 0;
}

.thinking-level-badge--wide {
  width: auto;
  min-width: 12px;
  padding: 0 1.5px;
}

.thinking-level-badge__label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
</style>
