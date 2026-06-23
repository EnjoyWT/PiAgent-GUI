<template>
  <div
    :class="
      mode === 'manager'
        ? 'h-screen w-full flex flex-col bg-(--theme-bg-main) text-(--theme-text-main)'
        : 'flex-1 overflow-y-auto pr-1 text-(--theme-text-main)'
    "
  >
    <div v-if="mode === 'settings'" class="space-y-5 pb-2">
      <section
        class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm"
      >
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="min-w-0 space-y-2">
            <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">
              Knowledge Memory
            </h3>
            <p class="max-w-220 text-xs leading-5 text-(--theme-text-dim)">
              L1 保留原始记录，L2 抽取概念，L3 沉淀模式，L4 维护实体记忆；抽取和注入自动执行。
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-3">
            <button
              type="button"
              class="rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 py-2 text-xs font-semibold text-(--theme-text-main) transition hover:bg-(--theme-bg-hover-btn)"
              @click="openKnowledgeManager"
            >
              打开记忆管理
            </button>
            <label
              class="inline-flex h-9 items-center gap-2 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 text-xs font-semibold text-(--theme-text-main) transition hover:bg-(--theme-bg-hover-btn)"
            >
              <span>{{ draft.enabled ? '已启用' : '已关闭' }}</span>
              <input v-model="draft.enabled" type="checkbox" class="sr-only" />
              <span
                class="relative h-5 w-9 rounded-full transition-colors"
                :class="draft.enabled ? 'bg-(--theme-accent)' : 'bg-(--theme-bg-content)'"
              >
                <span
                  class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                  :class="draft.enabled ? 'translate-x-4' : 'translate-x-0'"
                />
              </span>
            </label>
          </div>
        </div>
      </section>

      <section
        v-if="mode === 'settings'"
        class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm"
      >
        <div class="space-y-4">
          <div>
            <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">
              记忆模型
            </h3>
            <p class="mt-1 text-xs leading-5 text-(--theme-text-dim)">
              分别控制 L2 抽取、L3 归纳和 L4 Dream 使用的大模型。默认“跟随工具模型”。
            </p>
          </div>
          <div class="grid gap-4 md:grid-cols-3">
            <label v-for="item in llmModelSelectors" :key="item.key" class="space-y-2">
              <span class="text-sm font-semibold text-(--theme-text-main)">{{ item.title }}</span>
              <div class="knowledge-llm-select-area relative">
                <button
                  type="button"
                  class="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-4 transition hover:bg-(--theme-bg-hover-btn)"
                  @click="toggleLlmModelMenu(item.key)"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <Sparkles :size="16" class="shrink-0 text-(--theme-text-dim)" />
                    <span
                      class="truncate text-left text-[14px] font-semibold tracking-tight text-(--theme-text-main)"
                      >{{ llmModelLabel(draft[item.key]) }}</span
                    >
                  </div>
                  <ChevronDown :size="18" class="shrink-0 text-(--theme-text-dim)" />
                </button>
                <div
                  v-if="openLlmModelKey === item.key"
                  class="absolute left-0 right-0 z-30 mt-2 max-h-90 overflow-hidden rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) shadow-[0_18px_50px_rgba(0,0,0,0.3)]"
                >
                  <div
                    class="sticky top-0 z-10 border-b border-(--theme-border-base) bg-(--theme-bg-sidebar)/95 p-2 backdrop-blur"
                  >
                    <div class="relative">
                      <Search
                        :size="14"
                        class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)"
                      />
                      <input
                        v-model="llmModelSearch"
                        type="text"
                        placeholder="搜索模型..."
                        class="knowledge-select-search knowledge-filter-input--search"
                        @keydown.stop
                      />
                    </div>
                  </div>
                  <div class="max-h-78 overflow-y-auto">
                    <template v-for="group in groupedFilteredLlmModels" :key="group.providerName">
                      <div
                        class="flex items-center gap-2 border-y border-(--theme-border-base) bg-(--theme-bg-content) px-3 py-2 text-[13px] text-(--theme-text-dim)"
                      >
                        <img
                          v-if="getProviderIconUrl(group.providerName)"
                          :src="getProviderIconUrl(group.providerName)!"
                          :alt="`${group.providerName} icon`"
                          class="h-3 w-3"
                          draggable="false"
                        />
                        <span>{{ group.providerName }}</span>
                      </div>
                      <button
                        v-for="model in group.items"
                        :key="model.key || '__follow_tool__'"
                        type="button"
                        class="w-full border-b border-(--theme-border-base) px-8 py-2.5 text-left text-(--theme-text-main) last:border-b-0 hover:bg-(--theme-bg-hover-item)"
                        :class="
                          draft[item.key] === model.key
                            ? 'bg-(--theme-bg-active-item) text-(--theme-text-bright)!'
                            : ''
                        "
                        @pointerdown.prevent="selectLlmModel(item.key, model.key)"
                      >
                        <div class="flex items-center justify-between gap-3">
                          <div class="min-w-0">
                            <div class="truncate text-[13px] text-(--theme-text-main)">
                              {{ model.label }}
                            </div>
                          </div>
                          <Check
                            v-if="draft[item.key] === model.key"
                            :size="16"
                            class="shrink-0 text-emerald-600"
                          />
                        </div>
                      </button>
                    </template>
                    <div
                      v-if="groupedFilteredLlmModels.length === 0"
                      class="px-3 py-6 text-center text-[12px] text-(--theme-text-dim)"
                    >
                      没有匹配模型
                    </div>
                  </div>
                </div>
              </div>
              <p class="text-[11px] leading-4 text-(--theme-text-dim)">{{ item.desc }}</p>
            </label>
          </div>
        </div>
      </section>

      <section
        v-if="mode === 'settings'"
        class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm"
      >
        <div class="space-y-4">
          <div>
            <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">
              Embedding 与注入预算
            </h3>
            <p class="mt-1 text-xs leading-5 text-(--theme-text-dim)">
              默认使用本地 BGE-small-zh-v1.5。模型未下载时，系统会自动降级到 FTS 检索，不阻断对话。
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <label class="space-y-2">
              <span class="text-sm font-semibold text-(--theme-text-main)">Embedding 模型</span>
              <div class="relative">
                <button
                  ref="modelButtonRef"
                  type="button"
                  class="knowledge-select-trigger"
                  @click="toggleModelMenu"
                >
                  <span class="min-w-0 truncate text-left">
                    {{
                      selectedModel
                        ? `${selectedModel.label} · ${selectedModel.downloaded ? '已下载' : '未下载'}`
                        : '选择模型…'
                    }}
                  </span>
                  <ChevronDown :size="17" class="shrink-0 text-(--theme-text-dim)" />
                </button>

                <div v-if="showModelMenu" ref="modelMenuRef" class="knowledge-select-menu">
                  <div
                    class="border-b border-(--theme-border-base) bg-(--theme-bg-sidebar)/95 p-2 backdrop-blur"
                  >
                    <div class="relative">
                      <Search
                        :size="14"
                        class="absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)"
                      />
                      <input
                        v-model="modelSearch"
                        type="text"
                        placeholder="搜索 embedding 模型…"
                        class="knowledge-select-search"
                        @keydown.stop
                      />
                    </div>
                  </div>
                  <div class="max-h-64 overflow-y-auto py-1">
                    <button
                      v-for="model in filteredModels"
                      :key="model.key"
                      type="button"
                      class="knowledge-select-option"
                      :class="draft.embeddingModel === model.key ? 'is-active' : ''"
                      @pointerdown.prevent="selectModel(model.key)"
                    >
                      <div class="min-w-0">
                        <div class="truncate text-[13px] font-semibold text-(--theme-text-main)">
                          {{ model.label }}
                        </div>
                        <div class="mt-0.5 truncate text-[11px] text-(--theme-text-dim)">
                          {{ model.key }}
                        </div>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        <span
                          class="rounded-full px-2 py-0.5 text-[11px]"
                          :class="
                            model.downloaded
                              ? 'bg-(--theme-bg-active-item) text-(--theme-accent)'
                              : 'bg-(--theme-bg-content) text-(--theme-text-dim)'
                          "
                        >
                          {{ model.downloaded ? '已下载' : '未下载' }}
                        </span>
                        <Check
                          v-if="draft.embeddingModel === model.key"
                          :size="15"
                          class="text-(--theme-accent)"
                        />
                      </div>
                    </button>
                    <div
                      v-if="filteredModels.length === 0"
                      class="px-3 py-6 text-center text-xs text-(--theme-text-dim)"
                    >
                      没有匹配模型
                    </div>
                  </div>
                </div>
              </div>
            </label>

            <label class="space-y-2">
              <span class="text-sm font-semibold text-(--theme-text-main)"
                >注入预算：{{ draft.injectionTokenBudget }} tokens</span
              >
              <input
                v-model.number="draft.injectionTokenBudget"
                type="range"
                min="1000"
                max="16000"
                step="500"
                class="knowledge-range"
                :style="{ '--range-progress': `${injectionBudgetPercent}%` }"
              />
              <div class="flex justify-between text-[11px] text-(--theme-text-dim)">
                <span>1K</span><span>默认 8K</span><span>16K</span>
              </div>
            </label>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 py-2 text-xs font-semibold text-(--theme-text-main) transition hover:bg-(--theme-bg-hover-btn)"
              :disabled="downloading || !selectedModel || selectedModel.downloaded"
              @click="downloadSelected"
            >
              {{
                downloading ? '下载中…' : selectedModel?.downloaded ? '模型已下载' : '下载当前模型'
              }}
            </button>
            <button
              type="button"
              class="rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 py-2 text-xs font-semibold text-(--theme-text-main) transition hover:bg-(--theme-bg-hover-btn)"
              :disabled="!selectedModel?.cacheDir"
              @click="openCacheDir"
            >
              打开缓存目录
            </button>
          </div>

          <div v-if="downloadText" class="text-xs text-(--theme-text-dim)">{{ downloadText }}</div>
        </div>
      </section>
    </div>

    <template v-else>
      <header
        class="relative h-12 shrink-0 border-b-[0.5px] border-(--theme-border-header) bg-(--theme-bg-header) flex items-center drag-region"
      >
        <div
          class="absolute left-2.5 top-2.5 -bottom-px bg-(--theme-bg-sidebar) border-t border-x border-(--theme-border-sidebar) [box-shadow:var(--theme-shadow-sidebar)] backdrop-blur pointer-events-none rounded-t-xl"
          style="width: 220px"
        ></div>
        <div class="relative flex h-full items-center" style="width: 212px">
          <div class="w-18 shrink-0 h-full flex items-center"></div>
        </div>
        <div class="flex-1 text-left pl-8 font-medium tracking-tight">
          <div class="flex items-center text-[16px] text-(--theme-text-bright)">
            <component
              :is="activeManagerNav.icon"
              :size="18"
              class="mr-2 text-(--theme-text-dim)"
            />
            <span>{{ activeManagerNav.label }}</span>
          </div>
        </div>
        <button
          type="button"
          class="no-drag mr-6 rounded-lg px-3 py-1.5 text-xs font-medium text-(--theme-text-dim) transition-colors hover:bg-(--theme-bg-hover-btn) hover:text-(--theme-text-main)"
          @click="emit('close')"
        >
          关闭
        </button>
      </header>

      <div class="flex flex-1 overflow-y-hidden overflow-x-visible">
        <aside
          class="ml-2.5 mb-2.5 bg-(--theme-bg-sidebar) border-x border-b border-(--theme-border-sidebar) [box-shadow:var(--theme-shadow-sidebar)] flex flex-col relative z-20 shrink-0 overflow-visible rounded-b-xl"
          style="width: 220px"
        >
          <div class="flex-1 overflow-y-auto px-2 space-y-1 pt-2">
            <button
              v-for="item in managerSections"
              :key="item.id"
              type="button"
              class="flex w-full items-center px-3 py-2 rounded-lg text-sm mb-0.5 cursor-pointer transition-colors border border-transparent"
              :class="
                activeManagerSection === item.id
                  ? 'bg-(--theme-bg-active-item) [box-shadow:var(--theme-shadow-active-item)] border-(--theme-border-active-item) text-(--theme-text-bright) font-medium'
                  : 'text-(--theme-text-main) hover:bg-(--theme-bg-hover-item)'
              "
              @click="activeManagerSection = item.id"
            >
              <component
                :is="item.icon"
                :size="16"
                class="mr-3"
                :class="
                  activeManagerSection === item.id
                    ? 'text-(--theme-text-bright)'
                    : 'text-(--theme-text-dim)'
                "
              />
              <span class="min-w-0 flex-1 truncate text-left">{{ item.label }}</span>
              <span
                v-if="item.count !== null"
                class="ml-2 rounded-full bg-(--theme-bg-content) px-2 py-0.5 text-[11px] text-(--theme-text-dim)"
                >{{ item.count }}</span
              >
            </button>
          </div>
        </aside>

        <div class="flex-1 min-w-0 flex flex-col bg-(--theme-bg-main)">
          <div class="flex-1 min-w-0 overflow-hidden flex p-3 bg-(--theme-bg-content)">
            <main class="flex-1 overflow-y-auto pr-1">
              <section
                v-if="activeManagerSection === 'stats'"
                class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm"
              >
                <div class="space-y-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">
                        知识库统计
                      </h3>
                      <p class="mt-1 text-xs leading-5 text-(--theme-text-dim)">
                        总览当前 Knowledge Memory 的实体、L2、L3、L4、关系和向量数量。
                      </p>
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        class="flex h-9 w-9 items-center justify-center rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) text-(--theme-text-main) transition-colors hover:bg-(--theme-bg-hover-btn) disabled:cursor-not-allowed disabled:bg-(--theme-bg-content) disabled:text-(--theme-text-dim)"
                        :disabled="loading"
                        :title="
                          lastRefreshedAt
                            ? `刷新 · ${new Date(lastRefreshedAt).toLocaleString()}`
                            : '刷新'
                        "
                        @click="refreshKnowledgeList"
                      >
                        <RefreshCw
                          :size="15"
                          :class="refreshIconSpinning || loading ? 'animate-spin' : ''"
                        />
                      </button>
                      <button
                        type="button"
                        class="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-70"
                        :class="
                          dreamRunning
                            ? 'border-(--theme-accent)/40 bg-(--theme-bg-active-item) text-(--theme-accent)'
                            : 'border-(--theme-border-base) bg-(--theme-bg-sidebar) text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)'
                        "
                        :disabled="dreamRunning || loading"
                        @click="runDream"
                      >
                        <span
                          v-if="dreamRunning"
                          class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                        />
                        {{ dreamRunning ? 'Dream 整理中…' : '立即 Dream 整理' }}
                      </button>
                    </div>
                  </div>
                  <div class="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <div
                      v-for="card in statCards"
                      :key="card.label"
                      class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) p-3"
                    >
                      <div class="text-[11px] text-(--theme-text-dim)">{{ card.label }}</div>
                      <div class="mt-1 text-lg font-bold text-(--theme-text-bright)">
                        {{ card.value }}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section
                v-else-if="activeManagerSection === 'pending'"
                class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm"
              >
                <div class="space-y-4">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">
                        待沉淀
                      </h3>
                      <p class="mt-1 text-xs leading-5 text-(--theme-text-dim)">
                        这些对话已经进入 active memory task，但还没有 finalize 成 L2。
                      </p>
                    </div>
                    <span
                      class="rounded-full border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 py-1.5 text-[11px] font-semibold text-(--theme-text-dim)"
                    >
                      {{ activeTasks.length }} 条
                    </span>
                  </div>

                  <div
                    v-if="activeTasks.length === 0"
                    class="rounded-lg border border-dashed border-(--theme-border-base) bg-(--theme-bg-sidebar) px-4 py-5 text-sm text-(--theme-text-dim)"
                  >
                    当前没有待沉淀记忆。
                  </div>

                  <div v-else class="space-y-3">
                    <div
                      v-for="task in activeTasks"
                      :key="task.id"
                      class="rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) p-4"
                    >
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <span
                              class="rounded-full bg-(--theme-bg-content) px-2 py-1 text-[11px] font-semibold text-(--theme-text-dim)"
                              >run {{ task.runCount }}</span
                            >
                            <span
                              class="rounded-full bg-(--theme-bg-content) px-2 py-1 text-[11px] text-(--theme-text-dim)"
                              >{{ formatDateTime(task.updatedAt) }}</span
                            >
                          </div>
                          <div
                            v-if="task.lastUserText"
                            class="mt-2 text-sm font-medium text-(--theme-text-bright)"
                          >
                            {{ task.lastUserText }}
                          </div>
                          <div v-else class="mt-2 text-sm font-medium text-red-500">
                            未关联到用户输入
                          </div>
                          <div class="mt-2 text-[11px] text-(--theme-text-dim)">
                            thread: {{ task.threadId || '—' }} · task: {{ task.id }}
                          </div>
                        </div>
                        <div class="flex items-center gap-2">
                          <button
                            type="button"
                            class="inline-flex items-center gap-2 rounded-lg border border-(--theme-accent)/30 bg-(--theme-bg-active-item) px-3 py-2 text-xs font-semibold text-(--theme-accent) transition hover:brightness-105"
                            @click="finalizeActiveTask(task.id)"
                          >
                            立即整理为 L2
                          </button>
                          <button
                            type="button"
                            class="inline-flex items-center gap-2 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-main) px-3 py-2 text-xs font-semibold text-(--theme-text-main) transition hover:bg-(--theme-bg-hover-btn)"
                            @click="discardActiveTask(task.id)"
                          >
                            丢弃
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section
                v-else-if="activeManagerSection === 'l2'"
                class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm"
              >
                <div class="space-y-4">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">
                        L2 概念
                      </h3>
                      <p class="mt-1 text-xs leading-5 text-(--theme-text-dim)">
                        全局 L2 active 数据，支持关键词、日期范围和服务端分页查询。
                      </p>
                    </div>
                    <span
                      class="rounded-full border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 py-1.5 text-[11px] font-semibold text-(--theme-text-dim)"
                    >
                      {{ allClaimsTotal }} 条
                    </span>
                  </div>

                  <div class="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px_160px_auto]">
                    <div class="relative">
                      <Search
                        :size="14"
                        class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)"
                      />
                      <input
                        v-model="l2Query"
                        type="text"
                        placeholder="搜索 L2 内容、类型或实体…"
                        class="knowledge-filter-input knowledge-filter-input--search"
                        @keydown.enter="resetClaimsPage"
                        @keydown.stop
                      />
                    </div>
                    <input
                      v-model="l2From"
                      type="date"
                      class="knowledge-filter-input"
                      @change="resetClaimsPage"
                    />
                    <input
                      v-model="l2To"
                      type="date"
                      class="knowledge-filter-input"
                      @change="resetClaimsPage"
                    />
                    <button type="button" class="knowledge-filter-button" @click="resetClaimsPage">
                      查询
                    </button>
                  </div>

                  <div class="space-y-2">
                    <article
                      v-for="claim in allClaims"
                      :key="claim.claimId"
                      class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) p-3"
                    >
                      <div class="flex flex-wrap items-start justify-between gap-2">
                        <div class="min-w-0 flex-1 text-xs leading-5 text-(--theme-text-main)">
                          {{ claim.text }}
                        </div>
                        <div class="flex shrink-0 gap-1">
                          <button
                            class="rounded-md border border-(--theme-border-base) bg-(--theme-bg-main) px-2 py-1 text-[11px] text-(--theme-text-dim) hover:bg-(--theme-bg-hover-btn)"
                            @click="traceClaim(claim.claimId)"
                          >
                            溯源
                          </button>
                          <button
                            class="rounded-md border border-rose-500/15 px-2 py-1 text-[11px] text-rose-500 hover:bg-rose-500/10"
                            @click="deleteClaim(claim.claimId)"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-(--theme-text-dim)">
                        <span>{{ claim.entityName || '未关联实体' }}</span>
                        <span>·</span>
                        <span>{{ claim.kind }}</span>
                        <span>·</span>
                        <span>{{ formatDateTime(claim.updatedAt) }}</span>
                      </div>
                    </article>
                    <div v-if="allClaims.length === 0" class="knowledge-empty-state">
                      暂无 L2 概念
                    </div>
                  </div>

                  <div
                    class="flex items-center justify-between border-t border-(--theme-border-base) pt-3 text-xs text-(--theme-text-dim)"
                  >
                    <span>第 {{ l2Page }} / {{ l2TotalPages }} 页</span>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="knowledge-filter-button"
                        :disabled="l2Page <= 1"
                        @click="goClaimsPage(l2Page - 1)"
                      >
                        上一页
                      </button>
                      <button
                        type="button"
                        class="knowledge-filter-button"
                        :disabled="l2Page >= l2TotalPages"
                        @click="goClaimsPage(l2Page + 1)"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <section
                v-else-if="activeManagerSection === 'l3'"
                class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm"
              >
                <div class="space-y-4">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">
                        L3 沉淀
                      </h3>
                      <p class="mt-1 text-xs leading-5 text-(--theme-text-dim)">
                        全局 L3 pattern 数据，支持关键词、日期范围和服务端分页查询。
                      </p>
                    </div>
                    <span
                      class="rounded-full border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 py-1.5 text-[11px] font-semibold text-(--theme-text-dim)"
                      >{{ allPatternsTotal }} 条</span
                    >
                  </div>

                  <div class="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px_160px_auto]">
                    <div class="relative">
                      <Search
                        :size="14"
                        class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)"
                      />
                      <input
                        v-model="l3Query"
                        type="text"
                        placeholder="搜索 L3 标题或内容…"
                        class="knowledge-filter-input knowledge-filter-input--search"
                        @keydown.enter="resetPatternsPage"
                        @keydown.stop
                      />
                    </div>
                    <input
                      v-model="l3From"
                      type="date"
                      class="knowledge-filter-input"
                      @change="resetPatternsPage"
                    />
                    <input
                      v-model="l3To"
                      type="date"
                      class="knowledge-filter-input"
                      @change="resetPatternsPage"
                    />
                    <button
                      type="button"
                      class="knowledge-filter-button"
                      @click="resetPatternsPage"
                    >
                      查询
                    </button>
                  </div>

                  <div class="space-y-2">
                    <article
                      v-for="pattern in allPatterns"
                      :key="pattern.id"
                      class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) p-3"
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div class="text-xs font-semibold text-(--theme-text-bright)">
                          {{ pattern.title }}
                        </div>
                        <button
                          class="rounded-md border border-rose-500/15 px-2 py-1 text-[11px] text-rose-500 hover:bg-rose-500/10"
                          @click="deleteReflection(pattern.id, 'L3 沉淀')"
                        >
                          删除
                        </button>
                      </div>
                      <div class="mt-1 text-xs leading-5 text-(--theme-text-main)">
                        {{ pattern.body }}
                      </div>
                      <div class="mt-2 text-[11px] text-(--theme-text-dim)">
                        {{ formatDateTime(pattern.updatedAt) }}
                      </div>
                    </article>
                    <div v-if="allPatterns.length === 0" class="knowledge-empty-state">
                      暂无 L3 沉淀
                    </div>
                  </div>

                  <div
                    class="flex items-center justify-between border-t border-(--theme-border-base) pt-3 text-xs text-(--theme-text-dim)"
                  >
                    <span>第 {{ l3Page }} / {{ l3TotalPages }} 页</span>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="knowledge-filter-button"
                        :disabled="l3Page <= 1"
                        @click="goPatternsPage(l3Page - 1)"
                      >
                        上一页
                      </button>
                      <button
                        type="button"
                        class="knowledge-filter-button"
                        :disabled="l3Page >= l3TotalPages"
                        @click="goPatternsPage(l3Page + 1)"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <section
                v-else
                class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-main) p-5 shadow-sm"
              >
                <div class="space-y-4">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 class="text-[15px] font-bold tracking-tight text-(--theme-text-bright)">
                        L4 实体记忆
                      </h3>
                      <p class="mt-1 text-xs leading-5 text-(--theme-text-dim)">
                        实体目录和 L4 画像合并展示；通过搜索过滤，不再把所有实体平铺出来。
                      </p>
                    </div>
                    <span
                      class="rounded-full border border-(--theme-border-base) bg-(--theme-bg-sidebar) px-3 py-1.5 text-[11px] font-semibold text-(--theme-text-dim)"
                      >{{ allProfilesTotal }} 条</span
                    >
                  </div>

                  <div class="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div class="relative">
                      <Search
                        :size="14"
                        class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)"
                      />
                      <input
                        v-model="l4Query"
                        type="text"
                        placeholder="搜索实体、标题或画像内容…"
                        class="knowledge-filter-input knowledge-filter-input--search"
                        @keydown.enter="resetProfilesPage"
                        @keydown.stop
                      />
                    </div>
                    <button
                      type="button"
                      class="knowledge-filter-button"
                      @click="resetProfilesPage"
                    >
                      查询
                    </button>
                  </div>

                  <div class="space-y-3">
                    <article
                      v-for="profile in allProfiles"
                      :key="profile.id"
                      class="rounded-xl border border-(--theme-border-base) bg-(--theme-bg-sidebar) p-3"
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                          <div class="truncate text-xs font-semibold text-(--theme-text-bright)">
                            {{ profile.title }}
                          </div>
                          <div class="mt-1 text-[11px] text-(--theme-text-dim)">
                            {{ formatDateTime(profile.updatedAt) }}
                          </div>
                        </div>
                        <div class="flex shrink-0 items-center gap-2">
                          <button
                            class="rounded-md border border-(--theme-border-base) px-2 py-1 text-[11px] text-(--theme-text-main) hover:bg-(--theme-bg-hover-btn)"
                            @click="openProfileDetail(profile)"
                          >
                            详情
                          </button>
                          <button
                            class="rounded-md border border-rose-500/15 px-2 py-1 text-[11px] text-rose-500 hover:bg-rose-500/10"
                            @click="deleteReflection(profile.id, 'L4 实体记忆')"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <p class="mt-2 min-h-10 text-xs leading-5 text-(--theme-text-main)">
                        {{ profilePreview(profile.body) }}
                      </p>
                    </article>
                    <div v-if="allProfiles.length === 0" class="knowledge-empty-state">
                      暂无 L4 实体记忆
                    </div>
                  </div>

                  <div
                    class="flex items-center justify-between border-t border-(--theme-border-base) pt-3 text-xs text-(--theme-text-dim)"
                  >
                    <span>第 {{ l4Page }} / {{ l4TotalPages }} 页</span>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="knowledge-filter-button"
                        :disabled="l4Page <= 1"
                        @click="goProfilesPage(l4Page - 1)"
                      >
                        上一页
                      </button>
                      <button
                        type="button"
                        class="knowledge-filter-button"
                        :disabled="l4Page >= l4TotalPages"
                        @click="goProfilesPage(l4Page + 1)"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </main>
          </div>
        </div>
      </div>
    </template>

    <div
      v-if="mode === 'settings' && statusText"
      class="rounded-xl px-4 py-3 text-sm"
      :class="
        statusTone === 'bad' ? 'bg-rose-500/10 text-rose-500' : 'bg-[#00ba88]/10 text-[#00ba88]'
      "
    >
      {{ statusText }}
    </div>

    <Teleport to="body">
      <Transition name="knowledge-dialog-fade">
        <div
          v-if="dreamDialogOpen"
          class="knowledge-dialog-overlay"
          @click.self="dreamDialogOpen = false"
        >
          <div
            class="knowledge-dialog-card"
            role="dialog"
            aria-modal="true"
            :aria-label="dreamDialogTitle"
          >
            <div class="mb-3 flex items-start justify-between gap-4">
              <div>
                <h3 class="text-base font-bold text-(--theme-text-bright)">
                  {{ dreamDialogTitle }}
                </h3>
                <p
                  class="mt-2 text-sm leading-6"
                  :class="dreamDialogTone === 'bad' ? 'text-rose-500' : 'text-(--theme-text-main)'"
                >
                  {{ dreamDialogMessage }}
                </p>
              </div>
              <button
                type="button"
                class="rounded-lg px-2 py-1 text-lg text-(--theme-text-dim) hover:bg-(--theme-bg-hover-btn)"
                @click="dreamDialogOpen = false"
              >
                ×
              </button>
            </div>
            <pre
              v-if="dreamDialogDetail"
              class="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-(--theme-border-base) bg-(--theme-bg-content) p-3 text-xs leading-5 text-(--theme-text-dim)"
              >{{ dreamDialogDetail }}</pre
            >
            <div class="mt-4 flex justify-end">
              <button
                type="button"
                class="rounded-lg bg-(--theme-accent) px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
                @click="dreamDialogOpen = false"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="knowledge-dialog-fade">
        <div
          v-if="traceDialogOpen"
          class="knowledge-dialog-overlay"
          @click.self="traceDialogOpen = false"
        >
          <div
            class="knowledge-dialog-card knowledge-trace-dialog-card"
            role="dialog"
            aria-modal="true"
            aria-label="L2 概念溯源"
          >
            <div class="mb-3 flex items-start justify-between gap-4">
              <div class="min-w-0">
                <h3 class="text-base font-bold text-(--theme-text-bright)">L2 概念溯源</h3>
                <p
                  v-if="traceClaimText"
                  class="mt-2 line-clamp-3 text-sm leading-6 text-(--theme-text-main)"
                >
                  {{ traceClaimText }}
                </p>
              </div>
              <button
                type="button"
                class="rounded-lg px-2 py-1 text-lg text-(--theme-text-dim) hover:bg-(--theme-bg-hover-btn)"
                @click="traceDialogOpen = false"
              >
                ×
              </button>
            </div>
            <pre
              class="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-(--theme-border-base) bg-(--theme-bg-content) p-3 text-xs leading-5 text-(--theme-text-dim)"
              >{{ traceText }}</pre
            >
            <div class="mt-4 flex justify-end">
              <button
                type="button"
                class="rounded-lg bg-(--theme-accent) px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
                @click="traceDialogOpen = false"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <BaseDialog
      :open="profileDetailOpen && Boolean(selectedProfile)"
      aria-label="L4 实体记忆详情"
      @close="closeProfileDetail"
    >
      <template v-if="selectedProfile" #header>
        <h3 class="text-base font-bold text-(--theme-text-bright)">
          {{ selectedProfile.title }}
        </h3>
        <p class="mt-2 text-xs text-(--theme-text-dim)">
          {{ formatDateTime(selectedProfile.updatedAt) }}
        </p>
      </template>

      <pre
        class="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-(--theme-border-base) bg-(--theme-bg-content) p-3 text-xs leading-5 text-(--theme-text-main)"
        >{{ selectedProfile?.body ?? '' }}</pre
      >

      <template #footer>
        <button
          type="button"
          class="rounded-lg bg-(--theme-accent) px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
          @click="closeProfileDetail"
        >
          关闭
        </button>
      </template>
    </BaseDialog>
  </div>
