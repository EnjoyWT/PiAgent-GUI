<template>
  <div class="flex w-full h-full flex-col gap-3">
    <div class="flex items-center gap-2">
      <div class="relative w-72">
        <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索任务名称、计划或目标..."
          class="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-[#86a5ae] outline-none"
        />
      </div>

      <button
        type="button"
        class="h-9 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold"
        @click="openCreateModal"
      >
        <span class="inline-flex items-center gap-1.5">
          <Plus :size="14" />
          新建任务
        </span>
      </button>

      <button
        type="button"
        class="h-9 w-9 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 flex items-center justify-center"
        :disabled="loading"
        title="刷新"
        @click="refreshTaskList()"
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

    <div v-if="toastMessage" class="fixed right-6 top-6 z-80 pointer-events-none">
      <div
        class="min-w-[16rem] max-w-[24rem] rounded-xl border px-4 py-3 text-sm shadow-lg"
        :class="toastKind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'"
      >
        {{ toastMessage }}
      </div>
    </div>

    <section
      class="flex-1 min-h-0 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col"
    >
      <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-semibold text-gray-900">定时任务列表</div>
          <div class="mt-1 text-xs text-gray-500">
            点击任务查看详情，行内操作负责立即运行和暂停恢复。
          </div>
        </div>
        <div class="text-xs text-gray-500">
          {{ filteredTasks.length }} / {{ tasks.length }} 个任务
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-3">
        <div
          v-for="task in filteredTasks"
          :key="task.id"
          class="rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 transition"
          :class="selectedTaskId === task.id ? 'border-[#86a5ae] bg-[#eef4f5]' : ''"
        >
          <div class="flex items-stretch gap-3 px-4 py-4">
            <button
              type="button"
              class="flex-1 min-w-0 text-left"
              @click="openDetailModal(task.id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-gray-900">
                    {{ task.name }}
                  </div>
                  <div class="mt-1 truncate text-[11px] text-gray-500">
                    {{ task.scheduleDisplay }}
                  </div>
                </div>
                <span
                  class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  :class="statusBadgeClass(task.status)"
                >
                  {{ statusLabel(task.status) }}
                </span>
              </div>

              <div class="mt-4 grid grid-cols-4 gap-3 text-[11px] text-gray-500">
                <div class="truncate">下次: {{ formatDateTime(task.nextRunAt) }}</div>
                <div class="truncate">上次: {{ statusLabel(resolveTaskDisplayStatus(task)) }}</div>
                <div class="truncate">
                  模式: {{ task.executionMode === 'isolated_thread' ? '独立线程' : '主会话' }}
                </div>
                <div class="truncate">目标: {{ resolveTaskTargetLabel(task) }}</div>
              </div>
              <div
                v-if="shouldShowLastRunError(task)"
                class="mt-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-700"
              >
                {{ extractShortError(task.lastErrorText) }}
              </div>
            </button>

            <div class="shrink-0 flex items-center gap-2">
              <button
                type="button"
                class="h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700"
                title="立即运行一次"
                @click.stop="runNow(task.id)"
              >
                立即运行
              </button>
              <button
                type="button"
                class="h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700"
                :title="task.enabled ? '暂停任务' : '恢复任务'"
                @click.stop="togglePaused(task)"
              >
                {{ task.enabled ? '暂停' : '恢复' }}
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="filteredTasks.length === 0"
          class="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-xs text-gray-500"
        >
          没有匹配的任务。
        </div>
      </div>
    </section>
  </div>

  <div
    v-if="showDetailModal && selectedTask"
    class="fixed inset-0 z-60 flex items-center justify-center bg-black/30 backdrop-blur-sm"
    @mousedown.self="closeDetailModal"
  >
    <div
      class="bg-white rounded-2xl shadow-2xl w-245 max-w-[94%] max-h-[88vh] overflow-hidden flex flex-col"
    >
      <div class="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <Clock3 :size="18" class="text-gray-500" />
            <h2 class="text-lg font-bold text-gray-900">{{ selectedTask.name }}</h2>
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              :class="statusBadgeClass(selectedTask.status)"
            >
              {{ statusLabel(selectedTask.status) }}
            </span>
          </div>
          <p class="mt-1 text-xs leading-5 text-gray-500 max-w-180">
            {{ selectedTask.description || '当前任务没有描述。' }}
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700"
            @click="openEditModal(selectedTask)"
          >
            <span class="inline-flex items-center gap-1.5">
              <PencilLine :size="13" />
              编辑
            </span>
          </button>
          <button
            type="button"
            class="h-8 px-3 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-600"
            @click="deleteTask(selectedTask)"
          >
            <span class="inline-flex items-center gap-1.5">
              <Trash2 :size="13" />
              删除
            </span>
          </button>
          <button
            type="button"
            class="h-8 w-8 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 flex items-center justify-center"
            @click="closeDetailModal"
          >
            <X :size="16" />
          </button>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-hidden p-5 grid grid-cols-[minmax(0,1fr)_320px] gap-3">
        <section class="min-h-0 flex flex-col gap-3 overflow-hidden">
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] font-bold uppercase text-gray-500">计划</div>
              <div class="mt-1 text-sm font-semibold text-gray-900">
                {{ selectedTask.scheduleDisplay }}
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] font-bold uppercase text-gray-500">下次执行</div>
              <div class="mt-1 text-sm font-semibold text-gray-900">
                {{ formatDateTime(selectedTask.nextRunAt) }}
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] font-bold uppercase text-gray-500">执行模式</div>
              <div class="mt-1 text-sm font-semibold text-gray-900">
                {{ selectedTask.executionMode === 'isolated_thread' ? '独立线程' : '主会话' }}
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] font-bold uppercase text-gray-500">最后状态</div>
              <div class="mt-1 text-sm font-semibold text-gray-900">
                {{ statusLabel(resolveTaskDisplayStatus(selectedTask)) }}
              </div>
              <div
                v-if="shouldShowLastRunError(selectedTask)"
                class="mt-2 rounded-lg border border-rose-100 bg-rose-50 px-2.5 py-2 text-[11px] leading-5 text-rose-700"
              >
                {{ selectedTask.lastErrorText }}
              </div>
            </div>
          </div>

          <section
            class="flex-1 min-h-0 bg-white border border-gray-200 rounded-2xl shadow-sm p-5 overflow-hidden flex flex-col"
          >
            <div class="flex items-center justify-between gap-3 shrink-0">
              <div>
                <h3 class="text-sm font-semibold text-gray-900">最近运行</h3>
                <p class="mt-1 text-xs text-gray-500">查看该任务最近一次到多次触发情况。</p>
              </div>
              <History :size="16" class="text-gray-400" />
            </div>

            <div class="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
              <div
                v-if="selectedTaskRuns.length === 0"
                class="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-xs text-gray-500"
              >
                当前任务还没有运行记录。
              </div>

              <div
                v-for="run in selectedTaskRuns"
                :key="run.id"
                class="rounded-xl border border-gray-200 px-4 py-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-semibold text-gray-900">
                      {{ statusLabel(run.status) }}
                    </div>
                    <div class="mt-1 text-[11px] text-gray-500">
                      计划: {{ formatDateTime(run.scheduledFor) }}
                    </div>
                  </div>
                  <span
                    class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    :class="runBadgeClass(run.status)"
                  >
                    {{ statusLabel(run.status) }}
                  </span>
                </div>

                <div class="mt-3 grid grid-cols-2 gap-2 text-[11px] text-gray-500">
                  <div>开始: {{ formatDateTime(run.startedAt) }}</div>
                  <div>结束: {{ formatDateTime(run.endedAt) }}</div>
                  <div v-if="run.agentRunId" class="col-span-2 truncate">
                    Run: {{ run.agentRunId }}
                  </div>
                  <div v-if="run.errorText" class="col-span-2 text-rose-600">
                    {{ run.errorText }}
                  </div>
                  <div v-else-if="run.resultSummary" class="col-span-2 text-gray-600">
                    {{ run.resultSummary }}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </section>

        <section class="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 overflow-y-auto">
          <h3 class="text-sm font-semibold text-gray-900">执行上下文</h3>
          <div class="mt-4 space-y-3 text-sm">
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] font-bold uppercase text-gray-500">执行目标</div>
              <div class="mt-1 wrap-break-word text-gray-700">
                {{ resolveTaskTargetLabel(selectedTask) }}
              </div>
              <div
                v-if="resolveTaskTargetSubtitle(selectedTask)"
                class="mt-1 text-[11px] text-gray-500"
              >
                {{ resolveTaskTargetSubtitle(selectedTask) }}
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] font-bold uppercase text-gray-500">工作目录</div>
              <div class="mt-1 break-all text-gray-700">
                {{ selectedTask.workspacePath || '未设置' }}
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] font-bold uppercase text-gray-500">执行模型</div>
              <div class="mt-1 wrap-break-word text-gray-700">
                {{ resolveModelLabel(selectedTask) }}
              </div>
            </div>
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div class="text-[11px] font-bold uppercase text-gray-500">Prompt</div>
              <div class="mt-1 whitespace-pre-wrap wrap-break-wordword text-gray-700">
                {{ selectedTask.prompt }}
              </div>
            </div>
            <div
              class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-800"
            >
              内部运行时仍然会把任务映射到具体线程或会话，但这些内部 ID
              不再暴露给用户。列表页负责高频操作，详情弹窗负责查看完整信息和编辑。
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>

  <div
    v-if="showTaskModal"
    class="fixed inset-0 z-60 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
    @mousedown.self="closeTaskModal"
  >
    <div
      class="bg-white rounded-2xl shadow-2xl w-180 max-w-[92%] max-h-[78vh] overflow-hidden flex flex-col"
    >
      <div
        class="px-6 pt-6 pb-4 border-b border-gray-100 shrink-0 flex items-center justify-between gap-4"
      >
        <div>
          <div class="text-xl font-bold text-gray-900">
            {{ modalMode === 'create' ? '新建定时任务' : '编辑定时任务' }}
          </div>
          <div class="mt-1 text-xs text-gray-500">
            创建和编辑都通过独立弹窗完成，主界面保持为任务列表和详情浏览。
          </div>
        </div>
        <button
          type="button"
          class="h-8 w-8 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 flex items-center justify-center"
          @click="closeTaskModal"
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

          <div class="grid grid-cols-2 gap-3">
            <div class="col-span-2 space-y-2">
              <label class="text-[11px] font-bold uppercase text-gray-600">名称</label>
              <input
                v-model="modalForm.name"
                type="text"
                placeholder="例如：工作日报"
                class="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-1 focus:ring-[#86a5ae] outline-none"
              />
            </div>

            <div class="col-span-2 space-y-2">
              <label class="text-[11px] font-bold uppercase text-gray-600">Prompt</label>
              <textarea
                v-model="modalForm.prompt"
                rows="4"
                placeholder="任务触发时要执行的内容。"
                class="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm leading-6 focus:ring-1 focus:ring-[#86a5ae] outline-none resize-none"
              />
            </div>

            <div class="space-y-2">
              <label class="text-[11px] font-bold uppercase text-gray-600">计划</label>
              <input
                v-model="modalForm.schedule"
                type="text"
                placeholder="every 1h / 0 9 * * * / at 2026-04-24T09:00:00.000Z"
                class="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-1 focus:ring-[#86a5ae] outline-none"
              />
            </div>

            <div class="space-y-2">
              <label class="text-[11px] font-bold uppercase text-gray-600">执行模式</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  class="h-10 rounded-lg border text-sm font-semibold transition"
                  :class="
                    modalForm.executionMode === 'main_thread'
                      ? 'border-[#86a5ae] bg-[#e8f0f2] text-[#57727a]'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  "
                  @click="modalForm.executionMode = 'main_thread'"
                >
                  主会话
                </button>
                <button
                  type="button"
                  class="h-10 rounded-lg border text-sm font-semibold transition"
                  :class="
                    modalForm.executionMode === 'isolated_thread'
                      ? 'border-[#86a5ae] bg-[#e8f0f2] text-[#57727a]'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  "
                  @click="modalForm.executionMode = 'isolated_thread'"
                >
                  独立线程
                </button>
              </div>
            </div>

            <div class="col-span-2 space-y-2">
              <label class="text-[11px] font-bold uppercase text-gray-600">执行模型</label>
              <button
                ref="modelButtonRef"
                type="button"
                class="w-full h-11 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-between gap-3"
                @click="toggleModelMenu"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <Cpu :size="16" class="text-gray-400 shrink-0" />
                  <span class="text-[13px] font-medium truncate text-gray-700">
                    {{ selectedModelLabel }}
                  </span>
                </div>
                <component
                  :is="modalForm.modelProviderId && modalForm.modelId ? X : ChevronDown"
                  :size="16"
                  :class="modalForm.modelProviderId && modalForm.modelId ? 'text-gray-400 hover:text-gray-600' : 'text-gray-400'"
                  @click.stop="modalForm.modelProviderId && modalForm.modelId ? clearModelSelection() : undefined"
                />
              </button>

              <div
                v-if="showModelMenu"
                ref="modelMenuRef"
                class="rounded-xl border border-gray-200 bg-white shadow-lg z-10"
              >
                <div class="p-2 border-b border-gray-100">
                  <div class="relative">
                    <Search
                      :size="14"
                      class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                      ref="modelSearchRef"
                      v-model="modelSearchQuery"
                      type="text"
                      placeholder="搜索模型..."
                      class="w-full h-9 pl-9 pr-3 rounded-lg border border-gray-200 bg-gray-50 text-[13px] outline-none focus:ring-1 focus:ring-[#86a5ae]"
                    />
                  </div>
                </div>

                <div class="max-h-60 overflow-y-auto">
                  <button
                    type="button"
                    class="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-100 text-[13px] text-gray-500"
                    @click="clearModelSelection"
                  >
                    不指定（使用默认模型）
                  </button>

                  <template v-for="group in groupedFilteredModels" :key="group.providerName">
                    <div
                      class="px-4 py-2 text-[12px] bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold"
                    >
                      {{ group.providerName }}
                    </div>
                    <button
                      v-for="m in group.items"
                      :key="m.key"
                      class="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 text-[13px]"
                      :class="
                        modalForm.modelProviderId === m.providerId && modalForm.modelId === m.modelId
                          ? 'bg-[#eef4f5] text-[#57727a]'
                          : 'text-gray-700'
                      "
                      type="button"
                      @click="selectModel(m)"
                    >
                      <div class="flex items-center justify-between gap-3">
                        <span class="truncate">{{ m.label }}</span>
                        <Check
                          v-if="modalForm.modelProviderId === m.providerId && modalForm.modelId === m.modelId"
                          :size="14"
                          class="text-emerald-600 shrink-0"
                        />
                      </div>
                    </button>
                  </template>

                  <div
                    v-if="groupedFilteredModels.length === 0"
                    class="px-4 py-6 text-center text-[12px] text-gray-500"
                  >
                    没有匹配模型
                  </div>
                </div>
              </div>
              <p class="text-[11px] leading-5 text-gray-500">
                指定执行此任务的模型。留空则使用默认配置文件中的模型。
              </p>
            </div>

            <div class="col-span-2 space-y-2">
              <label class="text-[11px] font-bold uppercase text-gray-600">执行目标</label>
              <template v-if="modalForm.executionMode === 'main_thread'">
                <select
                  v-model="modalForm.targetKey"
                  class="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-1 focus:ring-[#86a5ae] outline-none"
                >
                  <option value="">请选择一个目标线程或会话</option>
                  <optgroup v-if="localTargetOptions.length > 0" label="本地线程">
                    <option
                      v-for="option in localTargetOptions"
                      :key="option.key"
                      :value="option.key"
                    >
                      {{ option.label }}{{ option.subtitle ? ` · ${option.subtitle}` : '' }}
                    </option>
                  </optgroup>
                  <optgroup v-if="imTargetOptions.length > 0" label="IM 会话">
                    <option v-for="option in imTargetOptions" :key="option.key" :value="option.key">
                      {{ option.label }}{{ option.subtitle ? ` · ${option.subtitle}` : '' }}
                    </option>
                  </optgroup>
                </select>
                <p class="text-[11px] leading-5 text-gray-500">
                  选择一个现有线程或会话，任务触发时会在该上下文中执行。
                </p>
                <div
                  v-if="
                    modalMode === 'edit' &&
                    !modalForm.targetKey &&
                    selectedTask &&
                    (selectedTask.targetThreadId || selectedTask.targetConversationId)
                  "
                  class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-800"
                >
                  当前任务原有目标无法映射为可见线程或会话。保存前请重新选择一个目标。
                </div>
              </template>
              <div
                v-else
                class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700"
              >
                任务触发时自动创建独立线程执行，不需要预先绑定具体聊天。
              </div>
            </div>

            <div class="col-span-2 space-y-2">
              <label class="text-[11px] font-bold uppercase text-gray-600">描述</label>
              <input
                v-model="modalForm.description"
                type="text"
                placeholder="可选，用于记录任务用途。"
                class="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-1 focus:ring-[#86a5ae] outline-none"
              />
            </div>

            <div class="col-span-2 space-y-2">
              <label class="text-[11px] font-bold uppercase text-gray-600">工作目录</label>
              <input
                v-model="modalForm.workspacePath"
                type="text"
                placeholder="/path/to/workspace（独立线程模式推荐设置）"
                class="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-1 focus:ring-[#86a5ae] outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="shrink-0 px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
        <button
          type="button"
          class="h-10 px-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-semibold"
          @click="closeTaskModal"
        >
          取消
        </button>
        <button
          type="button"
          class="h-10 px-4 rounded-lg bg-[#8aaeb7] text-white font-semibold disabled:opacity-60"
          :disabled="modalSaving"
          @click="submitTaskModal"
        >
          {{ modalSaving ? '保存中...' : modalMode === 'create' ? '创建任务' : '保存修改' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Check, ChevronDown, Clock3, Cpu, History, PencilLine, Plus, RefreshCw, Search, Trash2, X } from 'lucide-vue-next'
import { globalDialog } from '../../../utils/dialog'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskRunStatus,
  ScheduledTaskStatus,
  UpdateScheduledTaskInput
} from '../../../../../shared/scheduled-tasks.ts'

