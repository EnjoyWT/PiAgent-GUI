<template>
  <div class="flex w-full h-full flex-col gap-3">
    <!-- Provider list + search -->
    <div class="flex items-center gap-2">
      <div class="relative w-60">
        <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)" />
        <input
          v-model="providerSearch"
          type="text"
          placeholder="搜索提供商..."
          class="w-full pl-9 pr-3 py-2 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-xs text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:border-(--theme-accent) focus:ring-1 focus:ring-(--theme-accent) outline-none"
        />
      </div>
      <button
        type="button"
        class="h-9 px-3 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-(--theme-text-main) text-xs font-semibold"
        @click="openAddCustomProvider"
      >
        + 自定义供应商
      </button>
    </div>

    <div class="flex-1 min-h-0 flex flex-row gap-3">
      <!-- Provider list -->
      <div
        class="w-60 h-full bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-2xl overflow-y-auto p-3 space-y-2"
      >
        <div
          v-for="p in filteredProviders"
          :key="p.id"
          class="flex items-center px-3 py-3 rounded-xl cursor-pointer border transition group"
          :class="[
            activeProviderId === p.id
              ? 'border-(--theme-border-active-item) bg-(--theme-bg-active-item) text-(--theme-text-bright)'
              : 'border-transparent hover:bg-(--theme-bg-hover-item) text-(--theme-text-main)',
            !p.enabled && activeProviderId !== p.id ? 'opacity-50 grayscale-[0.4]' : ''
          ]"
          @click="selectProvider(p.id)"
        >
          <div class="w-5 h-5 mr-3 flex items-center justify-center">
            <img
              v-if="getProviderIconUrl(p.displayName)"
              :src="getProviderIconUrl(p.displayName)!"
              :alt="`${p.displayName} icon`"
              class="w-4 h-4"
              draggable="false"
            />
            <span v-else class="text-xs font-bold text-(--theme-text-dim) uppercase">
              {{ p.displayName[0] }}
            </span>
          </div>
          <span class="text-sm font-medium flex-1 truncate">{{ p.displayName }}</span>
          <span
            v-if="p.id.startsWith('custom_')"
            class="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-(--theme-bg-hover-item) text-(--theme-text-main) border border-(--theme-border-base)"
            title="自定义供应商"
          >
            Custom
          </span>
          <div
            :class="
              p.enabled
                ? 'w-2 h-2 rounded-full bg-[#00ba88] ml-2 group-hover:shadow-[0_0_0_3px_rgba(0,186,136,0.15)]'
                : 'w-2 h-2 rounded-full bg-(--theme-text-dim) ml-2'
            "
          ></div>
        </div>
      </div>

      <!-- Provider detail -->
      <div
        class="flex-1 h-full min-w-[320px] bg-(--theme-bg-main) border border-(--theme-border-base) rounded-2xl p-6 shadow-sm flex flex-col overflow-hidden"
      >
        <div class="flex items-center justify-between shrink-0">
          <div>
            <div class="flex items-center space-x-2">
              <input
                v-if="isEditingName"
                ref="nameInputRef"
                v-model="editingName"
                type="text"
                class="text-lg font-bold bg-(--theme-bg-content) border border-(--theme-border-base) rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-(--theme-accent) text-(--theme-text-bright) w-48"
                @blur="saveName"
                @keydown.enter="saveName"
                @keydown.esc="cancelEditName"
              />
              <h2
                v-else
                class="text-lg font-bold text-(--theme-text-bright)"
                :class="activeProviderId?.startsWith('custom_') ? 'cursor-pointer hover:underline decoration-dotted select-none' : ''"
                :title="activeProviderId?.startsWith('custom_') ? '双击编辑供应商名称' : ''"
                @dblclick="startEditingName"
              >
                {{ providerForm.displayName || 'Provider' }}
              </h2>
              <span
                class="px-2 py-0.5 text-[10px] font-bold rounded-full"
                :class="
                  providerForm.enabled
                    ? 'bg-[#00ba88] text-white'
                    : 'bg-(--theme-bg-hover-item) text-(--theme-text-dim)'
                "
              >
                {{ providerForm.enabled ? 'Active' : 'Inactive' }}
              </span>
            </div>
            <p class="text-xs text-(--theme-text-dim) mt-1">{{ providerForm.runtimeProvider }}</p>
            <div
              v-if="speedStatus.text"
              class="text-xs font-semibold mt-1"
              :class="
                speedStatus.color === 'red'
                  ? 'text-red-500'
                  : speedStatus.color === 'green'
                    ? 'text-emerald-600'
                    : 'text-gray-500'
              "
            >
              {{ speedStatus.text }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <!-- Speed test dropdown -->
            <div class="relative">
              <button
                ref="modelButtonRef"
                class="h-7 px-2 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-(--theme-text-main) flex items-center gap-2"
                type="button"
                :disabled="providerModels.length === 0"
                title="选择模型测速"
                @click="toggleModelMenu"
              >
                <component
                  :is="speedIconComponent"
                  :size="14"
                  :class="[
                    isSpeedTesting ? 'animate-spin' : '',
                    speedStatus.color === 'green'
                      ? 'text-emerald-600'
                      : speedStatus.color === 'red'
                        ? 'text-red-500'
                        : 'text-(--theme-text-main)'
                  ]"
                />
                <ChevronDown :size="12" class="text-(--theme-text-dim)" />
              </button>

              <div
                v-if="showModelMenu"
                ref="modelMenuRef"
                class="absolute right-0 mt-2 w-75 max-h-90 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-xl shadow-2xl overflow-hidden z-30"
              >
                <div class="p-2 border-b border-(--theme-border-base) sticky top-0 bg-(--theme-bg-sidebar)">
                  <div class="relative">
                    <Search
                      :size="14"
                      class="absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)"
                    />
                    <input
                      v-model="modelSearch"
                      type="text"
                      placeholder="选择要测试的模型"
                      class="w-full pl-8 pr-3 py-2 text-sm bg-(--theme-bg-content) border border-(--theme-border-base) rounded-lg focus:outline-none focus:ring-1 focus:ring-(--theme-accent) text-(--theme-text-main) placeholder:text-(--theme-text-dim)"
                    />
                  </div>
                </div>

                <div class="max-h-75 overflow-y-auto bg-(--theme-bg-sidebar)">
                  <div
                    v-for="m in filteredSpeedModels"
                    :key="m.modelId"
                    class="px-3 py-2.5 cursor-pointer flex justify-between items-center text-sm hover:bg-(--theme-bg-hover-item)"
                    @click="selectSpeedModel(m)"
                  >
                    <span class="font-semibold text-(--theme-text-bright) truncate max-w-[65%]">{{
                      m.label
                    }}</span>
                    <span class="text-xs text-(--theme-text-dim) truncate max-w-[35%] text-right">{{
                      m.modelId
                    }}</span>
                  </div>
                  <div
                    v-if="filteredSpeedModels.length === 0"
                    class="px-3 py-3 text-xs text-(--theme-text-dim)"
                  >
                    无匹配模型
                  </div>
                </div>
              </div>
            </div>

            <!-- Provider enabled toggle -->
            <div
              class="relative inline-flex items-center w-12 h-6 rounded-full transition cursor-pointer"
              :class="providerForm.enabled ? 'bg-[#00ba88]' : 'bg-(--theme-bg-hover-item)'"
              role="switch"
              :aria-checked="providerForm.enabled"
              @click="toggleProviderEnabled"
            >
              <div
                class="w-5 h-5 bg-white rounded-full shadow-sm transition"
                :class="providerForm.enabled ? 'translate-x-6' : 'translate-x-1'"
              ></div>
            </div>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto mt-6 pr-1">
          <div class="space-y-6">


            <!-- API Key -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-[11px] font-bold uppercase text-(--theme-text-dim)">API Key</label>
              </div>
              <div class="relative mt-2">
                <input
                  v-model="providerForm.apiKey"
                  :type="showApiKey ? 'text' : 'password'"
                  class="w-full px-4 py-2.5 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none pr-10"
                  :placeholder="currentDoc.keyHint"
                  @input="setDirty(true)"
                />

                <button
                  type="button"
                  class="absolute inset-y-0 right-3 flex items-center text-(--theme-text-dim)"
                  @click="showApiKey = !showApiKey"
                >
                  <Eye v-if="!showApiKey" :size="16" />
                  <EyeOff v-else :size="16" />
                </button>
              </div>
              <div class="text-[10px] text-(--theme-text-dim) flex items-center flex-wrap gap-1">
                <span>{{ currentDoc.keyHint }}</span>
                <button
                  v-if="currentDoc.docUrl !== '#'"
                  type="button"
                  class="inline-flex items-center text-(--theme-accent) hover:underline"
                  @click="openDoc(currentDoc.docUrl)"
                >
                  <span>{{ currentDoc.docLabel || '获取 API Key' }}</span>
                  <ExternalLink class="w-3 h-3 ml-1" />
                </button>
              </div>
            </div>

            <!-- Base URL -->
            <div class="space-y-2">
              <label class="text-[11px] font-bold uppercase text-(--theme-text-dim)">Base URL (可选)</label>
              <input
                v-model="providerForm.baseUrl"
                type="text"
                :placeholder="currentDoc.basePlaceholder"
                class="w-full px-4 py-2.5 mt-2 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none"
                @input="scheduleSaveProvider()"
              />
              <p class="text-[10px] text-(--theme-text-dim)">
                留空则使用默认端点；自定义请填写对应厂商 Base URL
              </p>
            </div>

            <!-- Extra settings (adapter-defined) -->
            <div v-if="extraFields.length" class="space-y-2">
              <label class="text-[11px] font-bold uppercase text-(--theme-text-dim)">Provider Settings</label>
              <div class="space-y-3">
                <div v-for="f in extraFields" :key="f.key" class="space-y-1">
                  <div class="text-[11px] font-semibold text-(--theme-text-main)">{{ f.label }}</div>
                  <div
                    v-if="f.type === 'switch'"
                    class="flex items-center justify-between gap-3 py-1"
                  >
                    <div class="text-[10px] text-(--theme-text-dim) flex-1">
                      {{ f.helpText || '' }}
                    </div>
                    <div
                      class="relative inline-flex items-center w-12 h-6 rounded-full transition shrink-0 cursor-pointer"
                      :class="providerForm.settings[f.key] ? 'bg-[#00ba88]' : 'bg-(--theme-bg-hover-item)'"
                      role="switch"
                      :aria-checked="Boolean(providerForm.settings[f.key])"
                      @click="
                        () => {
                          providerForm.settings[f.key] = !providerForm.settings[f.key]
                          scheduleSaveProvider()
                        }
                      "
                    >
                      <div
                        class="w-5 h-5 bg-white rounded-full shadow-sm transition"
                        :class="providerForm.settings[f.key] ? 'translate-x-6' : 'translate-x-1'"
                      ></div>
                    </div>
                  </div>
                  <select
                    v-else-if="f.type === 'select'"
                    v-model="providerForm.settings[f.key]"
                    class="w-full px-3 py-2 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none"
                    @change="scheduleSaveProvider()"
                  >
                    <option v-for="opt in f.options" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                  <input
                    v-else
                    v-model="providerForm.settings[f.key]"
                    :type="f.type === 'password' ? 'password' : 'text'"
                    :placeholder="f.placeholder || ''"
                    class="w-full px-3 py-2 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none"
                    @input="scheduleSaveProvider()"
                  />
                  <div v-if="f.type !== 'switch' && f.helpText" class="text-[10px] text-(--theme-text-dim)">
                    {{ f.helpText }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Models -->
            <div v-if="hasApiKey" class="space-y-2">
              <div class="flex justify-between">
                <label class="text-[12px] font-bold text-(--theme-text-bright)">Models</label>
                <button
                  class="h-8 px-2 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-(--theme-text-main) flex items-center gap-2"
                  type="button"
                  :disabled="isFetchingModels"
                  @click="fetchModels()"
                >
                  <component
                    :is="fetchModelsButtonIcon"
                    :size="14"
                    :class="[
                      fetchModelsButtonIconClass,
                      currentFetchModelsButtonState === 'loading' ? 'animate-spin' : ''
                    ]"
                  />
                  <div class="text-[13px]" :class="fetchModelsButtonTextClass">
                    {{ fetchModelsButtonText }}
                  </div>
                </button>
              </div>

              <div class="relative">
                <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-(--theme-text-dim)" />
                <input
                  v-model="modelsSearch"
                  type="text"
                  placeholder="Search models..."
                  class="w-full pl-8 pr-3 py-2 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-xs text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none"
                />
              </div>

              <div class="text-[10px] font-semibold text-(--theme-text-dim)">
                Showing {{ filteredProviderModels.length }} models (enabled first)
              </div>

              <div class="bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg overflow-hidden">
                <template v-if="filteredProviderModels.length">
                  <div class="max-h-105 overflow-y-auto">
                    <div
                      v-for="m in filteredProviderModels"
                      :key="m.modelId"
                      class="flex items-center gap-3 px-4 py-1.25 border-b border-(--theme-border-base) last:border-b-0 hover:bg-(--theme-bg-hover-item)"
                    >
                      <div class="flex-1 min-w-0">
                        <div class="text-[12px] font-semibold text-(--theme-text-main) truncate">
                          {{ m.label }}
                        </div>
                        <div class="flex items-center gap-1.25 text-xs text-(--theme-text-dim) mt-1">
                          <Tooltip text="图片输入 (Vision)">
                            <span
                              v-if="m.capabilities?.imageInput"
                              class="inline-flex items-center text-emerald-600"
                            >
                              <Eye :size="12" />
                            </span>
                          </Tooltip>

                          <Tooltip text="函数调用 (Tool Calling)">
                            <span
                              v-if="m.capabilities?.tools"
                              class="inline-flex items-center text-emerald-600"
                            >
                              <Wrench :size="12" />
                            </span>
                          </Tooltip>
                          <Tooltip text="思考模式 (Reasoning)">
                            <span
                              v-if="m.capabilities?.reasoning"
                              class="inline-flex items-center text-emerald-600"
                            >
                              <Brain :size="12" />
                            </span>
                          </Tooltip>
                          <Tooltip text="上下文窗口">
                            <span class="inline-flex items-center gap-1 text-gray-500">
                              {{ formatTokens(m.contextWindowTokens ?? undefined) }}
                            </span>
                          </Tooltip>

                          <!-- <span class="text-[10px] text-gray-400 truncate max-w-[70%]">
                            {{ m.modelId }}
                          </span> -->
                        </div>
                      </div>

                      <div class="flex items-center gap-2">
                        <button
                          v-if="providerForm.id.startsWith('custom_')"
                          type="button"
                          class="h-6 px-2 rounded-md border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-[11px] font-semibold text-(--theme-text-main)"
                          title="查看原始模型数据"
                          @click="openRawModal(m)"
                        >
                          Raw
                        </button>
                        <div
                          class="relative inline-flex items-center w-12 h-6 rounded-full transition cursor-pointer"
                          :class="m.enabled ? 'bg-[#00ba88]' : 'bg-(--theme-bg-hover-item)'"
                          role="switch"
                          :aria-checked="m.enabled"
                          @click="toggleModelEnabled(m)"
                        >
                          <div
                            class="w-5 h-5 bg-white rounded-full shadow-sm transition"
                            :class="m.enabled ? 'translate-x-6' : 'translate-x-1'"
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <div
                  v-else
                  class="px-4 py-6 text-center text-xs leading-5"
                  :class="modelsError ? 'text-rose-500' : 'text-(--theme-text-dim)'"
                >
                  <div
                    class="font-semibold"
                    :class="modelsError ? 'text-rose-600' : 'text-(--theme-text-main)'"
                  >
                    {{ modelsError ? 'Failed to load models' : 'No models available' }}
                  </div>
                  <div>
                    {{ modelsError || 'Please check your API key and try refreshing' }}
                  </div>
                </div>
              </div>
              <div class="text-[10px] text-(--theme-text-dim)">
                Fetch 后会保留已启用模型；新模型默认关闭。
              </div>
            </div>

            <div
              v-if="isCustomProvider"
              class="mt-6 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 space-y-4"
            >
              <!-- Header -->
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold uppercase tracking-wide text-rose-500">
                  Danger Zone
                </span>
              </div>

              <!-- Content -->
              <div class="flex items-start justify-between gap-6">
                <div class="space-y-1">
                  <div class="text-sm font-semibold text-rose-500">删除自定义 Provider</div>
                  <p class="text-xs leading-5 text-rose-500/80 max-w-md">
                    删除后将永久移除该 Provider 的配置、API Key 和模型缓存，且无法恢复。
                  </p>
                </div>

                <!-- Button -->
                <button
                  type="button"
                  class="shrink-0 h-9 px-4 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 active:bg-rose-800 transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                  :disabled="isDeletingProvider"
                  @click="deleteCustomProvider(providerForm.id)"
                >
                  {{ isDeletingProvider ? 'Deleting…' : '删除 Provider' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Add Custom Provider Modal -->
  <div
    v-if="showAddCustomProvider"
    class="fixed inset-0 z-60 flex items-center justify-center bg-black/30 backdrop-blur-sm"
    @mousedown.self="closeAddCustomProvider"
  >
    <div class="bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-2xl shadow-2xl w-160 max-w-[90%] p-6 pt-7 space-y-5">
      <div class="text-xl font-bold text-(--theme-text-bright)">Add Custom Provider</div>

      <div class="space-y-2">
        <div class="text-[12px] font-bold text-(--theme-text-main)">Provider Name</div>
        <input
          v-model="customForm.displayName"
          type="text"
          placeholder="My Custom Provider"
          class="w-full px-4 py-3 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none"
        />
      </div>

      <div class="space-y-2">
        <div class="text-[12px] font-bold text-(--theme-text-main)">Base URL</div>
        <input
          v-model="customForm.baseUrl"
          type="text"
          placeholder="https://api.example.com/v1"
          class="w-full px-4 py-3 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none"
        />
      </div>

      <div class="space-y-2">
        <div class="text-[12px] font-bold text-(--theme-text-main)">API Key</div>
        <div class="relative">
          <input
            v-model="customForm.apiKey"
            :type="showCustomApiKey ? 'text' : 'password'"
            placeholder="your-api-key"
            class="w-full px-4 py-3 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-sm text-(--theme-text-main) placeholder:text-(--theme-text-dim) focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none pr-10"
          />
          <button
            type="button"
            class="absolute inset-y-0 right-3 flex items-center text-(--theme-text-dim) hover:text-(--theme-text-main)"
            @click="showCustomApiKey = !showCustomApiKey"
          >
            <Eye v-if="!showCustomApiKey" :size="16" />
            <EyeOff v-else :size="16" />
          </button>
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-[12px] font-bold text-(--theme-text-main)">API Format</div>
        <div class="relative">
          <select
            v-model="customForm.apiFormat"
            class="w-full pl-4 pr-10 py-3 bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-lg text-sm focus:ring-1 focus:ring-(--theme-accent) focus:border-(--theme-accent) outline-none text-(--theme-text-main) appearance-none cursor-pointer"
          >
            <option value="chat_completions">Chat Completions (/chat/completions)</option>
            <option value="responses">Responses (/responses)</option>
            <option value="anthropic_messages">Anthropic Messages (/v1/messages)</option>
          </select>
          <div class="absolute inset-y-0 right-3 flex items-center pointer-events-none text-(--theme-text-dim)">
            <ChevronDown :size="16" />
          </div>
        </div>
        <div class="text-[11px] text-(--theme-text-dim)">
          Choose the API endpoint format your provider uses
        </div>
      </div>

      <div
        v-if="customForm.apiFormat === 'chat_completions'"
        class="flex items-center justify-between"
      >
        <div>
          <div class="text-[12px] font-bold text-(--theme-text-main)">Use max_completion_tokens</div>
          <div class="text-[11px] text-(--theme-text-dim) mt-1">
            Enable for newer OpenAI models (o1, o3, etc.) that require max_completion_tokens instead
            of max_tokens
          </div>
        </div>
        <div
          class="relative inline-flex items-center w-12 h-6 rounded-full transition shrink-0 cursor-pointer"
          :class="customForm.useMaxCompletionTokens ? 'bg-[#00ba88]' : 'bg-(--theme-bg-hover-item)'"
          role="switch"
          :aria-checked="customForm.useMaxCompletionTokens"
          @click="customForm.useMaxCompletionTokens = !customForm.useMaxCompletionTokens"
        >
          <div
            class="w-5 h-5 bg-white rounded-full shadow-sm transition"
            :class="customForm.useMaxCompletionTokens ? 'translate-x-6' : 'translate-x-1'"
          ></div>
        </div>
      </div>

      <div v-if="customFormError" class="text-sm text-rose-500 font-semibold">
        {{ customFormError }}
      </div>

      <div class="flex items-center gap-2">
        <input
          id="skip-custom-validation"
          v-model="customForm.skipValidation"
          type="checkbox"
          class="w-4 h-4 rounded border-(--theme-border-base) bg-(--theme-bg-content) text-(--theme-accent) focus:ring-(--theme-accent) focus:ring-offset-0 cursor-pointer"
        />
        <label for="skip-custom-validation" class="text-xs text-amber-500/80 leading-relaxed">跳过验证，直接保存（验证失败时仍可继续）</label>
      </div>

      <div class="flex justify-end gap-3 pt-2">
        <button
          type="button"
          class="h-10 px-4 rounded-lg border border-(--theme-border-base) bg-(--theme-bg-sidebar) hover:bg-(--theme-bg-hover-btn) text-(--theme-text-main) font-semibold"
          @click="closeAddCustomProvider"
        >
          Cancel
        </button>
        <button
          type="button"
          class="h-10 px-4 rounded-lg bg-[#00ba88] text-white font-semibold disabled:opacity-60"
          :disabled="isCreatingCustomProvider"
          @click="createCustomProvider"
        >
          {{ isCreatingCustomProvider ? 'Adding...' : 'Add Provider' }}
        </button>
      </div>
    </div>
  </div>

  <!-- Raw JSON Modal -->
  <div
    v-if="showRawModal"
    class="fixed inset-0 z-60 flex items-center justify-center bg-black/30 backdrop-blur-sm"
    @mousedown.self="showRawModal = false"
  >
    <div class="bg-(--theme-bg-sidebar) border border-(--theme-border-base) rounded-2xl shadow-2xl w-180 max-w-[92%] p-6 pt-7 space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-lg font-bold text-(--theme-text-bright)">{{ rawModalTitle }}</div>
        <button
          type="button"
          class="text-(--theme-text-dim) hover:text-(--theme-text-main)"
          aria-label="Close"
          @click="showRawModal = false"
        >
          ✕
        </button>
      </div>
      <pre
        class="bg-(--theme-bg-content) border border-(--theme-border-base) rounded-lg p-3 text-xs max-h-120 overflow-auto text-(--theme-text-main)"
        >{{ rawModalText }}</pre
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch, nextTick } from 'vue'
import {
  Brain,
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Search,
  Wrench,
  CircleCheck,
  CircleX,
  Zap
} from 'lucide-vue-next'
import { getProviderIconUrl } from '@renderer/utils/providerIcons'
import { getProviderAdapter } from '@renderer/providers/registry'
import type { ProviderAdapter } from '@renderer/providers/types'
import type { ProviderConfigModel, ProviderConfigSummary } from '@shared/provider-config'
import Tooltip from '@renderer/components/common/Tooltip.vue'
import { globalDialog } from '../../../utils/dialog'

const emit = defineEmits<{
  (e: 'dirty-change', dirty: boolean): void
}>()

type ModelView = {
  modelId: string
  label: string
  contextWindowTokens: number | null
  enabled: boolean
  capabilities: { imageInput?: boolean; tools?: boolean; reasoning?: boolean } | null
  rawJson: string | null
}

type FetchModelsButtonState = 'idle' | 'pending' | 'loading' | 'success'

const providerSearch = ref('')
const providers = ref<ProviderConfigSummary[]>([])
const activeProviderId = ref<string | null>(null)
const showAddCustomProvider = ref(false)
const isCreatingCustomProvider = ref(false)
const customFormError = ref<string | null>(null)
const customForm = reactive<{
  displayName: string
  baseUrl: string
  apiKey: string
  apiFormat: 'chat_completions' | 'responses' | 'anthropic_messages'
  useMaxCompletionTokens: boolean
  skipValidation: boolean
}>({
  displayName: '',
  baseUrl: '',
  apiKey: '',
  apiFormat: 'chat_completions',
  useMaxCompletionTokens: false,
  skipValidation: false
})

const providerForm = reactive<{
  id: string
  displayName: string
  runtimeProvider: string
  apiKey: string
  baseUrl: string
  enabled: boolean
  settings: Record<string, any>
}>({
  id: '',
  displayName: '',
  runtimeProvider: '',
  apiKey: '',
  baseUrl: '',
  enabled: false,
  settings: {}
})

const showApiKey = ref(false)
const showCustomApiKey = ref(false)
const savedApiKey = ref('')
const showModelMenu = ref(false)
const modelSearch = ref('')
const modelsSearch = ref('')
const isFetchingModels = ref(false)
const modelsError = ref<string | null>(null)
const providerModels = ref<ModelView[]>([])
const showRawModal = ref(false)
const rawModalTitle = ref('')
const rawModalText = ref('')
const isDeletingProvider = ref(false)
const isSavingApiKey = ref(false)

const speedStatus = reactive<{ text: string; color: 'gray' | 'green' | 'red' }>({
  text: '',
  color: 'gray'
})
const isSpeedTesting = ref(false)
let speedTestNonce = 0

const speedIconComponent = computed(() => {
  if (isSpeedTesting.value) return Loader2
  if (speedStatus.color === 'green') return CircleCheck
  if (speedStatus.color === 'red') return CircleX
  return Zap
})

const modelButtonRef = ref<HTMLElement | null>(null)
const modelMenuRef = ref<HTMLElement | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | null = null
const fetchModelsButtonState = reactive<{
  providerId: string | null
  value: FetchModelsButtonState
}>({
  providerId: null,
  value: 'idle'
})
let fetchModelsButtonNonce = 0
let fetchModelsButtonDelayTimer: ReturnType<typeof setTimeout> | null = null
let fetchModelsButtonSuccessTimer: ReturnType<typeof setTimeout> | null = null
let fetchModelsButtonVisibleAt = 0

const FETCH_MODELS_SPINNER_DELAY_MS = 180
const FETCH_MODELS_MIN_VISIBLE_MS = 600
const FETCH_MODELS_SUCCESS_VISIBLE_MS = 1000

const adapter = computed<ProviderAdapter | null>(() =>
  providerForm.id ? getProviderAdapter(providerForm.id) : null
)

const currentDoc = computed(() => {
  const a = adapter.value
  return (
    a?.docs ?? {
      keyHint: '在供应商控制台获取 API Key',
      basePlaceholder: providerForm.baseUrl || 'https://api.your-provider.com',
      docUrl: '#',
      docLabel: '获取 API Key'
    }
  )
})

const extraFields = computed(() => adapter.value?.settingsSpec().extraFields ?? [])

const hasApiKey = computed(() => providerForm.apiKey.trim().length > 0)
const isApiKeyDirty = computed(() => providerForm.apiKey.trim() !== savedApiKey.value.trim())
const isCustomProvider = computed(() => providerForm.id.startsWith('custom_'))
const currentFetchModelsButtonState = computed<FetchModelsButtonState>(() =>
  fetchModelsButtonState.providerId === providerForm.id ? fetchModelsButtonState.value : 'idle'
)
const fetchModelsButtonIcon = computed(() => {
  if (currentFetchModelsButtonState.value === 'loading') return Loader2
  if (currentFetchModelsButtonState.value === 'success') return CircleCheck
  return Download
})
const fetchModelsButtonIconClass = computed(() => {
  if (currentFetchModelsButtonState.value === 'success') return 'text-[#00ba88]'
  return 'text-gray-700'
})
const fetchModelsButtonText = computed(() => {
  if (currentFetchModelsButtonState.value === 'loading') return 'Fetching…'
  if (currentFetchModelsButtonState.value === 'success') return 'Updated'
  return 'Fetch'
})
const fetchModelsButtonTextClass = computed(() =>
  currentFetchModelsButtonState.value === 'success' ? 'text-[#00ba88]' : 'text-gray-700'
)

const filteredProviders = computed(() =>
  providers.value
    .filter((p) => p.displayName.toLowerCase().includes(providerSearch.value.trim().toLowerCase()))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled))
)