</template>

<script setup lang="ts">
import {
  BarChart3,
  Brain,
  Check,
  ChevronDown,
  Layers3,
  RefreshCw,
  Search,
  Sparkles
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import BaseDialog from '@renderer/components/common/BaseDialog.vue'
import { getProviderIconUrl } from '@renderer/utils/providerIcons'
import { buildKnowledgeProfilePreview } from './knowledge-profile-preview'

const props = withDefaults(defineProps<{ mode?: 'settings' | 'manager' }>(), { mode: 'settings' })
const mode = computed(() => props.mode)
const emit = defineEmits<{
  (event: 'dirty-change', dirty: boolean): void
  (event: 'close'): void
}>()

type Settings = Awaited<ReturnType<typeof window.api.knowledge.getSettings>>
type Model = Awaited<ReturnType<typeof window.api.knowledge.embeddingModels.list>>[number]
type Stats = Awaited<ReturnType<typeof window.api.knowledge.stats>>
type LlmModelOption = { key: string; providerName: string; label: string; modelId?: string }

const loading = ref(false)
const downloading = ref(false)
const dreamRunning = ref(false)
const refreshIconSpinning = ref(false)
const lastRefreshedAt = ref<number | null>(null)
const dreamDialogOpen = ref(false)
const dreamDialogTone = ref<'good' | 'bad'>('good')
const dreamDialogTitle = ref('')
const dreamDialogMessage = ref('')
const dreamDialogDetail = ref('')
const downloadText = ref('')
const statusText = ref('')
const statusTone = ref<'good' | 'bad'>('good')
const models = ref<Model[]>([])
const llmModels = ref<LlmModelOption[]>([{ key: '', providerName: '默认', label: '跟随工具模型' }])
const openLlmModelKey = ref<'extractionModel' | 'consolidationModel' | 'dreamModel' | null>(null)
const llmModelSearch = ref('')
const showModelMenu = ref(false)
const modelSearch = ref('')
const modelButtonRef = ref<HTMLElement | null>(null)
const modelMenuRef = ref<HTMLElement | null>(null)
const stats = ref<Stats>({
  entities: 0,
  activeClaims: 0,
  activeTasks: 0,
  taskRuns: 0,
  patterns: 0,
  profiles: 0,
  relations: 0,
  vectors: 0
})
type ActiveTask = Awaited<ReturnType<typeof window.api.knowledge.listActiveTasks>>[number]
const activeTasks = ref<ActiveTask[]>([])
type PagedClaims = Awaited<ReturnType<typeof window.api.knowledge.listAllClaims>>
type PagedReflections = Awaited<ReturnType<typeof window.api.knowledge.listAllPatterns>>
type ReflectionItem = PagedReflections['items'][number]

const allClaims = ref<PagedClaims['items']>([])
const allPatterns = ref<PagedReflections['items']>([])
const allProfiles = ref<PagedReflections['items']>([])
const selectedProfile = ref<ReflectionItem | null>(null)
const allClaimsTotal = ref(0)
const allPatternsTotal = ref(0)
const allProfilesTotal = ref(0)
const pageSize = 20
const l2Page = ref(1)
const l3Page = ref(1)
const l4Page = ref(1)
const l2Query = ref('')
const l3Query = ref('')
const l4Query = ref('')
const l2From = ref('')
const l2To = ref('')
const l3From = ref('')
const l3To = ref('')
const activeManagerSection = ref<'stats' | 'pending' | 'l2' | 'l3' | 'l4'>('stats')
const traceDialogOpen = ref(false)
const traceClaimText = ref('')
const traceText = ref('')
const profileDetailOpen = ref(false)
const saved = ref<Settings | null>(null)
const draft = reactive<Settings>({
  enabled: true,
  autoExtractEnabled: true,
  autoInjectEnabled: true,
  embeddingModel: 'BAAI/bge-small-zh-v1.5',
  injectionTokenBudget: 8000,
  extractionModel: '',
  consolidationModel: '',
  dreamModel: ''
})

let offProgress: (() => void) | null = null
let refreshedTimer: number | null = null

const llmModelSelectors = [
  {
    key: 'extractionModel' as const,
    title: 'L2 抽取模型',
    desc: '每个 run 的概念、偏好、决策抽取。'
  },
  { key: 'consolidationModel' as const, title: 'L3 归纳模型', desc: '跨多条 L2 形成稳定模式。' },
  { key: 'dreamModel' as const, title: 'L4 Dream 模型', desc: '整理实体长期记忆和画像。' }
]

const selectedModel = computed(
  () => models.value.find((m) => m.key === draft.embeddingModel) ?? null
)
const filteredModels = computed(() => {
  const query = modelSearch.value.trim().toLowerCase()
  if (!query) return models.value
  return models.value.filter((model) => `${model.label} ${model.key}`.toLowerCase().includes(query))
})
const filteredLlmModels = computed(() => {
  const query = llmModelSearch.value.trim().toLowerCase()
  if (!query) return llmModels.value
  return llmModels.value.filter((model) =>
    `${model.label} ${model.providerName} ${model.modelId || ''}`.toLowerCase().includes(query)
  )
})
const groupedFilteredLlmModels = computed(() => {
  const groups = new Map<string, LlmModelOption[]>()
  for (const model of filteredLlmModels.value) {
    const items = groups.get(model.providerName) ?? []
    items.push(model)
    groups.set(model.providerName, items)
  }
  return Array.from(groups.entries()).map(([providerName, items]) => ({ providerName, items }))
})
const injectionBudgetPercent = computed(() => {
  const min = 1000
  const max = 16000
  const value = Math.min(max, Math.max(min, Number(draft.injectionTokenBudget) || min))
  return ((value - min) / (max - min)) * 100
})

const statCards = computed(() => [
  { label: 'Entities', value: stats.value.entities },
  { label: 'L2 概念', value: stats.value.activeClaims },
  { label: 'L3 沉淀', value: stats.value.patterns },
  { label: 'L4 实体记忆', value: stats.value.profiles },
  { label: 'Relations', value: stats.value.relations },
  { label: 'Vectors', value: stats.value.vectors }
])

const managerSections = computed(() => [
  { id: 'stats' as const, label: '统计', icon: BarChart3, count: null },
  { id: 'pending' as const, label: '待沉淀', icon: Layers3, count: activeTasks.value.length },
  { id: 'l2' as const, label: 'L2 概念', icon: Brain, count: allClaimsTotal.value },
  { id: 'l3' as const, label: 'L3 沉淀', icon: Layers3, count: allPatternsTotal.value },
  { id: 'l4' as const, label: 'L4 实体记忆', icon: Sparkles, count: allProfilesTotal.value }
])
const activeManagerNav = computed(
  () =>
    managerSections.value.find((item) => item.id === activeManagerSection.value) ??
    managerSections.value[0]
)
const l2TotalPages = computed(() => Math.max(1, Math.ceil(allClaimsTotal.value / pageSize)))
const l3TotalPages = computed(() => Math.max(1, Math.ceil(allPatternsTotal.value / pageSize)))
const l4TotalPages = computed(() => Math.max(1, Math.ceil(allProfilesTotal.value / pageSize)))

const dateStart = (value: string): string | undefined =>
  value ? new Date(`${value}T00:00:00.000`).toISOString() : undefined
const dateEnd = (value: string): string | undefined =>
  value ? new Date(`${value}T23:59:59.999`).toISOString() : undefined
const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '未知时间'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}
const profilePreview = (body: string | null | undefined): string =>
  buildKnowledgeProfilePreview(body)
