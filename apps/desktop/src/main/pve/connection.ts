import {
  PveClient,
  TicketAuthProvider,
  TokenAuthProvider,
  login,
  type AuthProvider,
  type HttpTransport,
  type PveHttpMethod,
  type TicketSession,
} from '@pve/api'
import type { CertInfo, ConnectionPhase } from '@pve/ipc'
import { createHttpsTransport, probeCertificate } from './https-transport.ts'
import type { ConnectionSecret } from '../security/vault.ts'

/**
 * Một kết nối tới Proxmox đang hoạt động, gói trọn vòng đời xác thực.
 *
 * Máy trạng thái: idle → connecting → cert-challenge → tfa-challenge →
 * authenticated → renewing → degraded → failed. Mỗi lần đổi phát một sự kiện để
 * giao diện hiển thị chấm trạng thái cạnh tên kết nối.
 *
 * Luồng đăng nhập nhiều bước (xác nhận chứng chỉ, nhập OTP) được điều khiển ở đây
 * chứ không phải trong `TicketAuthProvider`: provider chỉ giữ và gia hạn phiên,
 * còn bước đăng nhập đầu tiên có thể phải hỏi người dùng nên thuộc về tầng này.
 */

export type EstablishResult =
  | { status: 'ok' }
  | { status: 'cert-untrusted'; cert: CertInfo }
  | { status: 'tfa-challenge'; challenge: string }
  | { status: 'failed'; message: string }

export interface ConnectionMeta {
  id: string
  host: string
  port: number
  authMode: 'ticket' | 'token'
  username: string
  allowSelfSigned: boolean
  certFingerprint?: string
}

type PhaseListener = (phase: ConnectionPhase, message?: string) => void

export class ManagedConnection {
  readonly id: string
  private readonly meta: ConnectionMeta
  private readonly secret: ConnectionSecret | null
  private readonly onPhase: PhaseListener

  private phase: ConnectionPhase = 'idle'
  private client: PveClient | null = null
  private ticketAuth: TicketAuthProvider | null = null
  /** Vé tạm giữa hai bước TFA. */
  private pendingTfaTicket: string | null = null

  constructor(
    meta: ConnectionMeta,
    secret: ConnectionSecret | null,
    onPhase: PhaseListener = () => {},
  ) {
    this.id = meta.id
    this.meta = meta
    this.secret = secret
    this.onPhase = onPhase
  }

  getPhase(): ConnectionPhase {
    return this.phase
  }

  private setPhase(phase: ConnectionPhase, message?: string): void {
    this.phase = phase
    this.onPhase(phase, message)
  }

  /** Transport tới máy chủ này, đã cấu hình ghim vân tay theo trạng thái hiện tại. */
  private makeTransport(overrideAllowSelfSigned?: boolean): HttpTransport {
    return createHttpsTransport({
      host: this.meta.host,
      port: this.meta.port,
      ...(this.meta.certFingerprint ? { pinnedFingerprint: this.meta.certFingerprint } : {}),
      allowSelfSigned: overrideAllowSelfSigned ?? this.meta.allowSelfSigned,
    })
  }

  /**
   * Mở kết nối. Có thể trả về yêu cầu tương tác (xác nhận chứng chỉ hoặc nhập OTP);
   * bên gọi xử lý rồi gọi lại `establish` hoặc `completeTfa`.
   */
  async establish(): Promise<EstablishResult> {
    this.setPhase('connecting')

    // Chưa ghim vân tay và server dùng cert tự ký → phải xác nhận trước.
    if (!this.meta.certFingerprint && !this.meta.allowSelfSigned) {
      try {
        const cert = await probeCertificate(this.meta.host, this.meta.port)
        this.setPhase('cert-challenge')
        return { status: 'cert-untrusted', cert }
      } catch (error) {
        return this.fail(error instanceof Error ? error.message : 'Không dò được chứng chỉ')
      }
    }

    if (this.meta.authMode === 'token') return this.establishToken()
    return this.establishTicket()
  }

  private establishToken(): EstablishResult {
    if (!this.secret?.tokenId || !this.secret.tokenSecret) {
      return this.fail('Thiếu API Token')
    }
    const auth: AuthProvider = new TokenAuthProvider({
      username: this.meta.username,
      tokenId: this.secret.tokenId,
      tokenSecret: this.secret.tokenSecret,
    })
    this.buildClient(auth)
    this.setPhase('authenticated')
    return { status: 'ok' }
  }

  private async establishTicket(): Promise<EstablishResult> {
    if (!this.secret?.password) {
      return this.fail('Thiếu mật khẩu')
    }

    const transport = this.makeTransport()
    let result
    try {
      result = await login(transport, {
        username: this.meta.username,
        password: this.secret.password,
      })
    } catch (error) {
      return this.fail(loginErrorMessage(error))
    }

    if (result.status === 'failed') return this.fail(result.message)

    if (result.status === 'tfa-required') {
      this.pendingTfaTicket = result.partialTicket
      this.setPhase('tfa-challenge')
      return { status: 'tfa-challenge', challenge: result.challenge }
    }

    this.adoptTicketSession(result.session)
    return { status: 'ok' }
  }

  /** Hoàn tất bước hai của TFA bằng mã OTP người dùng nhập. */
  async completeTfa(code: string): Promise<EstablishResult> {
    if (!this.pendingTfaTicket) return this.fail('Không có phiên TFA đang chờ')

    const transport = this.makeTransport()
    let result
    try {
      result = await login(transport, {
        username: this.meta.username,
        // Proxmox mong mã OTP ở dạng `totp:<code>`, kèm vé tạm làm tfa-challenge.
        password: `totp:${code}`,
        tfaChallenge: this.pendingTfaTicket,
      })
    } catch (error) {
      return this.fail(loginErrorMessage(error))
    }

    if (result.status !== 'ok') return this.fail('Mã OTP không đúng')

    this.pendingTfaTicket = null
    this.adoptTicketSession(result.session)
    return { status: 'ok' }
  }

  private adoptTicketSession(session: TicketSession): void {
    const auth = new TicketAuthProvider(this.makeTransport(), {
      username: this.meta.username,
      password: this.secret?.password ?? '',
    })
    auth.adoptSession(session)
    this.ticketAuth = auth
    this.buildClient(auth)
    this.setPhase('authenticated')
  }

  private buildClient(auth: AuthProvider): void {
    this.client = new PveClient({
      transport: this.makeTransport(),
      auth,
      connectionId: this.id,
    })
  }

  private fail(message: string): EstablishResult {
    this.setPhase('failed', message)
    return { status: 'failed', message }
  }

  /**
   * Cookie phiên cho relay console. Chỉ có với ticket auth; token thì null vì
   * WebSocket dùng header Authorization thay cho cookie (xem relay-server).
   */
  sessionCookie(): string | null {
    return this.ticketAuth?.sessionCookie() ?? null
  }

  /** Gọi một endpoint. Ném lỗi nếu chưa mở kết nối. */
  async request(
    method: PveHttpMethod,
    path: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.client) throw new Error('Kết nối chưa được mở')
    return this.client.raw(method, path, params, signal)
  }

  close(): void {
    this.client = null
    this.ticketAuth = null
    this.pendingTfaTicket = null
    this.setPhase('idle')
  }
}

function loginErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('FINGERPRINT_MISMATCH')) {
    return 'Vân tay chứng chỉ đã đổi — kết nối bị chặn để đề phòng tấn công'
  }
  if (/certificate|self.signed|CERT/i.test(message)) {
    return 'Chứng chỉ chưa được tin cậy'
  }
  return message
}