const filteredSpeedModels = computed(() => {
  const q = modelSearch.value.trim().toLowerCase()
  const list = providerModels.value.map((m) => ({
    modelId: m.modelId,
    label: m.label
  }))
  if (!q) return list
  return list.filter(
    (m) => m.label.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q)
  )
})

const filteredProviderModels = computed(() => {
  const q = modelsSearch.value.trim().toLowerCase()
  return providerModels.value
    .filter((m) => {
      if (!q) return true
      return m.label.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q)
    })
    .sort((a, b) => Number(b.enabled) - Number(a.enabled))
})

const formatTokens = (value?: number | null) => {
  if (!value || Number.isNaN(value)) return '-'
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

const toModelView = (rows: ProviderConfigModel[]): ModelView[] =>
  rows.map((model) => ({
    modelId: model.modelId,
    label: model.label,
    contextWindowTokens: model.contextWindowTokens,
    enabled: model.enabled,
    capabilities: model.capabilities,
    rawJson: model.rawJson ?? null
  }))

const openRawModal = (m: ModelView) => {
  rawModalTitle.value = `Raw: ${m.modelId}`
  rawModalText.value = (m.rawJson ?? '').trim() || '(empty)'
  showRawModal.value = true
}

const openDoc = (url: string) => {
  if (!url || url === '#') return
  window.api?.openExternal?.(url) ?? window.open(url, '_blank', 'noopener,noreferrer')
}

const setDirty = (dirty: boolean) => {
  emit('dirty-change', dirty)
}

const syncDirtyState = () => {
  setDirty(Boolean(saveTimer) || isApiKeyDirty.value)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const providerSettingsPayload = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(toRaw(providerForm.settings ?? {}))) as Record<string, unknown>

const clearFetchModelsButtonTimers = () => {
  if (fetchModelsButtonDelayTimer) {
    clearTimeout(fetchModelsButtonDelayTimer)
    fetchModelsButtonDelayTimer = null
  }
  if (fetchModelsButtonSuccessTimer) {
    clearTimeout(fetchModelsButtonSuccessTimer)
    fetchModelsButtonSuccessTimer = null
  }
}

const resetFetchModelsButtonState = () => {
  fetchModelsButtonNonce += 1
  clearFetchModelsButtonTimers()
  fetchModelsButtonVisibleAt = 0
  fetchModelsButtonState.providerId = null
  fetchModelsButtonState.value = 'idle'
}

const resetProviderDetail = () => {
  activeProviderId.value = null
  providerForm.id = ''
  providerForm.displayName = ''
  providerForm.runtimeProvider = ''
  providerForm.baseUrl = ''
  providerForm.enabled = false
  providerForm.settings = {}
  providerForm.apiKey = ''
  savedApiKey.value = ''
  providerModels.value = []
  modelsError.value = null
  modelsSearch.value = ''
  resetFetchModelsButtonState()
  speedStatus.text = ''
  speedStatus.color = 'gray'
  setDirty(false)
}

const loadProviders = async (preferredProviderId?: string | null) => {
  providers.value = await window.api.providerConfig.listProviders()
  const preferred =
    (preferredProviderId ?? activeProviderId.value) &&
    providers.value.some((p) => p.id === (preferredProviderId ?? activeProviderId.value))
      ? (preferredProviderId ?? activeProviderId.value)!
      : (providers.value.find((p) => p.enabled)?.id ?? providers.value[0]?.id ?? null)

  if (!preferred) {
    resetProviderDetail()
    return
  }

  await loadProviderDetail(preferred)
}

const loadProviderDetail = async (providerId: string) => {
  const p = await window.api.providerConfig.getProviderDetail(providerId)
  activeProviderId.value = providerId
  // Reset per-provider UI state so results don't leak across providers.
  showModelMenu.value = false
  modelSearch.value = ''
  resetFetchModelsButtonState()
  speedStatus.text = ''
  speedStatus.color = 'gray'
  isSpeedTesting.value = false
  speedTestNonce += 1

  providerForm.id = p.id
  providerForm.displayName = p.displayName
  providerForm.runtimeProvider = p.runtimeProvider
  providerForm.baseUrl = (p.baseUrl ?? '').trim()
  providerForm.enabled = Boolean(p.enabled)
  providerForm.settings = { ...(p.settings ?? {}) }
  providerForm.apiKey = p.apiKey ?? ''
  savedApiKey.value = p.apiKey?.trim() ?? ''
  modelsError.value = null
  modelsSearch.value = ''
  providerModels.value = toModelView(p.models)
  setDirty(false)
}

const isEditingName = ref(false)
const editingName = ref('')
const nameInputRef = ref<HTMLInputElement | null>(null)

const startEditingName = () => {
  if (!activeProviderId.value?.startsWith('custom_')) return
  isEditingName.value = true
  editingName.value = providerForm.displayName
  nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}

const saveName = () => {
  if (!isEditingName.value) return
  const trimmed = editingName.value.trim()
  if (trimmed && trimmed !== providerForm.displayName) {
    providerForm.displayName = trimmed
    void saveProviderSettings()
  }
  isEditingName.value = false
}

const cancelEditName = () => {
  isEditingName.value = false
}

const selectProvider = async (providerId: string) => {
  isEditingName.value = false
  await flushPendingSave()
  await loadProviderDetail(providerId)
}

const saveProviderSettings = async () => {
  if (!providerForm.id) return
  const detail = await window.api.providerConfig.upsertProvider({
    id: providerForm.id,
    displayName: providerForm.displayName,
    runtimeProvider: providerForm.runtimeProvider,
    enabled: providerForm.enabled,
    baseUrl: providerForm.baseUrl || null,
    settings: providerSettingsPayload()
  })
  providerModels.value = toModelView(detail.models)
  providers.value = await window.api.providerConfig.listProviders()
  setDirty(isApiKeyDirty.value)
}

const scheduleSaveProvider = (delay = 500) => {
  setDirty(true)
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveProviderSettings()
  }, delay)
}