const openProfileDetail = (profile: ReflectionItem): void => {
  selectedProfile.value = profile
  profileDetailOpen.value = true
}
const closeProfileDetail = (): void => {
  profileDetailOpen.value = false
  selectedProfile.value = null
}

const isDirty = computed(() => {
  if (!saved.value) return false
  return JSON.stringify(saved.value) !== JSON.stringify({ ...draft })
})
watch(isDirty, (dirty) => emit('dirty-change', dirty), { immediate: true })

const normalizeKnowledgeSettings = (settings: Settings): Settings => ({
  ...settings,
  autoExtractEnabled: true,
  autoInjectEnabled: true
})

const applySettings = (settings: Settings): void => {
  const normalized = normalizeKnowledgeSettings(settings)
  Object.assign(draft, normalized)
  saved.value = { ...normalized }
  emit('dirty-change', false)
}

const loadLlmModels = async (): Promise<void> => {
  const options: LlmModelOption[] = [{ key: '', providerName: '默认', label: '跟随工具模型' }]
  try {
    const providers = await window.api.providerConfig.listProviders()
    const details = await Promise.all(
      providers
        .filter((item) => item.enabled)
        .map((provider) => window.api.providerConfig.getProviderDetail(provider.id))
    )
    for (const provider of details) {
      for (const model of provider.models.filter((item) => item.enabled)) {
        options.push({
          key: `${provider.id}::${model.modelId}`,
          providerName: provider.displayName,
          modelId: model.modelId,
          label: model.label || model.modelId
        })
      }
    }
  } catch {
    // Provider list is best-effort for settings UI.
  }
  llmModels.value = options
}

