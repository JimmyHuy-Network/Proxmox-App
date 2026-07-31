import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer'),
  // Trỏ thẳng vào mã nguồn TypeScript của workspace. Không có alias này thì Vite
  // sẽ coi đây là dependency trong node_modules và bỏ qua bước biên dịch TS.
  '@pve/ipc': resolve(__dirname, '../../packages/pve-ipc/src/index.ts'),
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        // CommonJS: xem ghi chú "//type" trong package.json.
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Bắt buộc CJS: preload chạy với `sandbox: true` không nạp được ESM.
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },

  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
