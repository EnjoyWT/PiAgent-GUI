import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    define: {
      'import.meta.resolve':
        '(specifier => require("url").pathToFileURL(require.resolve(specifier)).href)'
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'worker-host-entry': resolve('src/main/subagents/worker-host-entry.ts'),
          'thread-deletion-worker-entry': resolve(
            'src/main/core-v2/thread-deletion-worker-entry.ts'
          ),
          'local-conversation-cleanup-worker-entry': resolve(
            'src/main/local-conversation-cleanup/worker-entry.ts'
          )
        }
      },
      externalizeDeps: {
        exclude: [
          '@earendil-works/pi-agent-core',
          '@earendil-works/pi-ai',
          '@earendil-works/pi-coding-agent'
        ]
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: true
    }
  },
  renderer: {
    server: {
      hmr: true,
      port: 5173
    },
    optimizeDeps: {
      exclude: ['yl-animated-caret']
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [vue(), tailwindcss()]
  }
})