const loadClaimsPage = async (): Promise<void> => {
  const result = await window.api.knowledge.listAllClaims({
    limit: pageSize,
    offset: (l2Page.value - 1) * pageSize,
    from: dateStart(l2From.value),
    to: dateEnd(l2To.value),
    query: l2Query.value.trim() || undefined
  })
  allClaims.value = result.items
  allClaimsTotal.value = result.total
}

const loadPatternsPage = async (): Promise<void> => {
  const result = await window.api.knowledge.listAllPatterns({
    limit: pageSize,
    offset: (l3Page.value - 1) * pageSize,
    from: dateStart(l3From.value),
    to: dateEnd(l3To.value),
    query: l3Query.value.trim() || undefined
  })
  allPatterns.value = result.items
  allPatternsTotal.value = result.total
}

const loadProfilesPage = async (): Promise<void> => {
  const result = await window.api.knowledge.listAllProfiles({
    limit: pageSize,
    offset: (l4Page.value - 1) * pageSize,
    query: l4Query.value.trim() || undefined
  })
  allProfiles.value = result.items
  allProfilesTotal.value = result.total
}

const loadActiveTasks = async (): Promise<void> => {
  activeTasks.value = await window.api.knowledge.listActiveTasks(20)
}

const reloadAll = async (): Promise<void> => {
  loading.value = true
  try {
    const [settings, modelList, nextStats] = await Promise.all([
      window.api.knowledge.getSettings(),
      window.api.knowledge.embeddingModels.list(),
      window.api.knowledge.stats(),
      loadLlmModels(),
      loadClaimsPage(),
      loadPatternsPage(),
      loadProfilesPage(),
      loadActiveTasks()
    ])
    applySettings(settings)
    models.value = modelList
    stats.value = nextStats
    updateSelectedModelHint()
  } finally {
    loading.value = false
  }
}