const emit = defineEmits<{
  (e: 'dirty-change', dirty: boolean): void
}>()

type TaskFormState = {
  name: string
  prompt: string
  schedule: string
  description: string
  executionMode: 'main_thread' | 'isolated_thread'
  targetKey: string
  workspacePath: string
  modelProviderId: string
  modelId: string
}

type TaskTargetOption = {
  key: string
  kind: 'local_thread' | 'conversation'
  conversationId: string | null
  threadId: string | null
  label: string
  subtitle: string | null
}

const tasks = ref<ScheduledTask[]>([])
const selectedTaskId = ref('')
const selectedTaskRuns = ref<ScheduledTaskRun[]>([])
const searchQuery = ref('')
const loading = ref(false)
const refreshIconSpinning = ref(false)
let refreshIconTimer: ReturnType<typeof setTimeout> | null = null
let taskAutoRefreshTimer: ReturnType<typeof setInterval> | null = null

const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const showToast = (message: string, kind: 'success' | 'error' = 'success', durationMs = 2400) => {
  toastMessage.value = message
  toastKind.value = kind
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMessage.value = ''
    toastTimer = null
  }, durationMs)
}

const showTaskModal = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const modalSaving = ref(false)
const modalErrorMessage = ref('')
const modalBaseSnapshot = ref('')
const showDetailModal = ref(false)
const targetOptions = ref<TaskTargetOption[]>([])

