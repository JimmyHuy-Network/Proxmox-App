/** Các động từ HTTP mà Proxmox API dùng. */
export type PveHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/**
 * Một lời gọi REST đi từ renderer sang main.
 *
 * `path` là **mẫu đường dẫn** của Proxmox, không phải URL đã điền tham số —
 * ví dụ `/nodes/{node}/qemu/{vmid}/status/start`. Main đối chiếu mẫu này với
 * registry endpoint sinh tự động rồi mới điền tham số. Nhờ vậy renderer
 * không bao giờ dựng được URL tuỳ ý, loại bỏ hoàn toàn khả năng SSRF.
 *
 * Tham số đường dẫn và tham số query/body nằm chung trong `params`; main tách
 * chúng dựa vào `pathParams` mà generator đã trích từ schema.
 */
export interface PveRequestEnvelope {
  /** Định danh opaque của kết nối. Renderer không bao giờ thấy host hay credential. */
  connectionId: string
  method: PveHttpMethod
  path: string
  params?: Record<string, unknown>
  /** Do renderer sinh, dùng để huỷ qua kênh `pve:cancel`. */
  requestId: string
}

/** Phân loại lỗi đã chuẩn hoá. Renderer dựa vào đây để quyết định hiển thị gì. */
export type PveErrorKind =
  | 'auth'
  | 'permission'
  | 'notfound'
  | 'validation'
  | 'conflict'
  | 'server'
  | 'network'
  | 'tls'
  | 'timeout'
  | 'cancelled'
  /** Endpoint có `allowtoken: 0` nhưng kết nối đang dùng API Token. */
  | 'token-not-permitted'
  /** Path hoặc method không có trong schema — renderer đang gọi bậy. */
  | 'unknown-endpoint'

export interface PveErrorPayload {
  kind: PveErrorKind
  message: string
  status?: number
  /**
   * Lỗi theo từng trường, lấy từ body `{ errors: { param: "..." } }` của Proxmox.
   * Nối thẳng vào `Form.setFields()` của antd — thắng lớn trên hơn 100 form.
   */
  fieldErrors?: Record<string, string>
  path: string
  method: PveHttpMethod
  connectionId: string
}

/**
 * Kết quả trả về qua IPC. Dùng union thay vì ném exception, vì lỗi ném qua
 * `ipcRenderer.invoke` bị Electron serialize thành chuỗi và mất sạch cấu trúc.
 */
export type PveResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: PveErrorPayload }
