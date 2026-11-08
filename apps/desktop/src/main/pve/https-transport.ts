import { request as httpsRequest, type Agent } from 'node:https'
import { connect as tlsConnect, type PeerCertificate } from 'node:tls'
import { createTlsAgent } from './tls-agent.ts'
import type { HttpTransport, RawRequestInit, RawResponse } from '@pve/api'
import type { CertInfo } from '@pve/ipc'

/**
 * Tầng vận chuyển HTTPS cho main process, có ghim vân tay chứng chỉ.
 *
 * Vì sao không dùng `createFetchTransport` của `@pve/api`: Proxmox mặc định dùng
 * chứng chỉ tự ký, và `rejectUnauthorized: false` đại trà thì chấp nhận bất kỳ
 * chứng chỉ nào — mở đường cho tấn công người-đứng-giữa trong mạng LAN. Ở đây ta
 * dùng trust-on-first-use: lần đầu người dùng xác nhận vân tay, sau đó chỉ chấp
 * nhận đúng vân tay ấy.
 *
 * `fetch` của Node không cho tùy biến kiểm chứng chỉ theo từng kết nối một cách
 * gọn gàng, nên dùng thẳng `node:https` với `Agent` tùy chỉnh.
 */

export interface HttpsTransportOptions {
  host: string
  port: number
  /**
   * Vân tay SHA-256 đã ghim (dạng `AA:BB:...`). Có giá trị thì chỉ chấp nhận đúng
   * chứng chỉ này, bỏ qua kiểm tra CA và tên miền (phù hợp cho cert tự ký).
   * Bỏ trống + `allowSelfSigned=false` nghĩa là kiểm chứng chỉ theo chuẩn.
   */
  pinnedFingerprint?: string
  /** Cho phép cert tự ký chưa ghim (chỉ dùng thoáng qua khi đang dò vân tay). */
  allowSelfSigned?: boolean
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

export function createHttpsTransport(options: HttpsTransportOptions): HttpTransport {
  const { host, port, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const agent = createTlsAgent(options, { keepAlive: true, maxSockets: 6 })
  return {
    request(init: RawRequestInit): Promise<RawResponse> {
      return sendHttps(host, port, agent, init, timeoutMs)
    },
  }
}

function sendHttps(
  host: string,
  port: number,
  agent: Agent,
  init: RawRequestInit,
  timeoutMs: number,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const search = new URLSearchParams()
    let body: string | undefined
    const headers: Record<string, string> = { Accept: 'application/json', ...init.headers }

    if (init.method === 'GET' || init.method === 'DELETE') {
      for (const [key, value] of Object.entries(init.params ?? {})) search.set(key, value)
    } else if (init.params && Object.keys(init.params).length > 0) {
      // Proxmox nhận x-www-form-urlencoded, không nhận JSON body.
      body = new URLSearchParams(init.params).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      headers['Content-Length'] = String(Buffer.byteLength(body))
    }

    const query = search.toString()
    const path = `/api2/json${init.pathname}${query ? `?${query}` : ''}`

    const req = httpsRequest(
      { host, port, method: init.method, path, headers, agent, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed: unknown = text
          if (text !== '') {
            try {
              parsed = JSON.parse(text)
            } catch {
              parsed = text // lỗi tác vụ đôi khi là văn bản thuần
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            body: parsed,
          })
        })
      },
    )

    req.on('timeout', () => req.destroy(new DOMException('Timed out', 'TimeoutError')))
    req.on('error', (err) => reject(err))

    // AbortSignal của bên gọi (dùng cho việc hủy qua TanStack Query).
    if (init.signal) {
      if (init.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        req.destroy()
        return
      }
      init.signal.addEventListener('abort', () => req.destroy(new DOMException('Aborted', 'AbortError')), {
        once: true,
      })
    }

    if (body !== undefined) req.write(body)
    req.end()
  })
}

function formatFingerprint(cert: PeerCertificate): CertInfo {
  const nameOf = (field: PeerCertificate['subject'] | undefined): string => {
    if (!field) return '(không rõ)'
    // CN đôi khi là mảng khi chứng chỉ có nhiều CN.
    const cn = field.CN
    if (cn) return Array.isArray(cn) ? cn.join(', ') : cn
    const joined = Object.values(field).flat().join(', ')
    return joined || '(không rõ)'
  }

  return {
    fingerprint256: cert.fingerprint256,
    subject: nameOf(cert.subject),
    issuer: nameOf(cert.issuer),
    validFrom: cert.valid_from,
    validTo: cert.valid_to,
  }
}

/**
 * Bắt tay TLS một lần để đọc chứng chỉ của máy chủ, không kiểm CA hay tên miền.
 *
 * Đây là bước đầu của trust-on-first-use: đọc vân tay để hiển thị cho người dùng
 * đối chiếu (với `pvenode cert info` trên server) rồi họ quyết định có tin không.
 * Không gửi credential gì trong bước này.
 */
export function probeCertificate(host: string, port: number, timeoutMs = 10_000): Promise<CertInfo> {
  return new Promise((resolve, reject) => {
    // SNI không được phép là địa chỉ IP (RFC 6066). Chỉ đặt servername cho tên miền.
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
    const socket = tlsConnect(
      {
        host,
        port,
        ...(isIp ? {} : { servername: host }),
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        const cert = socket.getPeerCertificate()
        socket.end()
        if (!cert || !cert.fingerprint256) {
          reject(new Error('Máy chủ không trả về chứng chỉ'))
          return
        }
        resolve(formatFingerprint(cert))
      },
    )
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('Hết thời gian chờ khi dò chứng chỉ'))
    })
    socket.on('error', (err) => reject(err))
  })
}