const openKnowledgeManager = (): void => {
  window.api.openKnowledgeManager?.()
}

const refreshKnowledgeList = async (): Promise<void> => {
  if (refreshedTimer) window.clearTimeout(refreshedTimer)
  refreshIconSpinning.value = true
  try {
    await reloadAll()
    lastRefreshedAt.value = Date.now()
  } finally {
    refreshedTimer = window.setTimeout(() => {
      refreshIconSpinning.value = false
      refreshedTimer = null
    }, 500)
  }
}

const resetClaimsPage = async (): Promise<void> => {
  l2Page.value = 1
  await loadClaimsPage()
}
const resetPatternsPage = async (): Promise<void> => {
  l3Page.value = 1
  await loadPatternsPage()
}
const resetProfilesPage = async (): Promise<void> => {
  l4Page.value = 1
  await loadProfilesPage()
}
const goClaimsPage = async (page: number): Promise<void> => {
  l2Page.value = Math.min(Math.max(1, page), l2TotalPages.value)
  await loadClaimsPage()
}
const goPatternsPage = async (page: number): Promise<void> => {
  l3Page.value = Math.min(Math.max(1, page), l3TotalPages.value)
  await loadPatternsPage()
}
const goProfilesPage = async (page: number): Promise<void> => {
  l4Page.value = Math.min(Math.max(1, page), l4TotalPages.value)
  await loadProfilesPage()
}

