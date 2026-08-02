import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '@pve/ipc'
import type {
  ConnectionInput,
  ConnectionSummary,
  ConsoleOpenRequest,
  ConsoleOpenResult,
  PveEvent,
  PveHttpMethod,
  PveResponse,
  TestConnectionResult,
  TransferDownloadRequest,
  TransferUploadRequest,
} from '@pve/ipc'

type VaultReply<T> = { ok: true; data: T } | { ok: false; message: string }
/** Kết quả mở kết nối, có thể cần xác nhận cert hoặc nhập OTP. */
type EstablishReply =
  | { status: 'ok' }
  | { status: 'cert-untrusted'; cert: TestConnectionResult extends { cert: infer C } ? C : never }
  | { status: 'tfa-challenge'; challenge: string }
  | { status: 'failed'; message: string }

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
  /** Gọi REST tới Proxmox. Main điền tham số và giữ credential. */
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

  /**
   * Đăng ký một luồng đẩy (hiện chỉ có `'resources'` — theo dõi `/cluster/resources`
   * của một kết nối trong main). Nhớ gọi `streamStop` lúc unmount, nếu không main
   * sẽ tiếp tục poll một kết nối không còn ai xem.
   */
  streamStart(
    kind: 'resources',
    connectionId: string,
  ): Promise<{ ok: true; data: { streamId: string } } | { ok: false; message: string }> {
    return ipcRenderer.invoke(IpcChannel.PveStreamStart, { kind, connectionId })
  },

  streamStop(streamId: string): Promise<unknown> {
    return ipcRenderer.invoke(IpcChannel.PveStreamStop, streamId)
  },

  /** Trả về hàm huỷ đăng ký. Renderer bắt buộc gọi nó lúc unmount. */
  onEvent(callback: (event: PveEvent) => void): () => void {
    const handler = (_event: unknown, payload: PveEvent): void => callback(payload)
    ipcRenderer.on(IpcChannel.PveEvent, handler)
    return () => {
      ipcRenderer.off(IpcChannel.PveEvent, handler)
    }
  },

  /** Quản lý kho kết nối nhiều cluster và vòng đời xác thực. */
  vault: {
    list(): Promise<VaultReply<ConnectionSummary[]>> {
      return ipcRenderer.invoke(IpcChannel.Vault, { action: 'list' })
    },
    upsert(input: ConnectionInput): Promise<VaultReply<ConnectionSummary>> {
      return ipcRenderer.invoke(IpcChannel.Vault, { action: 'upsert', input })
    },
    remove(id: string): Promise<VaultReply<boolean>> {
      return ipcRenderer.invoke(IpcChannel.Vault, { action: 'remove', id })
    },
    test(input: ConnectionInput): Promise<VaultReply<TestConnectionResult>> {
      return ipcRenderer.invoke(IpcChannel.Vault, { action: 'test', input })
    },
    connect(id: string): Promise<VaultReply<EstablishReply>> {
      return ipcRenderer.invoke(IpcChannel.Vault, { action: 'connect', id })
    },
    completeTfa(id: string, code: string): Promise<VaultReply<EstablishReply>> {
      return ipcRenderer.invoke(IpcChannel.Vault, { action: 'completeTfa', id, code })
    },
    trustCert(id: string, fingerprint: string): Promise<VaultReply<EstablishReply>> {
      return ipcRenderer.invoke(IpcChannel.Vault, { action: 'trustCert', id, fingerprint })
    },
    disconnect(id: string): Promise<VaultReply<null>> {
      return ipcRenderer.invoke(IpcChannel.Vault, { action: 'disconnect', id })
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

  /**
   * Upload/download stream qua main. Tiến trình tới qua `onEvent` kind `transfer`.
   */
  transfer: {
    upload(
      request: TransferUploadRequest,
    ): Promise<{ ok: true; data: { transferId: string } } | { ok: false; message: string }> {
      return ipcRenderer.invoke(IpcChannel.Transfer, { action: 'upload', request })
    },
    download(
      request: TransferDownloadRequest,
    ): Promise<{ ok: true; data: { transferId: string } } | { ok: false; message: string }> {
      return ipcRenderer.invoke(IpcChannel.Transfer, { action: 'download', request })
    },
    cancel(transferId: string): Promise<unknown> {
      return ipcRenderer.invoke(IpcChannel.Transfer, { action: 'cancel', transferId })
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