const allModelOptions = ref<ModelOption[]>([])
const showModelMenu = ref(false)
const modelSearchQuery = ref('')
const modelButtonRef = ref<HTMLElement | null>(null)
const modelMenuRef = ref<HTMLElement | null>(null)
const modelSearchRef = ref<HTMLInputElement | null>(null)

type ModelOption = {
  key: string
  providerId: string
  providerName: string
  modelId: string
  label: string
}

const modalForm = reactive<TaskFormState>({
  name: '',
  prompt: '',
  schedule: 'every 1h',
  description: '',
  executionMode: 'main_thread',
  targetKey: '',
  workspacePath: '',
  modelProviderId: '',
  modelId: ''
})

const selectedTask = computed(
  () => tasks.value.find((task) => task.id === selectedTaskId.value) ?? null
)

const filteredTasks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return tasks.value
  return tasks.value.filter((task) =>
    [
      task.name,
      task.scheduleDisplay,
      task.targetConversationId,
      task.targetThreadId,
      task.workspacePath
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q)
  )
})

const metrics = computed(() => [
  { label: '总任务', value: tasks.value.length },
  { label: '启用中', value: tasks.value.filter((task) => task.enabled).length },
  { label: '运行中', value: tasks.value.filter((task) => task.status === 'running').length },
  {
    label: '最近失败',
    value: tasks.value.filter((task) => task.lastRunStatus === 'failed').length
  }
])

