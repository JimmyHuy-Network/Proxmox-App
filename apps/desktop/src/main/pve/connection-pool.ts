import type { ConnectionInput, PveHttpMethod, TestConnectionResult } from '@pve/ipc'
import {
  ManagedConnection,
  type ConnectionMeta,
  type ConsoleEndpoint,
  type EstablishResult,
} from './connection.ts'
import { probeCertificate } from './https-transport.ts'
import type { Vault } from '../security/vault.ts'

/**
 * Quản lý mọi kết nối đang mở tới các cluster.
 *
 * Giữ một `ManagedConnection` cho mỗi kết nối đã kích hoạt. Việc mở kết nối là
 * lười: chỉ dựng khi có request đầu tiên hoặc khi người dùng bấm kết nối.
 */
type EmitPhase = (connectionId: string, phase: string, message?: string) => void

export class ConnectionPool {
  private readonly vault: Vault
  private readonly emit: EmitPhase
  private readonly connections = new Map<string, ManagedConnection>()

  constructor(vault: Vault, emit: EmitPhase = () => {}) {
    this.vault = vault
    this.emit = emit
  }

  private metaFromVault(id: string): ConnectionMeta | null {
    const stored = this.vault.getMeta(id)
    if (!stored) return null
    return {
      id: stored.id,
      host: stored.host,
      port: stored.port,
      authMode: stored.authMode,
      username: stored.username,
      allowSelfSigned: stored.allowSelfSigned,
      ...(stored.certFingerprint ? { certFingerprint: stored.certFingerprint } : {}),
    }
  }

  /** Dựng (hoặc lấy lại) kết nối đã lưu, chưa mở. */
  private materialize(id: string): ManagedConnection | null {
    const existing = this.connections.get(id)
    if (existing) return existing

    const meta = this.metaFromVault(id)
    if (!meta) return null

    const secret = this.vault.getSecret(id)
    const conn = new ManagedConnection(meta, secret, (phase, message) =>
      this.emit(id, phase, message),
    )
    this.connections.set(id, conn)
    return conn
  }

  /** Mở một kết nối đã lưu. Trả về kết quả (có thể cần xác nhận cert hoặc OTP). */
  async connect(id: string): Promise<EstablishResult> {
    const conn = this.materialize(id)
    if (!conn) return { status: 'failed', message: 'Không tìm thấy kết nối' }
    return conn.establish()
  }

  async completeTfa(id: string, code: string): Promise<EstablishResult> {
    const conn = this.connections.get(id)
    if (!conn) return { status: 'failed', message: 'Không có kết nối đang mở' }
    return conn.completeTfa(code)
  }

  /**
   * Ghim vân tay chứng chỉ rồi mở lại kết nối.
   *
   * Dựng lại `ManagedConnection` để nó nhận vân tay mới từ vault — transport gắn
   * vân tay lúc khởi tạo nên không cập nhật tại chỗ được.
   */
  async trustCertAndConnect(id: string, fingerprint256: string): Promise<EstablishResult> {
    this.vault.trustCertificate(id, fingerprint256, new Date().toISOString())
    this.connections.delete(id)
    return this.connect(id)
  }

  async request(
    id: string,
    method: PveHttpMethod,
    path: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let conn = this.connections.get(id)

    // Chưa mở hoặc đã đóng: thử mở trước. Nếu cần tương tác (cert/OTP) thì báo lỗi
    // để renderer chuyển sang luồng kết nối tường minh.
    if (!conn || conn.getPhase() !== 'authenticated') {
      const result = await this.connect(id)
      if (result.status !== 'ok') {
        throw new Error(
          result.status === 'failed' ? result.message : 'Kết nối cần được xác nhận trước',
        )
      }
      conn = this.connections.get(id)
    }

    if (!conn) throw new Error('Không mở được kết nối')
    return conn.request(method, path, params, signal)
  }

  sessionCookie(id: string): string | null {
    return this.connections.get(id)?.sessionCookie() ?? null
  }

  /** Host + TLS + auth headers để main mở WebSocket console thượng nguồn. */
  consoleEndpoint(id: string): ConsoleEndpoint | null {
    return this.connections.get(id)?.consoleEndpoint() ?? null
  }

  close(id: string): void {
    this.connections.get(id)?.close()
    this.connections.delete(id)
  }

  closeAll(): void {
    for (const conn of this.connections.values()) conn.close()
    this.connections.clear()
  }

  /**
   * Thử một kết nối CHƯA lưu (nút "Kiểm tra" trong form thêm cluster).
   *
   * Không đụng vault, không giữ kết nối. Dò chứng chỉ trước để trả về vân tay cho
   * người dùng đối chiếu, rồi thử đăng nhập để xác minh credential.
   */
  async testConnection(input: ConnectionInput): Promise<TestConnectionResult> {
    // Dò chứng chỉ trước nếu chưa tin cậy cert tự ký.
    if (!input.allowSelfSigned) {
      try {
        const cert = await probeCertificate(input.host, input.port)
        // Có thể đọc cert nghĩa là server sống; trả về để người dùng ghim.
        return { status: 'cert-untrusted', cert }
      } catch (error) {
        return { status: 'error', message: probeError(error) }
      }
    }

    const meta: ConnectionMeta = {
      id: '__test__',
      host: input.host,
      port: input.port,
      authMode: input.authMode,
      username: input.username,
      allowSelfSigned: input.allowSelfSigned,
    }
    const secret = {
      ...(input.password ? { password: input.password } : {}),
      ...(input.tokenId ? { tokenId: input.tokenId } : {}),
      ...(input.tokenSecret ? { tokenSecret: input.tokenSecret } : {}),
    }

    const conn = new ManagedConnection(meta, secret)
    const result = await conn.establish()

    switch (result.status) {
      case 'ok': {
        // Lấy phiên bản để hiển thị xác nhận thành công.
        try {
          const version = (await conn.request('GET', '/version', {})) as {
            version: string
            release: string
          }
          conn.close()
          return { status: 'ok', version: version.version, release: version.release }
        } catch {
          conn.close()
          return { status: 'ok', version: '?', release: '?' }
        }
      }
      case 'tfa-challenge':
        return { status: 'tfa-required', challenge: result.challenge }
      case 'cert-untrusted':
        return { status: 'cert-untrusted', cert: result.cert }
      default:
        return { status: 'error', message: result.message }
    }
  }
}

function probeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ECONNREFUSED/.test(message)) return 'Máy chủ từ chối kết nối (kiểm tra địa chỉ và cổng)'
  if (/ETIMEDOUT|Hết thời gian/.test(message)) return 'Hết thời gian chờ máy chủ'
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return 'Không phân giải được tên máy chủ'
  return message
}