const saveSettings = async (): Promise<void> => {
  try {
    const next = await window.api.knowledge.setSettings({ ...draft })
    applySettings(next)
    statusTone.value = 'good'
    statusText.value = 'Knowledge 设置已保存'
  } catch (error) {
    statusTone.value = 'bad'
    statusText.value = error instanceof Error ? error.message : '保存失败'
  }
}

const downloadSelected = async (): Promise<void> => {
  if (!selectedModel.value) return
  downloading.value = true
  downloadText.value = '准备下载…'
  try {
    const modelLabel = selectedModel.value.label
    const result = await window.api.knowledge.embeddingModels.download(selectedModel.value.key)
    if (!result.success) throw new Error(result.error || '下载失败')
    models.value = await window.api.knowledge.embeddingModels.list()
    downloadText.value = `${modelLabel} 下载完成，可直接使用。`
  } catch (error) {
    downloadText.value = error instanceof Error ? error.message : '下载失败'
  } finally {
    downloading.value = false
  }
}

const openCacheDir = async (): Promise<void> => {
  if (!selectedModel.value) return
  await window.api.knowledge.embeddingModels.openCacheDir(selectedModel.value.key)
}

const toggleModelMenu = (): void => {
  showModelMenu.value = !showModelMenu.value
  if (!showModelMenu.value) modelSearch.value = ''
}

