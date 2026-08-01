import type { PveHttpMethod } from './runtime-types.ts'

/**
 * Phân loại lỗi đã chuẩn hoá. Giao diện dựa vào đây để quyết định hiển thị gì,
 * nên đừng thêm loại mới mà không cân nhắc phía renderer xử lý ra sao.
 */
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
  /** Endpoint có `allowToken: false` nhưng kết nối đang dùng API Token. */
  | 'token-not-permitted'
  /** Path hoặc method không có trong schema — bên gọi đang gọi bậy. */
  | 'unknown-endpoint'

export interface PveErrorInit {
  kind: PveErrorKind
  message: string
  status?: number
  fieldErrors?: Record<string, string>
  path: string
  method: PveHttpMethod
  connectionId?: string
  cause?: unknown
}

export class PveError extends Error {
  readonly kind: PveErrorKind
  readonly status: number | undefined
  /**
   * Lỗi theo từng trường, lấy từ body `{ errors: { param: "…" } }` của Proxmox.
   * Nối thẳng vào `Form.setFields()` của antd — thắng lớn trên hơn 100 form.
   */
  readonly fieldErrors: Record<string, string> | undefined
  readonly path: string
  readonly method: PveHttpMethod
  readonly connectionId: string | undefined

  constructor(init: PveErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined)
    this.name = 'PveError'
    this.kind = init.kind
    this.status = init.status
    this.fieldErrors = init.fieldErrors
    this.path = init.path
    this.method = init.method
    this.connectionId = init.connectionId
  }

  /** Chỉ nên thử lại lỗi mạng tạm thời, và chỉ với request idempotent. */
  get isRetryable(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true
    return this.kind === 'server' && (this.status === 502 || this.status === 503 || this.status === 504)
  }
}

/** Chuyển mã HTTP của Proxmox thành phân loại lỗi. */
export function kindFromStatus(status: number): PveErrorKind {
  if (status === 401) return 'auth'
  if (status === 403) return 'permission'
  if (status === 404) return 'notfound'
  if (status === 400) return 'validation'
  if (status === 409) return 'conflict'
  return 'server'
}

interface ProxmoxErrorBody {
  errors?: Record<string, unknown>
  message?: unknown
  data?: unknown
}

/**
 * Bóc thông điệp lỗi từ body của Proxmox.
 *
 * Proxmox trả lỗi theo ba dạng khác nhau: mã HTTP kèm statusText, body JSON
 * `{ data: null, errors: { param: "…" } }` cho lỗi tham số, và văn bản thuần cho
 * lỗi của tác vụ. Hàm này gom cả ba về một chỗ.
 */
export function parseErrorBody(body: unknown): {
  message?: string
  fieldErrors?: Record<string, string>
} {
  if (typeof body === 'string' && body.trim() !== '') {
    return { message: body.trim() }
  }

  if (typeof body !== 'object' || body === null) return {}

  const parsed = body as ProxmoxErrorBody
  const result: { message?: string; fieldErrors?: Record<string, string> } = {}

  if (typeof parsed.message === 'string' && parsed.message.trim() !== '') {
    result.message = parsed.message.trim()
  }

  if (typeof parsed.errors === 'object' && parsed.errors !== null) {
    const fieldErrors: Record<string, string> = {}
    for (const [field, detail] of Object.entries(parsed.errors)) {
      fieldErrors[field] = typeof detail === 'string' ? detail : JSON.stringify(detail)
    }
    if (Object.keys(fieldErrors).length > 0) {
      result.fieldErrors = fieldErrors
      if (!result.message) {
        // Không có message chung thì ghép các lỗi trường lại, để chỗ nào chỉ hiện
        // một dòng lỗi vẫn nói được điều gì hữu ích.
        result.message = Object.entries(fieldErrors)
          .map(([field, detail]) => `${field}: ${detail}`)
          .join('; ')
      }
    }
  }

  return result
}
