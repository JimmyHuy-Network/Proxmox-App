import type { PveHttpMethod } from './runtime-types.ts'

export interface RawRequestInit {
  method: PveHttpMethod
  /** Đường dẫn sau `/api2/json`, đã điền tham số, ví dụ `/nodes/pve1/qemu/100/config`. */
  pathname: string
  /** Đưa vào query với GET/DELETE, đưa vào body form với POST/PUT. */
  params?: Record<string, string>
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface RawResponse {
  status: number
  statusText: string
  /** Đã phân tích JSON nếu phản hồi là JSON, ngược lại là chuỗi thô. */
  body: unknown
}

/**
 * Tầng vận chuyển HTTP.
 *
 * Là interface chứ không phải lớp cụ thể, vì tiến trình main của Electron cần cắm
 * agent riêng có ghim vân tay chứng chỉ (Proxmox mặc định dùng cert tự ký, và
 * `rejectUnauthorized: false` đại trà thì không chấp nhận được). Bản dựa trên
 * `fetch` dưới đây dùng cho test và cho mock server.
 */
export interface HttpTransport {
  request(init: RawRequestInit): Promise<RawResponse>
}

export interface FetchTransportOptions {
  baseUrl: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

export function createFetchTransport(options: FetchTransportOptions): HttpTransport {
  const { baseUrl, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const root = baseUrl.replace(/\/+$/, '')

  return {
    async request(init: RawRequestInit): Promise<RawResponse> {
      const url = new URL(`${root}/api2/json${init.pathname}`)
      const headers: Record<string, string> = { Accept: 'application/json', ...init.headers }

      let body: string | undefined

      if (init.method === 'GET' || init.method === 'DELETE') {
        for (const [key, value] of Object.entries(init.params ?? {})) {
          url.searchParams.set(key, value)
        }
      } else if (init.params && Object.keys(init.params).length > 0) {
        // Proxmox nhận x-www-form-urlencoded, không nhận JSON body.
        body = new URLSearchParams(init.params).toString()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }

      // Ghép timeout với signal của bên gọi: hết giờ hoặc bên gọi huỷ đều dừng.
      const timeout = AbortSignal.timeout(timeoutMs)
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout

      const response = await fetchImpl(url, {
        method: init.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal,
      })

      const text = await response.text()
      let parsed: unknown = text
      if (text !== '') {
        try {
          parsed = JSON.parse(text)
        } catch {
          // Lỗi của tác vụ đôi khi trả về văn bản thuần — giữ nguyên chuỗi.
          parsed = text
        }
      }

      return { status: response.status, statusText: response.statusText, body: parsed }
    },
  }
}