const selectModel = (modelKey: string): void => {
  draft.embeddingModel = modelKey
  closeModelMenu()
  updateSelectedModelHint()
}

const updateSelectedModelHint = (): void => {
  if (downloading.value) return
  const model = selectedModel.value
  if (!model) {
    downloadText.value = ''
    return
  }
  downloadText.value = model.downloaded
    ? `${model.label} 已下载，可直接使用。`
    : `${model.label} 未下载，请先下载当前模型。`
}

const closeModelMenu = (): void => {
  showModelMenu.value = false
  modelSearch.value = ''
}

const llmModelLabel = (key: string): string => {
  if (!key) return '跟随工具模型'
  return llmModels.value.find((model) => model.key === key)?.label ?? key
}

const toggleLlmModelMenu = (key: 'extractionModel' | 'consolidationModel' | 'dreamModel'): void => {
  openLlmModelKey.value = openLlmModelKey.value === key ? null : key
  if (!openLlmModelKey.value) llmModelSearch.value = ''
}

const closeLlmModelMenu = (): void => {
  openLlmModelKey.value = null
  llmModelSearch.value = ''
}

const selectLlmModel = (
  key: 'extractionModel' | 'consolidationModel' | 'dreamModel',
  modelKey: string
): void => {
  draft[key] = modelKey
  closeLlmModelMenu()
}

const onGlobalPointerDown = (event: MouseEvent): void => {
  const target = event.target as Node | null
  if (!target) return
  if (showModelMenu.value) {
    if (modelButtonRef.value?.contains(target) || modelMenuRef.value?.contains(target)) return
    closeModelMenu()
  }
  if (openLlmModelKey.value) {
    const element = target instanceof Element ? target : null
    if (!element?.closest('.knowledge-llm-select-area')) closeLlmModelMenu()
  }
}

const onGlobalKeyDown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    closeModelMenu()
    closeLlmModelMenu()
  }
}

const traceClaim = async (claimId: string): Promise<void> => {
  const claim = allClaims.value.find((item) => item.claimId === claimId)
  traceClaimText.value = claim?.text ?? ''
  traceText.value = '加载溯源中…'
  traceDialogOpen.value = true

  const trace = await window.api.knowledge.trace({ claimId })
  if (!trace) {
    traceText.value = '未找到来源。'
    return
  }
  traceText.value =
    trace.evidenceRefs
      .map((ev, index) => `${index + 1}. ${ev.sourceKind} ${ev.sourceRef}\n${ev.excerpt}`)
      .join('\n\n') || '暂无 evidence。'
}

const reloadKnowledgeData = async (): Promise<void> => {
  const [nextStats] = await Promise.all([
    window.api.knowledge.stats(),
    loadClaimsPage(),
    loadPatternsPage(),
    loadProfilesPage()
  ])
  stats.value = nextStats
}

const deleteClaim = async (claimId: string): Promise<void> => {
  if (!window.confirm('确定删除这条 L2 概念吗？删除后默认不会再被检索或注入。')) return
  await window.api.knowledge.deleteClaim(claimId)
  await reloadKnowledgeData()
}

const deleteReflection = async (reflectionId: string, label: string): Promise<void> => {
  if (!window.confirm(`确定删除这个 ${label} 吗？`)) return
  await window.api.knowledge.deleteReflection(reflectionId)
  if (selectedProfile.value?.id === reflectionId) {
    closeProfileDetail()
  }
  await reloadKnowledgeData()
}

const finalizeActiveTask = async (taskId: string): Promise<void> => {
  await window.api.knowledge.finalizeActiveTask(taskId)
  await reloadAll()
}

const discardActiveTask = async (taskId: string): Promise<void> => {
  if (!window.confirm('确定丢弃这个待沉淀记忆吗？')) return
  await window.api.knowledge.discardActiveTask(taskId)
  await reloadAll()
}

const runDream = async (): Promise<void> => {
  const startedAt = Date.now()
  dreamRunning.value = true
  statusText.value = ''
  try {
    const result = await window.api.knowledge.runDream({ force: true })
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    await reloadAll()
    dreamDialogTone.value = 'good'
    dreamDialogTitle.value = 'Dream 整理完成'
    dreamDialogMessage.value = `统计和 Explorer 已刷新，用时 ${elapsed}s。`
    dreamDialogDetail.value = [
      `处理 Entity：${result.processedEntities}`,
      `去重 L2：${result.deduplicatedClaims}`,
      `归档 L2：${result.archivedClaims}`,
      `生成 L3：${result.patternsCreated}`,
      `更新 L4：${result.profilesUpdated}`
    ].join('\n')
    dreamDialogOpen.value = true
  } catch (error) {
    dreamDialogTone.value = 'bad'
    dreamDialogTitle.value = 'Dream 运行失败'
    dreamDialogMessage.value = error instanceof Error ? error.message : 'Dream 失败'
    dreamDialogDetail.value = ''
    dreamDialogOpen.value = true
  } finally {
    dreamRunning.value = false
  }
}