const flushPendingSave = async () => {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  await saveProviderSettings()
}

const toggleProviderEnabled = async () => {
  providerForm.enabled = !providerForm.enabled
  await saveProviderSettings()
}

const toggleModelMenu = () => {
  if (providerModels.value.length === 0) return
  showModelMenu.value = !showModelMenu.value
}

const handleClickOutside = (e: MouseEvent) => {
  const target = e.target as Node
  if (showModelMenu.value) {
    if (!modelButtonRef.value?.contains(target) && !modelMenuRef.value?.contains(target)) {
      showModelMenu.value = false
    }
  }
}

const openAddCustomProvider = () => {
  customForm.displayName = ''
  customForm.baseUrl = ''
  customForm.apiKey = ''
  customForm.apiFormat = 'chat_completions'
  customForm.useMaxCompletionTokens = false
  customForm.skipValidation = false
  customFormError.value = null
  showAddCustomProvider.value = true
}

const closeAddCustomProvider = () => {
  showAddCustomProvider.value = false
  customFormError.value = null
  customForm.skipValidation = false
}

const getFallbackProviderId = (deletedProviderId: string): string | null => {
  const remaining = providers.value.filter((provider) => provider.id !== deletedProviderId)
  return remaining.find((provider) => provider.enabled)?.id ?? remaining[0]?.id ?? null
}

