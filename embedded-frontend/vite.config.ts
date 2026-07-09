/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // Treat all tags starting with 'wokwi-' as custom elements
          isCustomElement: (tag) => tag.startsWith('wokwi-')
        }
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@unisim': path.resolve(__dirname, '../simulator/src/unisim')
    }
  },
  test: {
    environment: 'node',
  },
})
