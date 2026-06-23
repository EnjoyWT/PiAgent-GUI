<script setup lang="ts">
import { computed } from 'vue'
import { CircleHelp, Wrench, Wand2 } from 'lucide-vue-next'
import Tooltip from '../common/Tooltip.vue'
import type { AgentTurn } from './types'

const props = defineProps<{
  turn: AgentTurn
  hasMessageContent?: boolean
}>()

const toolCalls = computed(() => props.turn.toolCalls)

const toolNames = computed(() => {
  const names = new Set<string>()
  for (const call of toolCalls.value) {
    if (call.kind !== 'tool' || call.invocation !== 'direct') continue
    const name = (call.name || '').trim()
    if (name) names.add(name)
  }
  return Array.from(names)
})

const toolTypeCount = computed(() => {
  const normalized = new Set<string>()
  for (const name of toolNames.value) {
    const key = (name || '').trim().toLowerCase()
    if (key) normalized.add(key)
  }
  return normalized.size
})

const skillNames = computed(() => {
  const names = new Set<string>()
  for (const call of toolCalls.value) {
    if (call.invocation !== 'skill') continue
    const name = (call.skillName || '').trim()
    if (name) names.add(name)
  }
  return Array.from(names)
})

const questionCount = computed(
  () => toolCalls.value.filter((call) => call.kind === 'question').length
)

const questionTooltip = computed(() => {
  if (questionCount.value === 0) return '暂无提问'
  return `阻塞式提问：${questionCount.value} 次`
})

const skillNamesTooltip = computed(() => {
  if (skillNames.value.length === 0) return '暂无技能明细'
  const sorted = [...skillNames.value].sort((a, b) => a.localeCompare(b))
  return '使用技能：\n' + sorted.map((name) => `• ${name}`).join('\n')
})

const toolNamesTooltip = computed(() => {
  const terminalTools = new Set(['bash', 'ls', 'grep', 'find'])
  const grouped = new Map<string, string[]>()
  for (const rawName of toolNames.value) {
    const name = (rawName || '').trim()
    if (!name) continue
    const category = terminalTools.has(name.toLowerCase()) ? 'bash' : name
    const list = grouped.get(category) ?? []
    if (!list.includes(name)) list.push(name)
    grouped.set(category, list)
  }
  if (grouped.size === 0) return '暂无工具明细'
  const segments = Array.from(grouped.entries())
    .map(([category, list]) => {
      const sorted = [...list].sort((a, b) => a.localeCompare(b))
      if (sorted.length === 1 && sorted[0].toLowerCase() === category.toLowerCase()) {
        return `${category}`
      }
      return `${category}: ${sorted.join(', ')}`
    })
    .sort((a, b) => a.localeCompare(b))
  return '使用工具：\n' + segments.map((line) => `• ${line}`).join('\n')
})

const hasMetrics = computed(
  () => toolTypeCount.value > 0 || skillNames.value.length > 0 || questionCount.value > 0
)
const showTimeline = computed(() => hasMetrics.value)
</script>

<template>
  <div v-if="showTimeline" class="text-[12px] text-gray-700">
    <div class="flex flex-wrap items-center gap-3 text-[#6d8d95]">
      <div v-if="hasMetrics" class="inline-flex items-center gap-3">
        <Tooltip v-if="toolTypeCount > 0" :text="toolNamesTooltip" multiline :max-width="260">
          <span
            class="inline-flex items-center gap-1 border-b border-dotted border-[#8fb0b9] cursor-pointer"
          >
            <Wrench :size="12" />
            <span>{{ toolTypeCount }} 个工具</span>
          </span>
        </Tooltip>
        <Tooltip v-if="skillNames.length > 0" :text="skillNamesTooltip" multiline :offset="8">
          <span
            class="inline-flex items-center gap-1 border-b border-dotted border-[#8fb0b9] cursor-pointer"
          >
            <Wand2 :size="12" />
            <span>{{ skillNames.length }} 个技能</span>
          </span>
        </Tooltip>
        <Tooltip v-if="questionCount > 0" :text="questionTooltip" multiline :offset="8">
          <span
            class="inline-flex items-center gap-1 border-b border-dotted border-[#8fb0b9] cursor-pointer"
          >
            <CircleHelp :size="12" />
            <span>{{ questionCount }} 次提问</span>
          </span>
        </Tooltip>
      </div>
    </div>
  </div>
</template>