const deleteCustomProvider = async (providerId: string) => {
  const provider = providers.value.find((item) => item.id === providerId)
  if (!provider || !provider.id.startsWith('custom_')) return

  const confirmed = await globalDialog.confirm({
    title: '删除 Provider',
    message: `确定删除 Provider "${provider.displayName}" 吗？`,
    detail: '已保存的 API Key、Base URL 和模型缓存都会被移除。',
    confirmText: '删除',
    cancelText: '取消',
    danger: true
  })
  if (!confirmed) return

  isDeletingProvider.value = true
  try {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const nextProviderId = getFallbackProviderId(providerId)
    await window.api.providerConfig.deleteProvider(providerId)
    await loadProviders(nextProviderId)
    setDirty(false)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await globalDialog.alert({
      title: '删除失败',
      message: message ? `删除失败：${message}` : '删除 Provider 失败'
    })
  } finally {
    isDeletingProvider.value = false
  }
}

const createCustomProviderId = () =>
  `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const createCustomProvider = async () => {
  const name = customForm.displayName.trim()
  const baseUrl = customForm.baseUrl.trim().replace(/\/+$/g, '')
  const apiKey = customForm.apiKey.trim()
  if (!name) {
    customFormError.value = '请输入 Provider Name'
    return
  }
  if (!baseUrl) {
    customFormError.value = '请输入 Base URL'
    return
  }
  if (!apiKey) {
    customFormError.value = '请输入 API Key'
    return
  }

  isCreatingCustomProvider.value = true
  customFormError.value = null
  try {
    const id = createCustomProviderId()
    await window.api.providerConfig.upsertProvider({
      id,
      displayName: name,
      runtimeProvider: id,
      enabled: true,
      baseUrl,
      settings: {
        apiFormat: customForm.apiFormat,
        useMaxCompletionTokens: customForm.useMaxCompletionTokens
      }
    })
    const result = await window.api.providerConfig.setupApiKey({
      providerId: id,
      apiKey,
      baseUrl,
      settings: {
        apiFormat: customForm.apiFormat,
        useMaxCompletionTokens: customForm.useMaxCompletionTokens
      }
    })
    if (!result.saved) {
      if (!customForm.skipValidation) {
        await window.api.providerConfig.deleteProvider(id)
        customFormError.value = result.validation.message
        return
      }
    }
    closeAddCustomProvider()
    await loadProviders(id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    customFormError.value = msg.slice(0, 160)
  } finally {
    isCreatingCustomProvider.value = false
  }
}

const saveProviderApiKey = async () => {
  if (!providerForm.id) return
  const apiKey = providerForm.apiKey.trim()
  if (!apiKey) {
    speedStatus.text = '请输入 API Key'
    speedStatus.color = 'red'
    return
  }

  isSavingApiKey.value = true
  speedStatus.text = '验证中...'
  speedStatus.color = 'gray'
  try {
    await flushPendingSave()
    const result = await window.api.providerConfig.setupApiKey({
      providerId: providerForm.id,
      apiKey,
      baseUrl: providerForm.baseUrl || null,
      settings: providerSettingsPayload()
    })
    if (!result.saved) {
      speedStatus.text = result.validation.message
      speedStatus.color = 'red'
      providerModels.value = []
      modelsError.value = result.validation.message
      setDirty(true)
      return
    }

    savedApiKey.value = apiKey
    providerModels.value = toModelView(result.models)
    providers.value = await window.api.providerConfig.listProviders()
    modelsError.value = null
    speedStatus.text = result.validation.message
    speedStatus.color = 'green'
    setDirty(false)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    speedStatus.text = message.slice(0, 160)
    speedStatus.color = 'red'
    setDirty(true)
  } finally {
    isSavingApiKey.value = false
  }
}

const fetchModels = async () => {
  if (!providerForm.id) return
  if (!providerForm.apiKey.trim()) {
    modelsError.value = '请输入 API Key'
    return
  }
  const providerIdAtStart = providerForm.id
  const nonce = ++fetchModelsButtonNonce
  clearFetchModelsButtonTimers()
  fetchModelsButtonVisibleAt = 0
  fetchModelsButtonState.providerId = providerIdAtStart
  fetchModelsButtonState.value = 'pending'
  fetchModelsButtonDelayTimer = setTimeout(() => {
    if (
      fetchModelsButtonNonce !== nonce ||
      fetchModelsButtonState.providerId !== providerIdAtStart
    ) {
      return
    }
    fetchModelsButtonState.value = 'loading'
    fetchModelsButtonVisibleAt = Date.now()
    fetchModelsButtonDelayTimer = null
  }, FETCH_MODELS_SPINNER_DELAY_MS)
  isFetchingModels.value = true
  modelsError.value = null
  let completed = false
  try {
    const result = await window.api.providerConfig.fetchModels({
      providerId: providerIdAtStart,
      apiKey: providerForm.apiKey,
      baseUrl: providerForm.baseUrl || null,
      settings: providerSettingsPayload()
    })
    if (providerForm.id === providerIdAtStart) {
      providerModels.value = toModelView(result.models)
    }
    completed = true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (providerForm.id === providerIdAtStart) {
      modelsError.value = msg.slice(0, 180)
      providerModels.value = []
    }
  } finally {
    if (fetchModelsButtonDelayTimer) {
      clearTimeout(fetchModelsButtonDelayTimer)
      fetchModelsButtonDelayTimer = null
    }
    if (fetchModelsButtonState.providerId === providerIdAtStart && fetchModelsButtonVisibleAt > 0) {
      const remaining = FETCH_MODELS_MIN_VISIBLE_MS - (Date.now() - fetchModelsButtonVisibleAt)
      if (remaining > 0) {
        await sleep(remaining)
      }
    }
    if (
      fetchModelsButtonNonce === nonce &&
      fetchModelsButtonState.providerId === providerIdAtStart
    ) {
      if (completed) {
        fetchModelsButtonState.value = 'success'
        fetchModelsButtonSuccessTimer = setTimeout(() => {
          if (
            fetchModelsButtonNonce === nonce &&
            fetchModelsButtonState.providerId === providerIdAtStart
          ) {
            fetchModelsButtonState.providerId = null
            fetchModelsButtonState.value = 'idle'
            fetchModelsButtonVisibleAt = 0
            fetchModelsButtonSuccessTimer = null
          }
        }, FETCH_MODELS_SUCCESS_VISIBLE_MS)
      } else {
        fetchModelsButtonState.providerId = null
        fetchModelsButtonState.value = 'idle'
        fetchModelsButtonVisibleAt = 0
      }
    }
    isFetchingModels.value = false
  }
}

const selectSpeedModel = (m: { modelId: string; label: string }) => {
  showModelMenu.value = false
  void runSpeedTest(m.modelId)
}

const runSpeedTest = async (modelId: string) => {
  if (!providerForm.id) return
  const providerIdAtStart = providerForm.id
  const nonce = ++speedTestNonce
  isSpeedTesting.value = true
  speedStatus.text = '检测可用性...'
  speedStatus.color = 'gray'
  try {
    const res = await window.api.providerConfig.validate({
      providerId: providerIdAtStart,
      modelId,
      apiKey: providerForm.apiKey,
      baseUrl: providerForm.baseUrl || null,
      settings: providerSettingsPayload()
    })
    // Provider switched while awaiting: ignore stale result.
    if (providerForm.id !== providerIdAtStart || nonce !== speedTestNonce) return
    if (res.ok) {
      speedStatus.text = res.ms == null ? '连接成功！' : `连接成功！ (${res.ms}ms)`
      speedStatus.color = 'green'
    } else {
      speedStatus.text = res.message.slice(0, 120)
      speedStatus.color = 'red'
    }
  } catch (err) {
    if (providerForm.id === providerIdAtStart && nonce === speedTestNonce) {
      const message = err instanceof Error ? err.message : String(err)
      speedStatus.text = message.slice(0, 120)
      speedStatus.color = 'red'
    }
  } finally {
    if (providerForm.id === providerIdAtStart && nonce === speedTestNonce) {
      isSpeedTesting.value = false
    }
  }
}

const toggleModelEnabled = async (m: ModelView) => {
  if (!providerForm.id) return
  const nextEnabled = !m.enabled
  m.enabled = nextEnabled
  try {
    const detail = await window.api.providerConfig.setModelEnabled({
      providerId: providerForm.id,
      modelId: m.modelId,
      enabled: nextEnabled
    })
    providerModels.value = toModelView(detail.models)
  } catch (err) {
    m.enabled = !nextEnabled
    const message = err instanceof Error ? err.message : String(err)
    await globalDialog.alert({
      title: '保存失败',
      message: message ? `模型状态保存失败：${message}` : '模型状态保存失败'
    })
  }
}

watch(
  () => providerForm.apiKey,
  (val, prev) => {
    const hasNow = val.trim().length > 0
    const hadBefore = prev?.trim().length > 0
    if (!hasNow && hadBefore) {
      providerModels.value = []
      modelsError.value = null
    }
    syncDirtyState()
  }
)

onMounted(async () => {
  await loadProviders()
  document.addEventListener('mousedown', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  if (saveTimer) clearTimeout(saveTimer)
  resetFetchModelsButtonState()
})

defineExpose({
  saveProvider: async () => {
    await flushPendingSave()
    if (isApiKeyDirty.value) {
      await saveProviderApiKey()
    }
  }
})
</script>
