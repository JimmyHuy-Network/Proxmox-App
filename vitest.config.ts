import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'apps/desktop/src/shared'),
      '@pve/ipc': resolve(__dirname, 'packages/pve-ipc/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['{apps,packages}/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/e2e/**'],
  },
})
