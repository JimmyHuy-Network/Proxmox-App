import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '@pve/ipc'
import type {
  ConsoleOpenRequest,
  ConsoleOpenResult,
  PveEvent,
  PveHttpMethod,
  PveResponse,
} from '@pve/ipc'

/**
 * Cầu nối giữa renderer và main. Cố ý giữ thật mỏng.
 *
 * Không có logic nghiệp vụ nào ở đây — preload chỉ chuyển tiếp. Mỗi hàm thêm vào
 * đây là một dòng thêm vào bề mặt tấn công, nên trước khi thêm hãy hỏi liệu main
 * có thể tự làm việc đó không.
 *
 * Bản thân file này chạy với `sandbox: true`, nên nó chỉ dùng được `ipcRenderer`
 * và `contextBridge` — không có Node, không có `fs`, không có `require` tuỳ ý.
 */
const api = {
  pve: {
    request<T = unknown>(
      connectionId: string,
      method: PveHttpMethod,
      path: string,
      params?: Record<string, unknown>,
    ): Promise<PveResponse<T>> {
      // requestId do preload sinh để renderer không tự đặt trùng nhau được.
      const requestId = crypto.randomUUID()
      return ipcRenderer.invoke(IpcChannel.PveRequest, {
        connectionId,
        method,
        path,
        params,
        requestId,
      })
    },

    cancel(requestId: string): Promise<void> {
      return ipcRenderer.invoke(IpcChannel.PveCancel, requestId)
    },

    /** Trả về hàm huỷ đăng ký. Renderer bắt buộc gọi nó lúc unmount. */
    onEvent(callback: (event: PveEvent) => void): () => void {
      const handler = (_event: unknown, payload: PveEvent): void => callback(payload)
      ipcRenderer.on(IpcChannel.PveEvent, handler)
      return () => {
        ipcRenderer.off(IpcChannel.PveEvent, handler)
      }
    },
  },

  console: {
    open(
      request: ConsoleOpenRequest,
    ): Promise<{ ok: true; data: ConsoleOpenResult | null } | { ok: false; message: string }> {
      return ipcRenderer.invoke(IpcChannel.Console, { action: 'open', request })
    },
    close(sessionId: string): Promise<unknown> {
      return ipcRenderer.invoke(IpcChannel.Console, { action: 'close', sessionId })
    },
  },

  app: {
    getVersion(): Promise<{ ok: boolean; data?: { app: string; electron: string } }> {
      return ipcRenderer.invoke(IpcChannel.App, { action: 'getVersion' })
    },
    isDev(): Promise<{ ok: boolean; data?: boolean }> {
      return ipcRenderer.invoke(IpcChannel.App, { action: 'isDev' })
    },
    /** Main kiểm tra theo danh sách trắng; renderer không mở được URL tuỳ ý. */
    openExternal(url: string): Promise<{ ok: boolean; message?: string }> {
      return ipcRenderer.invoke(IpcChannel.App, { action: 'openExternal', url })
    },
  },
}

export type PveBridge = typeof api

contextBridge.exposeInMainWorld('pve', api)