const localTargetOptions = computed(() =>
  targetOptions.value.filter((option) => option.kind === 'local_thread')
)

const imTargetOptions = computed(() =>
  targetOptions.value.filter((option) => option.kind === 'conversation')
)

const normalizeForm = (form: TaskFormState): TaskFormState => ({
  name: form.name.trim(),
  prompt: form.prompt.trim(),
  schedule: form.schedule.trim(),
  description: form.description.trim(),
  executionMode: form.executionMode,
  targetKey: form.targetKey.trim(),
  workspacePath: form.workspacePath.trim(),
  modelProviderId: form.modelProviderId.trim(),
  modelId: form.modelId.trim()
})

const isModalDirty = computed(
  () => showTaskModal.value && JSON.stringify(normalizeForm(modalForm)) !== modalBaseSnapshot.value
)

watch(
  () => isModalDirty.value,
  (dirty) => emit('dirty-change', dirty),
  { immediate: true }
)

onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer)
  if (refreshIconTimer) clearTimeout(refreshIconTimer)
  if (taskAutoRefreshTimer) clearInterval(taskAutoRefreshTimer)
  document.removeEventListener('mousedown', onGlobalPointerDown, true)
  document.removeEventListener('keydown', onGlobalKeyDown, true)
})

const syncModalSnapshot = () => {
  modalBaseSnapshot.value = JSON.stringify(normalizeForm(modalForm))
}

