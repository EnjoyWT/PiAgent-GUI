<template>
  <div
    :class="[
      mini ? 'w-full h-full pb-80' : 'fixed inset-0 z-100',
      'flex items-center justify-center bg-(--theme-bg-main) p-6 overflow-hidden select-none relative'
    ]"
  >
    <!-- Background Accents -->
    <template v-if="!mini">
      <div
        class="onboarding-blob onboarding-blob--primary absolute top-[-10%] left-[-10%] w-[50%] h-[50%] blur-[120px] rounded-full animate-pulse pointer-events-none"
      ></div>
      <div
        class="onboarding-blob onboarding-blob--secondary absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] blur-[120px] rounded-full animate-pulse pointer-events-none"
        style="animation-delay: 2s"
      ></div>
    </template>

    <!-- Top Right Actions (Hide in mini) -->
    <div v-if="!mini" class="absolute top-6 right-6 z-110">
      <button
        class="onboarding-settings-btn p-2 rounded-xl backdrop-blur-md transition-all active:scale-95"
        title="设置"
        @click="$emit('open-settings')"
      >
        <Settings :size="16" />
      </button>
    </div>

    <div
      :class="[
        mini ? 'max-w-md space-y-4 pt-12' : 'max-w-lg space-y-12 pt-24',
        'w-full text-center transition-all duration-1000 ease-out transform',
        isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      ]"
    >
      <!-- Logo / Icon -->
      <div class="flex justify-center">
        <div class="relative group">
          <div
            :class="[
              mini ? 'text-2xl' : 'text-5xl sm:text-6xl',
              'onboarding-wordmark relative z-10 font-black uppercase tracking-[0.08em]'
            ]"
          >
            <span class="onboarding-wordmark-text">PiAgent</span>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div :class="mini ? 'space-y-1.5' : 'space-y-4'">
        <h1
          :class="[
            mini ? 'text-2xl font-extrabold' : 'text-4xl sm:text-5xl font-extrabold',
            'onboarding-title tracking-tight'
          ]"
        >
          欢迎使用
          <span class="onboarding-title-accent text-transparent bg-clip-text">PiAgent</span>
        </h1>
        <p
          :class="[
            mini ? 'text-sm' : 'text-lg sm:text-xl',
            'onboarding-subtitle leading-relaxed max-w-sm mx-auto px-4'
          ]"
        >
          {{
            mini
              ? '当前工作空间已就绪。你可以创建一个新的 Thread 来开始讨论代码或请求协助。'
              : '开启你的智能编程伴侣。选择一个本地项目文件夹，我们将立刻为你准备好一切。'
          }}
        </p>
      </div>

      <!-- Action -->
      <div :class="mini ? 'pt-1' : 'pt-2 px-4'">
        <button
          :class="[
            mini ? 'px-4 py-2.5 text-sm' : 'px-12 py-5 text-xl',
            'onboarding-action-btn group relative w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-xl font-bold transition-all active:scale-[0.98] overflow-hidden'
          ]"
          @click="$emit('action')"
        >
          <div class="onboarding-action-overlay absolute inset-0 transition-opacity"></div>
          <div class="relative z-10 inline-flex items-center justify-center gap-2.5">
            <Plus :size="mini ? 16 : 24" stroke-width="3" />
            <span>{{ mini ? '新建对话线程' : '选择项目文件夹' }}</span>
          </div>
        </button>

        <p
          v-if="!mini"
          class="onboarding-caption mt-6 text-xs font-bold tracking-[0.2em] uppercase"
        >
          Workspace based context indexing
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Plus, Settings } from 'lucide-vue-next'

const isLoaded = ref(false)

withDefaults(
  defineProps<{
    mini?: boolean
  }>(),
  {
    mini: false
  }
)

defineEmits<{
  (e: 'action'): void
  (e: 'open-settings'): void
}>()

onMounted(() => {
  setTimeout(() => {
    isLoaded.value = true
  }, 100)
})
</script>

<style scoped>
.onboarding-blob--primary {
  background: var(--onboarding-blob-primary, rgba(59, 130, 246, 0.1));
}

.onboarding-blob--secondary {
  background: var(--onboarding-blob-secondary, rgba(16, 185, 129, 0.1));
}

.onboarding-settings-btn {
  background: var(--onboarding-settings-bg, rgba(255, 255, 255, 0.4));
  border: var(--onboarding-settings-border, 1px solid rgba(226, 232, 240, 0.5));
  color: var(--onboarding-settings-text, #64748b);
  box-shadow: var(--onboarding-settings-shadow, 0 1px 2px rgba(0, 0, 0, 0.05));
}

.onboarding-settings-btn:hover {
  background: var(--onboarding-settings-bg-hover, #ffffff);
  color: var(--onboarding-settings-text-hover, #0f172a);
}

.onboarding-wordmark {
  color: var(--onboarding-wordmark, #0f172a);
}

.onboarding-wordmark-text {
  display: inline-block;
  background-image:
    var(--onboarding-wordmark-gradient, linear-gradient(to right, #0f172a, #2563eb)),
    linear-gradient(
      110deg,
      transparent 42%,
      rgba(255, 255, 255, 0.95) 50%,
      transparent 58%
    );
  background-size: 100% 100%, 220% 100%;
  background-position: 0 0, 140% 0;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: onboarding-shine 1.6s ease-in-out 3;
}

.onboarding-title {
  color: var(--onboarding-title, #0f172a);
}

.onboarding-title-accent {
  background-image: var(--onboarding-title-gradient, linear-gradient(to right, #2563eb, #059669));
}

.onboarding-subtitle {
  color: var(--onboarding-subtitle, #64748b);
}

.onboarding-action-btn {
  background: var(--onboarding-button-bg, #0f172a);
  border: var(--onboarding-button-border, none);
  box-shadow: var(--onboarding-button-shadow, 0 15px 30px -10px rgba(15, 23, 42, 0.2));
  color: var(--onboarding-button-text, #ffffff);
}

.onboarding-action-btn:hover {
  background: var(--onboarding-button-bg-hover, #1e293b);
  box-shadow: var(--onboarding-button-shadow-hover, 0 20px 40px -12px rgba(15, 23, 42, 0.3));
}

.onboarding-action-overlay {
  background-image: var(
    --onboarding-button-overlay,
    linear-gradient(to right, rgba(96, 165, 250, 0.2), rgba(52, 211, 153, 0.2))
  );
  opacity: var(--onboarding-button-overlay-opacity, 0);
}

.onboarding-action-btn:hover .onboarding-action-overlay {
  opacity: var(--onboarding-button-overlay-hover-opacity, 1);
}

.onboarding-caption {
  color: var(--onboarding-caption, #94a3b8);
}

@keyframes onboarding-shine {
  0%,
  18% {
    background-position: 0 0, 140% 0;
  }

  30%,
  72% {
    background-position: 0 0, 50% 0;
  }

  100% {
    background-position: 0 0, -40% 0;
  }
}
</style>
