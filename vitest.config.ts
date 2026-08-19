import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      // Vite gives the renderer mammoth's browser build, which takes
      // `arrayBuffer`; Node resolution would give the server build, which takes
      // `buffer`. Alias it so tests exercise the same code that ships.
      mammoth: resolve(__dirname, 'node_modules/mammoth/mammoth.browser.js')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