const applyModalForm = (task: ScheduledTask | null) => {
  if (!task) {
    modalForm.name = ''
    modalForm.prompt = ''
    modalForm.schedule = 'every 1h'
    modalForm.description = ''
    modalForm.executionMode = 'main_thread'
    modalForm.targetKey = ''
    modalForm.workspacePath = ''
    modalForm.modelProviderId = ''
    modalForm.modelId = ''
    syncModalSnapshot()
    return
  }

  modalForm.name = task.name
  modalForm.prompt = task.prompt
  modalForm.schedule = task.scheduleDisplay
  modalForm.description = task.description ?? ''
  modalForm.executionMode = task.executionMode
  modalForm.targetKey = resolveTaskTargetKey(task)
  modalForm.workspacePath = task.workspacePath ?? ''
  const execOverride = (task as any).triggerExecutionOverride
  modalForm.modelProviderId = execOverride?.model?.providerId ?? ''
  modalForm.modelId = execOverride?.model?.modelId ?? ''
  syncModalSnapshot()
}

watch(
  () => selectedTaskId.value,
  async (taskId) => {
    if (!taskId) {
      selectedTaskRuns.value = []
      return
    }
    selectedTaskRuns.value = await window.api.scheduledTasks.listRuns(taskId, 12)
  }
)

const buildPayload = (): CreateScheduledTaskInput => {
  const current = normalizeForm(modalForm)
  const targetOption =
    current.executionMode === 'main_thread' ? getTargetOptionByKey(current.targetKey) : null

  if (!current.name) {
    throw new Error('任务名称不能为空。')
  }
  if (!current.prompt) {
    throw new Error('Prompt 不能为空。')
  }
  if (!current.schedule) {
    throw new Error('计划不能为空。')
  }
  if (current.executionMode === 'main_thread' && !targetOption) {
    throw new Error('主会话模式需要选择一个执行目标。')
  }

  return {
    name: current.name,
    prompt: current.prompt,
    schedule: current.schedule,
    description: current.description || null,
    executionMode: current.executionMode,
    targetConversationId:
      current.executionMode === 'main_thread' ? (targetOption?.conversationId ?? null) : null,
    targetThreadId:
      current.executionMode === 'main_thread' ? (targetOption?.threadId ?? null) : null,
    workspacePath: current.workspacePath || null,
    modelProviderId: current.modelProviderId || null,
    modelId: current.modelId || null
  }
}

