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
          'worker-host-entry': resolve('src/main/subagents/worker-host-entry.ts')
        }
      },
      externalizeDeps: {
        exclude: ['@enjoywt/pi-agent-core', '@enjoywt/pi-ai', '@enjoywt/pi-coding-agent']
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