onMounted(async () => {
  window.addEventListener('pointerdown', onGlobalPointerDown, true)
  window.addEventListener('keydown', onGlobalKeyDown, true)
  offProgress = window.api.knowledge.embeddingModels.onDownloadProgress((event) => {
    const total = event.totalBytes ? ` / ${(event.totalBytes / 1024 / 1024).toFixed(1)}MB` : ''
    downloadText.value = `${event.file} · ${(event.downloadedBytes / 1024 / 1024).toFixed(1)}MB${total}`
  })
  await reloadAll()
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onGlobalPointerDown, true)
  window.removeEventListener('keydown', onGlobalKeyDown, true)
  if (refreshedTimer) window.clearTimeout(refreshedTimer)
  refreshedTimer = null
  offProgress?.()
})

defineExpose({ saveSettings })
</script>

<style scoped>
.knowledge-range {
  --range-progress: 0%;
  --range-track: color-mix(in srgb, var(--theme-border-base) 68%, transparent);
  appearance: none;
  width: 100%;
  height: 1.5rem;
  cursor: pointer;
  background: transparent;
}

.knowledge-range::-webkit-slider-runnable-track {
  height: 0.375rem;
  border-radius: 999px;
  background:
    linear-gradient(var(--theme-accent), var(--theme-accent)) 0 / var(--range-progress) 100%
      no-repeat,
    var(--range-track);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--theme-border-base) 42%, transparent);
}

.knowledge-range::-webkit-slider-thumb {
  appearance: none;
  width: 1.125rem;
  height: 1.125rem;
  margin-top: -0.375rem;
  border-radius: 999px;
  border: 2px solid var(--theme-bg-main);
  background: var(--theme-accent);
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.16),
    0 0 0 2px color-mix(in srgb, var(--theme-accent) 12%, transparent);
}

.knowledge-range:focus-visible {
  outline: none;
}

.knowledge-range:focus-visible::-webkit-slider-runnable-track {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--theme-accent) 28%, transparent),
    0 0 8px color-mix(in srgb, var(--theme-accent) 14%, transparent);
}

.knowledge-range::-moz-range-track {
  height: 0.375rem;
  border-radius: 999px;
  background: var(--range-track);
}

.knowledge-range::-moz-range-progress {
  height: 0.375rem;
  border-radius: 999px;
  background: var(--theme-accent);
}

.knowledge-range::-moz-range-thumb {
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 999px;
  border: 2px solid var(--theme-bg-main);
  background: var(--theme-accent);
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.16),
    0 0 0 2px color-mix(in srgb, var(--theme-accent) 12%, transparent);
}

.knowledge-select-trigger {
  display: flex;
  height: 2.75rem;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid var(--theme-border-base);
  background-color: var(--theme-bg-sidebar);
  color: var(--theme-text-main);
  padding: 0 0.875rem;
  font-size: 0.875rem;
  outline: none;
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.knowledge-select-trigger:hover {
  background-color: var(--theme-bg-hover-item);
}

.knowledge-select-trigger:focus-visible {
  border-color: color-mix(in srgb, var(--focus-ring-color) 35%, transparent);
  box-shadow: var(--focus-ring-shadow);
}

.knowledge-select-menu {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 40;
  margin-top: 0.5rem;
  max-height: 21rem;
  overflow: hidden;
  border-radius: 0.75rem;
  border: 1px solid var(--theme-border-base);
  background-color: var(--theme-bg-sidebar);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
}

.knowledge-select-search {
  height: 2.25rem;
  width: 100%;
  border-radius: 0.5rem;
  border: 1px solid var(--theme-border-base);
  background-color: var(--theme-bg-content);
  color: var(--theme-text-main);
  padding: 0 0.75rem 0 2.25rem;
  font-size: 0.8125rem;
  outline: none;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.knowledge-select-search::placeholder {
  color: var(--theme-text-dim);
}

.knowledge-select-search:focus {
  border-color: color-mix(in srgb, var(--focus-ring-color) 35%, transparent);
  box-shadow: var(--focus-ring-shadow);
}

.knowledge-select-option {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  text-align: left;
  transition:
    background-color 160ms ease,
    color 160ms ease;
}

.knowledge-select-option:hover {
  background-color: var(--theme-bg-hover-item);
}

.knowledge-select-option.is-active {
  background-color: var(--theme-bg-active-item);
}

.knowledge-filter-input {
  height: 2.5rem;
  width: 100%;
  border-radius: 0.75rem;
  border: 1px solid var(--theme-border-base);
  background-color: var(--theme-bg-sidebar);
  color: var(--theme-text-main);
  padding: 0 0.75rem;
  font-size: 0.8125rem;
  outline: none;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    background-color 180ms ease;
}

.knowledge-filter-input--search {
  padding-left: 2.25rem;
}

.knowledge-filter-input::placeholder {
  color: var(--theme-text-dim);
}

.knowledge-filter-input:focus {
  border-color: color-mix(in srgb, var(--focus-ring-color) 35%, transparent);
  box-shadow: var(--focus-ring-shadow);
}

.knowledge-filter-button {
  display: inline-flex;
  height: 2.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.75rem;
  border: 1px solid var(--theme-border-base);
  background-color: var(--theme-bg-sidebar);
  color: var(--theme-text-main);
  padding: 0 0.875rem;
  font-size: 0.75rem;
  font-weight: 600;
  transition:
    background-color 160ms ease,
    opacity 160ms ease;
}

.knowledge-filter-button:hover:not(:disabled) {
  background-color: var(--theme-bg-hover-btn);
}

.knowledge-filter-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.knowledge-empty-state {
  border-radius: 0.75rem;
  border: 1px dashed var(--theme-border-base);
  background-color: var(--theme-bg-sidebar);
  color: var(--theme-text-dim);
  padding: 2rem 1rem;
  text-align: center;
  font-size: 0.75rem;
}

.knowledge-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.34);
  padding: 1.5rem;
  backdrop-filter: blur(8px);
}

.knowledge-dialog-card {
  width: min(28rem, 100%);
  border: 1px solid var(--theme-border-base);
  border-radius: 1rem;
  background: var(--theme-bg-main);
  color: var(--theme-text-main);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.32);
  padding: 1.25rem;
}

.knowledge-trace-dialog-card {
  width: min(42rem, 100%);
}

.knowledge-dialog-fade-enter-active,
.knowledge-dialog-fade-leave-active {
  transition: opacity 160ms ease;
}

.knowledge-dialog-fade-enter-active .knowledge-dialog-card,
.knowledge-dialog-fade-leave-active .knowledge-dialog-card {
  transition:
    transform 160ms ease,
    opacity 160ms ease;
}

.knowledge-dialog-fade-enter-from,
.knowledge-dialog-fade-leave-to {
  opacity: 0;
}

.knowledge-dialog-fade-enter-from .knowledge-dialog-card,
.knowledge-dialog-fade-leave-to .knowledge-dialog-card {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
</style>