const summarizeWorkspace = (workspacePath: string | null | undefined): string => {
  const value = String(workspacePath ?? '').trim()
  if (!value) return '未绑定工作目录'
  const normalized = value.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) ?? value
}

const buildLocalThreadLabel = (thread: ThreadRow): string =>
  thread.title?.trim() || `${summarizeWorkspace(thread.workspace_path)} 线程`

const buildLocalThreadSubtitle = (thread: ThreadRow): string => {
  const parts = [summarizeWorkspace(thread.workspace_path)]
  const startedAt = formatDateTime(thread.started_at || thread.created_at)
  if (startedAt !== '未设置') parts.push(startedAt)
  return parts.join(' · ')
}

const buildConversationSubtitle = (window: {
  primaryTransportId?: string | null
  updatedAt: string
}): string => {
  const parts: string[] = []
  if (window.primaryTransportId) parts.push(window.primaryTransportId)
  const updatedAt = formatDateTime(window.updatedAt)
  if (updatedAt !== '未设置') parts.push(updatedAt)
  return parts.join(' · ')
}

const loadTargetOptions = async (): Promise<void> => {
  const [threadRows, imWindows] = await Promise.all([
    window.api.coreV2.conversations.listLocalThreadRows(),
    window.api.coreV2.conversations.listWindows('im')
  ])

  const localOptions = await Promise.all(
    threadRows.map(async (thread) => {
      const resolved = await window.api.coreV2.conversations.getLocalByThread(thread.id)
      return {
        key: `local:${thread.id}`,
        kind: 'local_thread' as const,
        conversationId: resolved?.conversation.id ?? null,
        threadId: thread.id,
        label: buildLocalThreadLabel(thread),
        subtitle: buildLocalThreadSubtitle(thread)
      }
    })
  )

  const imOptions = imWindows.map((window) => ({
    key: `conversation:${window.conversationId}`,
    kind: 'conversation' as const,
    conversationId: window.conversationId,
    threadId: null,
    label: window.primaryExternalLabel?.trim() || 'IM 会话',
    subtitle: buildConversationSubtitle(window)
  }))

  targetOptions.value = [...localOptions, ...imOptions]
}

const resolveModelOption = (providerId: string, modelId: string): ModelOption | null =>
  allModelOptions.value.find((m) => m.providerId === providerId && m.modelId === modelId) ?? null

const selectedModelLabel = computed(() => {
  if (modalForm.modelProviderId && modalForm.modelId) {
    const option = resolveModelOption(modalForm.modelProviderId, modalForm.modelId)
    if (option) return option.label
    return `${modalForm.modelId} (${modalForm.modelProviderId})`
  }
  return '未设置（使用默认模型）'
})

const groupedFilteredModels = computed(() => {
  const q = modelSearchQuery.value.trim().toLowerCase()
  const filtered = allModelOptions.value.filter((m) => {
    if (!q) return true
    return (
      m.label.toLowerCase().includes(q) ||
      m.modelId.toLowerCase().includes(q) ||
      m.providerName.toLowerCase().includes(q)
    )
  })
  const groups = new Map<string, ModelOption[]>()
  for (const item of filtered) {
    const list = groups.get(item.providerName) ?? []
    list.push(item)
    groups.set(item.providerName, list)
  }
  return Array.from(groups.entries()).map(([providerName, items]) => ({
    providerName,
    items
  }))
})

const loadModelOptions = async () => {
  try {
    const providers = await window.api.providerConfig.listProviders()
    const options: ModelOption[] = []
    const details = await Promise.all(
      providers
        .filter((item) => item.enabled)
        .map((provider) => window.api.providerConfig.getProviderDetail(provider.id))
    )
    for (const p of details) {
      for (const m of p.models.filter((item) => item.enabled)) {
        options.push({
          key: `${p.id}::${m.modelId}`,
          providerId: p.id,
          providerName: p.displayName,
          modelId: m.modelId,
          label: m.label || m.modelId
        })
      }
    }
    allModelOptions.value = options
  } catch {
    allModelOptions.value = []
  }
}

const toggleModelMenu = async () => {
  if (allModelOptions.value.length === 0) {
    await loadModelOptions()
  }
  showModelMenu.value = !showModelMenu.value
  if (showModelMenu.value) {
    await nextTick()
    modelSearchRef.value?.focus()
  }
}

const closeModelMenu = () => {
  showModelMenu.value = false
  modelSearchQuery.value = ''
}

const selectModel = (option: ModelOption | null) => {
  modalForm.modelProviderId = option?.providerId ?? ''
  modalForm.modelId = option?.modelId ?? ''
  closeModelMenu()
}

const clearModelSelection = () => {
  modalForm.modelProviderId = ''
  modalForm.modelId = ''
  closeModelMenu()
}

