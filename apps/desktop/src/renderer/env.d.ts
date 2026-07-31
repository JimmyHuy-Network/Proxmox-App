/// <reference types="vite/client" />

import type { PveBridge } from '../preload/index'

declare global {
  interface Window {
    /**
     * Cầu nối duy nhất ra khỏi renderer. Được preload gắn vào qua `contextBridge`.
     * Nếu cần gì mà đây không có, hãy thêm ở main chứ đừng tìm đường vòng.
     */
    pve: PveBridge
  }
}

export {}