const refreshTasks = async (
  preferredTaskId?: string | null,
  options: { silent?: boolean; skipTargets?: boolean } = {}
) => {
  if (!options.silent) loading.value = true
  try {
    if (!options.skipTargets) await loadTargetOptions()
    const previousSelection = preferredTaskId ?? selectedTaskId.value
    const nextTasks = await window.api.scheduledTasks.list({ includeDisabled: true })
    tasks.value = nextTasks

    const selected =
      (previousSelection && nextTasks.find((task) => task.id === previousSelection)?.id) ||
      nextTasks[0]?.id ||
      ''

    selectedTaskId.value = selected
    selectedTaskRuns.value = selected ? await window.api.scheduledTasks.listRuns(selected, 12) : []
  } finally {
    if (!options.silent) loading.value = false
  }
}

const refreshTaskList = async (): Promise<void> => {
  if (refreshIconTimer) clearTimeout(refreshIconTimer)
  refreshIconSpinning.value = true

  try {
    await refreshTasks()
  } finally {
    refreshIconTimer = setTimeout(() => {
      refreshIconSpinning.value = false
      refreshIconTimer = null
    }, 500)
  }
}

const getTargetOptionByKey = (targetKey: string): TaskTargetOption | null =>
  targetOptions.value.find((option) => option.key === targetKey) ?? null

const findTaskTargetOption = (task: ScheduledTask | null): TaskTargetOption | null => {
  if (!task) return null
  if (task.targetThreadId) {
    const local = targetOptions.value.find(
      (option) => option.threadId === task.targetThreadId && option.kind === 'local_thread'
    )
    if (local) return local
  }
  if (task.targetConversationId) {
    const conversation = targetOptions.value.find(
      (option) => option.conversationId === task.targetConversationId
    )
    if (conversation) return conversation
  }
  return null
}

const resolveTaskTargetKey = (task: ScheduledTask | null): string =>
  findTaskTargetOption(task)?.key ?? ''

const resolveTaskTargetLabel = (task: ScheduledTask | null): string => {
  if (!task) return '未设置'
  const option = findTaskTargetOption(task)
  if (option) return option.label
  if (task.executionMode === 'isolated_thread') {
    return task.workspacePath
      ? `独立线程 · ${summarizeWorkspace(task.workspacePath)}`
      : '独立线程（触发时新建）'
  }
  if (task.targetThreadId || task.targetConversationId) return '已绑定目标（内部解析）'
  return '未设置'
}

const resolveTaskTargetSubtitle = (task: ScheduledTask | null): string | null => {
  const option = findTaskTargetOption(task)
  if (option) return option.subtitle
  if (task?.executionMode === 'isolated_thread') {
    return task.workspacePath
      ? `工作目录：${summarizeWorkspace(task.workspacePath)}`
      : '触发时自动创建新线程'
  }
  return null
}

const resolveTaskDisplayStatus = (
  task: ScheduledTask | null
): ScheduledTaskStatus | ScheduledTaskRunStatus | null => {
  if (!task) return null
  return task.status === 'running' ? task.status : task.lastRunStatus
}

const shouldShowLastRunError = (task: ScheduledTask | null): boolean =>
  Boolean(task && task.status !== 'running' && task.lastRunStatus === 'failed' && task.lastErrorText)

const resolveModelLabel = (task: ScheduledTask | null): string => {
  if (!task) return '未设置'
  const override = (task as any).triggerExecutionOverride
  if (!override?.model?.providerId || !override?.model?.modelId) return '未设置（使用默认模型）'
  const option = resolveModelOption(override.model.providerId, override.model.modelId)
  if (option) return `${option.label}（${option.providerName}）`
  return `${override.model.modelId}（${override.model.providerId}）`
}

const openDetailModal = async (taskId: string) => {
  selectedTaskId.value = taskId
  showDetailModal.value = true
}

const openCreateModal = async () => {
  await loadTargetOptions()
  await loadModelOptions()
  modalMode.value = 'create'
  modalErrorMessage.value = ''
  applyModalForm(null)
  showTaskModal.value = true
}

const openEditModal = async (task: ScheduledTask) => {
  await loadTargetOptions()
  await loadModelOptions()
  showDetailModal.value = false
  modalMode.value = 'edit'
  modalErrorMessage.value = ''
  applyModalForm(task)
  showTaskModal.value = true
}

const closeTaskModal = () => {
  showTaskModal.value = false
  modalErrorMessage.value = ''
}

const closeDetailModal = () => {
  showDetailModal.value = false
}

const submitTaskModal = async (): Promise<void> => {
  if (!showTaskModal.value || modalSaving.value) return
  modalSaving.value = true
  modalErrorMessage.value = ''
  try {
    const payload = buildPayload()
    const validationInput =
      modalMode.value === 'create'
        ? payload
        : ({
            id: selectedTaskId.value,
            ...payload
          } as UpdateScheduledTaskInput)

    const validation = await window.api.scheduledTasks.validate(validationInput)
    if (!validation.ok) {
      throw new Error(validation.message)
    }

    const saved =
      modalMode.value === 'create'
        ? await window.api.scheduledTasks.create(payload)
        : await window.api.scheduledTasks.update({
            id: selectedTaskId.value,
            ...payload
          })

    showTaskModal.value = false
    showDetailModal.value = false
    showToast(
      modalMode.value === 'create' ? `已创建任务 ${saved.name}。` : `已保存任务 ${saved.name}。`,
      'success'
    )
    await refreshTasks(saved.id)
    syncModalSnapshot()
  } catch (error) {
    modalErrorMessage.value = error instanceof Error ? error.message : '保存任务失败。'
  } finally {
    modalSaving.value = false
  }
}

const saveSettings = async (): Promise<void> => {
  if (showTaskModal.value) {
    await submitTaskModal()
  }
}

const togglePaused = async (task: ScheduledTask) => {
  try {
    const updated = task.enabled
      ? await window.api.scheduledTasks.pause(task.id)
      : await window.api.scheduledTasks.resume(task.id)
    showToast(
      task.enabled ? `已暂停任务 ${updated.name}。` : `已恢复任务 ${updated.name}。`,
      'success'
    )
    await refreshTasks(updated.id)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '更新任务状态失败。', 'error')
  }
}

const runNow = async (taskId: string) => {
  try {
    const updated = await window.api.scheduledTasks.runNow(taskId)
    showToast(`任务 ${updated.name} 已安排立即运行。`, 'success')
    await refreshTasks(updated.id)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '立即运行失败。', 'error')
  }
}

const deleteTask = async (task: ScheduledTask) => {
  const confirmed = await globalDialog.confirm({
    title: '删除定时任务',
    message: `确定删除任务“${task.name}”吗？`,
    confirmText: '删除',
    cancelText: '取消',
    danger: true
  })
  if (!confirmed) return

  try {
    await window.api.scheduledTasks.delete(task.id)
    showDetailModal.value = false
    showToast(`已删除任务 ${task.name}。`, 'success')
    await refreshTasks()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除任务失败。', 'error')
  }
}

const statusLabel = (status: ScheduledTaskStatus | ScheduledTaskRunStatus | null | undefined) => {
  switch (status) {
    case 'scheduled':
      return '已计划'
    case 'paused':
      return '已暂停'
    case 'running':
      return '运行中'
    case 'completed':
      return '已完成'
    case 'disabled':
      return '已禁用'
    case 'deleted':
      return '已删除'
    case 'claimed':
      return '已认领'
    case 'queued':
      return '已入队'
    case 'succeeded':
      return '成功'
    case 'failed':
      return '失败'
    case 'skipped':
      return '已跳过'
    case 'cancelled':
      return '已取消'
    case 'timed_out':
      return '超时'
    default:
      return '未运行'
  }
}

const statusBadgeClass = (status: ScheduledTaskStatus | null | undefined) => {
  switch (status) {
    case 'running':
      return 'bg-blue-100 text-blue-700'
    case 'paused':
      return 'bg-amber-100 text-amber-700'
    case 'completed':
      return 'bg-emerald-100 text-emerald-700'
    case 'deleted':
      return 'bg-gray-100 text-gray-600'
    default:
      return 'bg-[#6f9aa4]/10 text-[#5f7c84]'
  }
}

const runBadgeClass = (status: ScheduledTaskRunStatus) => {
  switch (status) {
    case 'succeeded':
      return 'bg-emerald-100 text-emerald-700'
    case 'failed':
    case 'timed_out':
      return 'bg-rose-100 text-rose-700'
    case 'running':
    case 'queued':
    case 'claimed':
      return 'bg-blue-100 text-blue-700'
    case 'skipped':
    case 'cancelled':
      return 'bg-amber-100 text-amber-700'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

const extractShortError = (errorText: string | null | undefined): string => {
  if (!errorText) return ''
  const cleaned = errorText.replace(/\\n/g, ' ').trim()
  if (cleaned.length <= 120) return cleaned
  return cleaned.slice(0, 117) + '...'
}

const formatDateTime = (value: string | null) => {
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

defineExpose({
  saveSettings
})

const onGlobalPointerDown = (event: MouseEvent) => {
  if (!showModelMenu.value) return
  const t = event.target as Node | null
  if (!t) return
  const button = modelButtonRef.value
  const menu = modelMenuRef.value
  if (button?.contains(t) || menu?.contains(t)) return
  closeModelMenu()
}

const onGlobalKeyDown = (event: KeyboardEvent) => {
  if (!showModelMenu.value) return
  if (event.key === 'Escape') closeModelMenu()
}

onMounted(async () => {
  await refreshTasks()
  taskAutoRefreshTimer = setInterval(() => {
    void refreshTasks(selectedTaskId.value, { silent: true, skipTargets: true }).catch((error) => {
      console.error('Scheduled task auto-refresh failed', error)
    })
  }, 5_000)
  document.addEventListener('mousedown', onGlobalPointerDown, true)
  document.addEventListener('keydown', onGlobalKeyDown, true)
})
</script>
